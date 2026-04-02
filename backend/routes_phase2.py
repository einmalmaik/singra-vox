"""
Singra Vox - Phase 2 Extended Routes
Threads, Search, Unread, File Upload, Group DMs, Edit History,
Channel Overrides, Temp Rooms, E2EE Key Management
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import Response as RawResponse
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path
import os
import uuid
import base64
import re
import jwt as pyjwt
from app.permissions import get_message_history_cutoff as _shared_history_cutoff, has_server_permission

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

_client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = _client[os.environ['DB_NAME']]
_jwt_secret = os.environ.get('JWT_SECRET', '')
_JWT_ALG = "HS256"
_E2EE_DEVICE_HEADER = "X-Singra-Device-Id"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _id():
    return str(uuid.uuid4())


async def _user(request: Request):
    token = request.cookies.get("access_token")
    if not token:
        ah = request.headers.get("Authorization", "")
        if ah.startswith("Bearer "):
            token = ah[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        p = pyjwt.decode(token, _jwt_secret, algorithms=[_JWT_ALG])
        if p.get("type") != "access":
            raise HTTPException(401, "Invalid token")
        user = await db.users.find_one({"id": p["sub"]}, {"_id": 0})
        if not user:
            raise HTTPException(401, "User not found")
        user.pop("password_hash", None)
        return user
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")


async def _has_perm(user_id, server_id, perm):
    return await has_server_permission(db, user_id, server_id, perm)


async def _history_cutoff(user_id, server_id):
    return await _shared_history_cutoff(db, user_id, server_id)


async def _private_channel_user_ids(channel_id):
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        return []
    members = await db.server_members.find(
        {"server_id": channel["server_id"], "is_banned": {"$ne": True}},
        {"_id": 0, "user_id": 1, "roles": 1},
    ).to_list(500)
    access_entries = await db.channel_access.find({"channel_id": channel_id}, {"_id": 0}).to_list(500)
    if not channel.get("is_private") or not access_entries:
        return [member["user_id"] for member in members]
    allowed = {entry["target_id"] for entry in access_entries if entry.get("type") == "user"}
    allowed_roles = {entry["target_id"] for entry in access_entries if entry.get("type") == "role"}
    for member in members:
        if allowed_roles.intersection(member.get("roles") or []):
            allowed.add(member["user_id"])
    server = await db.servers.find_one({"id": channel["server_id"]}, {"_id": 0, "owner_id": 1})
    if server and server.get("owner_id"):
        allowed.add(server["owner_id"])
    return list(allowed)


async def _assert_channel_access(user_id, channel):
    if not channel.get("is_private"):
        return
    allowed_ids = await _private_channel_user_ids(channel["id"])
    if user_id not in allowed_ids:
        raise HTTPException(403, "No access to this private channel")


def _request_device_id(request: Request):
    return (request.headers.get(_E2EE_DEVICE_HEADER) or "").strip() or None


async def _require_verified_device(request: Request, user: dict):
    device_id = _request_device_id(request)
    if not device_id:
        raise HTTPException(400, "A verified desktop device header is required")
    device = await db.e2ee_devices.find_one({"user_id": user["id"], "device_id": device_id}, {"_id": 0})
    if not device or device.get("revoked_at") or not device.get("verified_at"):
        raise HTTPException(403, "This desktop device is not trusted for end-to-end encryption")
    return device


async def _accessible_text_channels(user_id, server_id, *, include_private=True):
    """
    Resolve the server text channels the current user may legitimately see.

    Unread counters and server-wide search previously looked at every text
    channel in the server, which leaked private-channel activity to members who
    were not part of that channel. E2EE/private channels must be filtered at the
    channel list boundary, not only when the message body is fetched.
    """
    if not await _has_perm(user_id, server_id, "read_messages"):
        return []

    text_channels = await db.channels.find(
        {"server_id": server_id, "type": "text"},
        {"_id": 0},
    ).to_list(200)

    accessible = []
    for channel in text_channels:
        if channel.get("is_private"):
            if not include_private:
                continue
            allowed_ids = await _private_channel_user_ids(channel["id"])
            if user_id not in allowed_ids:
                continue
        accessible.append(channel)
    return accessible


def _parse_mentions(content):
    return re.findall(r'@(\w+)', content)


# ──────── Models ────────
class GroupDMCreate(BaseModel):
    name: str = ""
    member_ids: List[str]

class GroupMsgCreate(BaseModel):
    content: str = ""
    encrypted_content: Optional[str] = None
    is_encrypted: bool = False
    attachments: List[dict] = []
    nonce: Optional[str] = None
    sender_device_id: Optional[str] = None
    protocol_version: str = "sv-e2ee-v1"
    key_envelopes: List[dict] = []

class ChannelOverrideInput(BaseModel):
    target_type: str
    target_id: str
    permissions: dict

class KeyBundleInput(BaseModel):
    identity_key: str
    signed_pre_key: str
    one_time_pre_keys: List[str] = []


phase2 = APIRouter(prefix="/api", tags=["Phase2"])

# ═══════════════════════════════════════════════════
#  THREADS
# ═══════════════════════════════════════════════════
@phase2.get("/messages/{message_id}/thread")
async def get_thread(message_id: str, request: Request):
    user = await _user(request)
    parent = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not parent:
        raise HTTPException(404, "Message not found")
    channel = await db.channels.find_one({"id": parent["channel_id"]}, {"_id": 0})
    if not channel or not await _has_perm(user["id"], channel["server_id"], "read_messages"):
        raise HTTPException(403, "No permission")
    await _assert_channel_access(user["id"], channel)
    history_cutoff = await _history_cutoff(user["id"], channel["server_id"])
    if history_cutoff and parent.get("created_at") and parent["created_at"] < history_cutoff:
        raise HTTPException(403, "No permission to read message history")
    author = await db.users.find_one({"id": parent["author_id"]}, {"_id": 0, "password_hash": 0})
    parent["author"] = author
    reply_query = {"thread_id": message_id, "is_deleted": {"$ne": True}}
    if history_cutoff:
        reply_query["created_at"] = {"$gte": history_cutoff}
    replies = await db.messages.find(reply_query, {"_id": 0}).sort("created_at", 1).to_list(200)
    for r in replies:
        a = await db.users.find_one({"id": r["author_id"]}, {"_id": 0, "password_hash": 0})
        r["author"] = a
    return {"parent": parent, "replies": replies, "reply_count": len(replies)}


@phase2.post("/channels/{channel_id}/messages/{message_id}/reply")
async def reply_in_thread(channel_id: str, message_id: str, request: Request):
    user = await _user(request)
    body = await request.json()
    parent = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not parent:
        raise HTTPException(404, "Parent not found")
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    await _assert_channel_access(user["id"], channel)

    is_e2ee_channel = bool(channel.get("is_private"))
    content = body.get("content", "").strip()
    attachments = body.get("attachments", [])

    mention_ids = []
    if not is_e2ee_channel:
        if not content:
            raise HTTPException(400, "Content required")
        mention_names = _parse_mentions(content)
        for m in mention_names:
            u = await db.users.find_one({"username": m.lower()}, {"_id": 0})
            if u:
                mention_ids.append(u["id"])
    else:
        device = await _require_verified_device(request, user)
        if not body.get("is_e2ee") or not body.get("ciphertext") or not body.get("nonce") or not body.get("sender_device_id"):
            raise HTTPException(400, "Encrypted private threads require a desktop E2EE payload")
        if body.get("sender_device_id") != device["device_id"]:
            raise HTTPException(400, "Encrypted thread replies must originate from the active desktop device")
        content = "[encrypted]"

    reply = {
        "id": _id(), "channel_id": channel_id, "author_id": user["id"],
        "content": content, "type": "text", "thread_id": message_id,
        "attachments": attachments,
        "edited_at": None, "is_deleted": False, "reactions": {},
        "reply_to_id": message_id, "mention_ids": mention_ids,
        "thread_count": 0, "created_at": _now(),
        "is_e2ee": is_e2ee_channel,
        "ciphertext": body.get("ciphertext", ""),
        "encrypted_content": body.get("encrypted_content") or body.get("ciphertext", ""),
        "nonce": body.get("nonce", ""),
        "sender_device_id": body.get("sender_device_id"),
        "protocol_version": body.get("protocol_version", "sv-e2ee-v1"),
        "message_type": body.get("message_type", "thread_reply"),
        "key_envelopes": body.get("key_envelopes", []),
    }
    await db.messages.insert_one(reply)
    reply.pop("_id", None)
    reply["author"] = user
    tc = await db.messages.count_documents({"thread_id": message_id, "is_deleted": {"$ne": True}})
    await db.messages.update_one({"id": message_id}, {"$set": {"thread_count": tc}})
    return reply


# ═══════════════════════════════════════════════════
#  SEARCH
# ═══════════════════════════════════════════════════
@phase2.get("/search")
async def search_messages(request: Request, q: str = "", server_id: str = None, channel_id: str = None, limit: int = 25):
    user = await _user(request)
    if len(q) < 2:
        return []
    query = {
        "content": {"$regex": q, "$options": "i"},
        "is_deleted": {"$ne": True},
        "is_e2ee": {"$ne": True},
    }
    if channel_id:
        channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
        if not channel or not await _has_perm(user["id"], channel["server_id"], "read_messages"):
            raise HTTPException(403, "No permission")
        await _assert_channel_access(user["id"], channel)
        if channel.get("is_private"):
            raise HTTPException(400, "Server-side search is unavailable in encrypted private channels")
        query["channel_id"] = channel_id
        history_cutoff = await _history_cutoff(user["id"], channel["server_id"])
        if history_cutoff:
            query["created_at"] = {"$gte": history_cutoff}
    elif server_id:
        channels = await _accessible_text_channels(user["id"], server_id, include_private=False)
        if not channels:
            return []
        query["channel_id"] = {"$in": [channel["id"] for channel in channels]}
        history_cutoff = await _history_cutoff(user["id"], server_id)
        if history_cutoff:
            query["created_at"] = {"$gte": history_cutoff}
    results = await db.messages.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for msg in results:
        msg["author"] = await db.users.find_one({"id": msg["author_id"]}, {"_id": 0, "password_hash": 0})
        ch = await db.channels.find_one({"id": msg.get("channel_id")}, {"_id": 0, "name": 1, "server_id": 1})
        msg["channel"] = ch
    return results


# ═══════════════════════════════════════════════════
#  UNREAD TRACKING
# ═══════════════════════════════════════════════════
@phase2.get("/unread")
async def get_all_unread(request: Request):
    user = await _user(request)
    memberships = await db.server_members.find(
        {"user_id": user["id"], "is_banned": {"$ne": True}}, {"_id": 0, "server_id": 1, "roles": 1}
    ).to_list(100)
    unread = {}
    server_unread = {}
    for m in memberships:
        chs = await _accessible_text_channels(user["id"], m["server_id"], include_private=True)
        member_role_ids = m.get("roles", [])
        for ch in chs:
            rs = await db.read_states.find_one({"user_id": user["id"], "channel_id": ch["id"]}, {"_id": 0})
            last = rs["last_read_at"] if rs else "1970-01-01T00:00:00"
            history_cutoff = await _history_cutoff(user["id"], m["server_id"])
            if history_cutoff and last < history_cutoff:
                last = history_cutoff
            cnt = await db.messages.count_documents({
                "channel_id": ch["id"], "created_at": {"$gt": last},
                "author_id": {"$ne": user["id"]}, "is_deleted": {"$ne": True}
            })
            mention_conditions = [
                {"mention_ids": user["id"]},
                {"mentioned_user_ids": user["id"]},
            ]
            if member_role_ids:
                mention_conditions.append({"mentioned_role_ids": {"$in": member_role_ids}})
            mention_conditions.append({"mentions_everyone": True})
            mcnt = await db.messages.count_documents({
                "channel_id": ch["id"],
                "created_at": {"$gt": last},
                "author_id": {"$ne": user["id"]},
                "is_deleted": {"$ne": True},
                "$or": mention_conditions,
            })
            if cnt > 0:
                unread[ch["id"]] = {"count": cnt, "mentions": mcnt}
                previous_server_unread = server_unread.get(m["server_id"], {"count": 0, "mentions": 0})
                server_unread[m["server_id"]] = {
                    "count": previous_server_unread["count"] + cnt,
                    "mentions": previous_server_unread["mentions"] + mcnt,
                }
    dm_unread = await db.direct_messages.count_documents({"receiver_id": user["id"], "read": False})
    return {"channels": unread, "servers": server_unread, "dm_total": dm_unread}


@phase2.post("/channels/{channel_id}/read")
async def mark_read(channel_id: str, request: Request):
    user = await _user(request)
    await db.read_states.update_one(
        {"user_id": user["id"], "channel_id": channel_id},
        {"$set": {"last_read_at": _now()}}, upsert=True
    )
    return {"ok": True}


# ═══════════════════════════════════════════════════
#  FILE UPLOAD
# ═══════════════════════════════════════════════════
@phase2.post("/upload")
async def upload_file(request: Request):
    user = await _user(request)
    body = await request.json()
    data = body.get("data", "")
    name = body.get("name", "file")
    ftype = body.get("type", "application/octet-stream")
    if len(data) > 14_000_000:
        raise HTTPException(400, "File too large (max 10 MB)")
    fid = _id()
    await db.file_uploads.insert_one({
        "id": fid, "user_id": user["id"], "name": name,
        "type": ftype, "data": data, "created_at": _now()
    })
    return {"id": fid, "name": name, "type": ftype, "url": f"/api/files/{fid}"}


@phase2.get("/files/{file_id}")
async def get_file(file_id: str):
    f = await db.file_uploads.find_one({"id": file_id}, {"_id": 0})
    if not f:
        raise HTTPException(404, "File not found")
    try:
        raw = base64.b64decode(f["data"])
        return RawResponse(
            content=raw, media_type=f.get("type", "application/octet-stream"),
            headers={"Content-Disposition": f'inline; filename="{f["name"]}"'}
        )
    except Exception:
        raise HTTPException(500, "Corrupt file")


# ═══════════════════════════════════════════════════
#  CHANNEL OVERRIDES
# ═══════════════════════════════════════════════════
@phase2.get("/channels/{channel_id}/overrides")
async def get_overrides(channel_id: str, request: Request):
    await _user(request)
    return await db.channel_overrides.find({"channel_id": channel_id}, {"_id": 0}).to_list(50)


@phase2.put("/channels/{channel_id}/overrides")
async def set_override(channel_id: str, inp: ChannelOverrideInput, request: Request):
    user = await _user(request)
    ch = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not ch:
        raise HTTPException(404)
    if not await _has_perm(user["id"], ch["server_id"], "manage_channels"):
        raise HTTPException(403, "No permission")
    await db.channel_overrides.update_one(
        {"channel_id": channel_id, "target_type": inp.target_type, "target_id": inp.target_id},
        {"$set": {"permissions": inp.permissions, "updated_at": _now()}}, upsert=True
    )
    return {"ok": True}


@phase2.delete("/channels/{channel_id}/overrides/{target_type}/{target_id}")
async def del_override(channel_id: str, target_type: str, target_id: str, request: Request):
    user = await _user(request)
    ch = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if ch and not await _has_perm(user["id"], ch["server_id"], "manage_channels"):
        raise HTTPException(403)
    await db.channel_overrides.delete_one(
        {"channel_id": channel_id, "target_type": target_type, "target_id": target_id}
    )
    return {"ok": True}


# ═══════════════════════════════════════════════════
#  PRIVATE ROOM ACCESS
# ═══════════════════════════════════════════════════
@phase2.get("/channels/{channel_id}/access")
async def get_access(channel_id: str, request: Request):
    await _user(request)
    return await db.channel_access.find({"channel_id": channel_id}, {"_id": 0}).to_list(200)


@phase2.put("/channels/{channel_id}/access")
async def set_access(channel_id: str, request: Request):
    user = await _user(request)
    body = await request.json()
    ch = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if ch and not await _has_perm(user["id"], ch["server_id"], "manage_channels"):
        raise HTTPException(403)
    await db.channel_access.delete_many({"channel_id": channel_id})
    docs = []
    for uid in body.get("user_ids", []):
        docs.append({"channel_id": channel_id, "type": "user", "target_id": uid})
    for rid in body.get("role_ids", []):
        docs.append({"channel_id": channel_id, "type": "role", "target_id": rid})
    if docs:
        await db.channel_access.insert_many(docs)
    return {"ok": True}


# ═══════════════════════════════════════════════════
#  TEMPORARY ROOMS
# ═══════════════════════════════════════════════════
@phase2.post("/servers/{server_id}/channels/temp")
async def create_temp(server_id: str, request: Request):
    user = await _user(request)
    body = await request.json()
    ch = {
        "id": _id(), "server_id": server_id,
        "name": body.get("name", f"temp-{_id()[:8]}"),
        "type": body.get("type", "text"),
        "topic": body.get("topic", "Temporary channel"),
        "parent_id": body.get("parent_id"),
        "position": await db.channels.count_documents({"server_id": server_id}),
        "is_private": body.get("is_private", False),
        "is_temporary": True,
        "created_by": user["id"],
        "slowmode_seconds": 0, "created_at": _now()
    }
    await db.channels.insert_one(ch)
    ch.pop("_id", None)
    if ch["type"] == "voice":
        ch["voice_states"] = []
    return ch


# ═══════════════════════════════════════════════════
#  GROUP DMs
# ═══════════════════════════════════════════════════
@phase2.post("/groups")
async def create_group(inp: GroupDMCreate, request: Request):
    user = await _user(request)
    members = list(set([user["id"]] + inp.member_ids))
    g = {
        "id": _id(), "name": inp.name or "Group",
        "members": members, "created_by": user["id"], "created_at": _now()
    }
    await db.group_conversations.insert_one(g)
    g.pop("_id", None)
    info = []
    for mid in members:
        u = await db.users.find_one({"id": mid}, {"_id": 0, "password_hash": 0})
        if u:
            info.append(u)
    g["members_info"] = info
    return g


@phase2.get("/groups")
async def list_groups(request: Request):
    user = await _user(request)
    groups = await db.group_conversations.find({"members": user["id"]}, {"_id": 0}).to_list(50)
    for g in groups:
        info = []
        for mid in g.get("members", []):
            u = await db.users.find_one({"id": mid}, {"_id": 0, "password_hash": 0})
            if u:
                info.append(u)
        g["members_info"] = info
        g["last_message"] = await db.group_messages.find_one(
            {"group_id": g["id"]}, {"_id": 0}, sort=[("created_at", -1)]
        )
    return groups


@phase2.get("/groups/{gid}/messages")
async def group_msgs(gid: str, request: Request, before: str = None, limit: int = 50):
    user = await _user(request)
    grp = await db.group_conversations.find_one({"id": gid, "members": user["id"]}, {"_id": 0})
    if not grp:
        raise HTTPException(404)
    q = {"group_id": gid}
    if before:
        q["created_at"] = {"$lt": before}
    msgs = await db.group_messages.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    msgs.reverse()
    for m in msgs:
        m["sender"] = await db.users.find_one({"id": m["sender_id"]}, {"_id": 0, "password_hash": 0})
    return msgs


@phase2.post("/groups/{gid}/messages")
async def send_group_msg(gid: str, inp: GroupMsgCreate, request: Request):
    user = await _user(request)
    grp = await db.group_conversations.find_one({"id": gid, "members": user["id"]}, {"_id": 0})
    if not grp:
        raise HTTPException(404)
    if inp.is_encrypted:
        device = await _require_verified_device(request, user)
        if not inp.encrypted_content or not inp.nonce or not inp.sender_device_id:
            raise HTTPException(400, "Encrypted group messages require a trusted desktop payload")
        if inp.sender_device_id != device["device_id"]:
            raise HTTPException(400, "Encrypted group messages must originate from the active desktop device")
    m = {
        "id": _id(), "group_id": gid, "sender_id": user["id"],
        "content": inp.content if not inp.is_encrypted else "[encrypted]",
        "encrypted_content": inp.encrypted_content or "",
        "is_encrypted": inp.is_encrypted,
        "attachments": inp.attachments,
        "nonce": inp.nonce or "",
        "sender_device_id": inp.sender_device_id or "",
        "protocol_version": inp.protocol_version or "sv-e2ee-v1",
        "key_envelopes": inp.key_envelopes or [],
        "created_at": _now()
    }
    await db.group_messages.insert_one(m)
    m.pop("_id", None)
    m["sender"] = {k: v for k, v in user.items()}
    return m


@phase2.put("/groups/{gid}/members")
async def update_group_members(gid: str, request: Request):
    user = await _user(request)
    body = await request.json()
    grp = await db.group_conversations.find_one({"id": gid, "members": user["id"]}, {"_id": 0})
    if not grp:
        raise HTTPException(404)
    if body.get("action") == "add":
        await db.group_conversations.update_one({"id": gid}, {"$addToSet": {"members": body["user_id"]}})
    elif body.get("action") == "remove":
        await db.group_conversations.update_one({"id": gid}, {"$pull": {"members": body["user_id"]}})
    return {"ok": True}


# ═══════════════════════════════════════════════════
#  EDIT HISTORY / REVISIONS
# ═══════════════════════════════════════════════════
@phase2.get("/messages/{message_id}/revisions")
async def get_revisions(message_id: str, request: Request):
    await _user(request)
    return await db.message_revisions.find(
        {"message_id": message_id}, {"_id": 0}
    ).sort("edited_at", -1).to_list(50)


# ═══════════════════════════════════════════════════
#  E2EE KEY MANAGEMENT
# ═══════════════════════════════════════════════════
@phase2.post("/keys/bundle")
async def upload_keys(inp: KeyBundleInput, request: Request):
    user = await _user(request)
    await db.key_bundles.update_one(
        {"user_id": user["id"]},
        {"$set": {
            "identity_key": inp.identity_key,
            "signed_pre_key": inp.signed_pre_key,
            "one_time_pre_keys": inp.one_time_pre_keys,
            "updated_at": _now()
        }}, upsert=True
    )
    await db.users.update_one({"id": user["id"]}, {"$set": {"public_key": inp.identity_key}})
    return {"ok": True}


@phase2.get("/keys/{user_id}/bundle")
async def get_keys(user_id: str, request: Request):
    await _user(request)
    bundle = await db.key_bundles.find_one({"user_id": user_id}, {"_id": 0})
    if not bundle:
        raise HTTPException(404, "No key bundle")
    otp = bundle.get("one_time_pre_keys", [])
    consumed = None
    if otp:
        consumed = otp[0]
        await db.key_bundles.update_one({"user_id": user_id}, {"$pop": {"one_time_pre_keys": -1}})
    return {
        "identity_key": bundle.get("identity_key", ""),
        "signed_pre_key": bundle.get("signed_pre_key", ""),
        "one_time_pre_key": consumed
    }


# ═══════════════════════════════════════════════════
#  GDPR: DATA EXPORT
# ═══════════════════════════════════════════════════
@phase2.get("/users/me/export")
async def export_user_data(request: Request):
    """DSGVO Art. 15 / Art. 20 – Auskunft & Datenportabilität.
    Returns all data associated with the requesting user."""
    user = await _user(request)
    uid = user["id"]

    profile = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})

    messages = await db.messages.find(
        {"author_id": uid, "is_deleted": {"$ne": True}}, {"_id": 0}
    ).to_list(10000)

    dms_sent = await db.direct_messages.find({"sender_id": uid}, {"_id": 0}).to_list(10000)
    dms_received = await db.direct_messages.find({"receiver_id": uid}, {"_id": 0}).to_list(10000)

    memberships = await db.server_members.find({"user_id": uid}, {"_id": 0}).to_list(100)
    for m in memberships:
        srv = await db.servers.find_one({"id": m["server_id"]}, {"_id": 0, "name": 1})
        m["server_name"] = srv["name"] if srv else "?"

    group_convos = await db.group_conversations.find({"members": uid}, {"_id": 0}).to_list(100)
    group_msgs = await db.group_messages.find({"sender_id": uid}, {"_id": 0}).to_list(10000)

    read_states = await db.read_states.find({"user_id": uid}, {"_id": 0}).to_list(500)
    files = await db.file_uploads.find({"user_id": uid}, {"_id": 0, "data": 0}).to_list(500)

    return {
        "export_date": _now(),
        "profile": profile,
        "server_memberships": memberships,
        "channel_messages": messages,
        "direct_messages_sent": dms_sent,
        "direct_messages_received": dms_received,
        "group_conversations": group_convos,
        "group_messages_sent": group_msgs,
        "read_states": read_states,
        "file_uploads_metadata": files,
        "_note": "File content excluded for size. Request individual files via /api/files/{id}."
    }


# ═══════════════════════════════════════════════════
#  GDPR: ACCOUNT DELETION
# ═══════════════════════════════════════════════════
@phase2.delete("/users/me")
async def delete_account(request: Request):
    """DSGVO Art. 17 – Recht auf Löschung.

    Deletion policy:
    - Profile: deleted
    - Channel messages: author anonymised, content removed
    - DMs: deleted entirely (both sent & received)
    - Server memberships: removed
    - Roles, voice states, read states: cleaned up
    - Key bundles: deleted
    - File uploads: deleted
    - Group conversations: removed from member list
    - Audit log: actor_id anonymised
    """
    user = await _user(request)
    uid = user["id"]

    # 1. Anonymise channel messages
    await db.messages.update_many(
        {"author_id": uid},
        {"$set": {"author_id": "[deleted]", "content": "[account deleted]", "is_deleted": True, "attachments": []}}
    )

    # 2. Delete DMs
    await db.direct_messages.delete_many({"$or": [{"sender_id": uid}, {"receiver_id": uid}]})

    # 3. Remove from servers
    await db.server_members.delete_many({"user_id": uid})

    # 4. Clean up voice / read / revision data
    await db.voice_states.delete_many({"user_id": uid})
    await db.read_states.delete_many({"user_id": uid})
    await db.message_revisions.update_many({"editor_id": uid}, {"$set": {"editor_id": "[deleted]"}})

    # 5. Delete E2EE keys
    await db.key_bundles.delete_many({"user_id": uid})
    await db.e2ee_accounts.delete_many({"user_id": uid})
    await db.e2ee_devices.delete_many({"user_id": uid})
    await db.e2ee_blob_uploads.delete_many({"user_id": uid})
    await db.e2ee_blobs.delete_many({"uploader_user_id": uid})

    # 6. Delete file uploads
    await db.file_uploads.delete_many({"user_id": uid})
    await db.email_verifications.delete_many({"user_id": uid})

    # 7. Remove from group conversations
    await db.group_conversations.update_many({"members": uid}, {"$pull": {"members": uid}})
    await db.group_messages.update_many({"sender_id": uid}, {"$set": {"sender_id": "[deleted]", "content": "[account deleted]"}})

    # 8. Anonymise audit log
    await db.audit_log.update_many({"actor_id": uid}, {"$set": {"actor_id": "[deleted]"}})

    # 9. Delete user
    await db.users.delete_one({"id": uid})

    # 10. Delete login attempts
    await db.login_attempts.delete_many({"identifier": {"$regex": user.get("email", "")}})

    return {
        "ok": True,
        "deleted": {
            "profile": True,
            "messages": "anonymised",
            "direct_messages": "deleted",
            "memberships": "removed",
            "voice_states": "deleted",
            "e2ee_keys": "deleted",
            "files": "deleted",
            "audit_log": "anonymised"
        }
    }



# ═══════════════════════════════════════════════════
#  STARTUP INDEXES (call from main app)
# ═══════════════════════════════════════════════════
async def create_phase2_indexes():
    await db.read_states.create_index([("user_id", 1), ("channel_id", 1)], unique=True)
    await db.message_revisions.create_index("message_id")
    await db.file_uploads.create_index("id", unique=True)
    await db.channel_overrides.create_index([("channel_id", 1), ("target_type", 1), ("target_id", 1)])
    await db.channel_access.create_index("channel_id")
    await db.group_conversations.create_index("id", unique=True)
    await db.group_messages.create_index([("group_id", 1), ("created_at", -1)])
    await db.key_bundles.create_index("user_id", unique=True)
