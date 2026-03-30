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

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

_client = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = _client[os.environ['DB_NAME']]
_jwt_secret = os.environ.get('JWT_SECRET', '')
_JWT_ALG = "HS256"


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
    member = await db.server_members.find_one({"user_id": user_id, "server_id": server_id}, {"_id": 0})
    if not member or member.get("is_banned"):
        return False
    server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if server and server.get("owner_id") == user_id:
        return True
    for rid in member.get("roles", []):
        role = await db.roles.find_one({"id": rid}, {"_id": 0})
        if role and role.get("permissions", {}).get(perm):
            return True
    return False


def _parse_mentions(content):
    return re.findall(r'@(\w+)', content)


# ──────── Models ────────
class GroupDMCreate(BaseModel):
    name: str = ""
    member_ids: List[str]

class GroupMsgCreate(BaseModel):
    content: str
    encrypted_content: Optional[str] = None
    is_encrypted: bool = False

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
    await _user(request)
    parent = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not parent:
        raise HTTPException(404, "Message not found")
    author = await db.users.find_one({"id": parent["author_id"]}, {"_id": 0, "password_hash": 0})
    parent["author"] = author
    replies = await db.messages.find(
        {"thread_id": message_id, "is_deleted": {"$ne": True}}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)
    for r in replies:
        a = await db.users.find_one({"id": r["author_id"]}, {"_id": 0, "password_hash": 0})
        r["author"] = a
    return {"parent": parent, "replies": replies, "reply_count": len(replies)}


@phase2.post("/channels/{channel_id}/messages/{message_id}/reply")
async def reply_in_thread(channel_id: str, message_id: str, request: Request):
    user = await _user(request)
    body = await request.json()
    content = body.get("content", "").strip()
    if not content:
        raise HTTPException(400, "Content required")
    parent = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not parent:
        raise HTTPException(404, "Parent not found")
    mention_names = _parse_mentions(content)
    mention_ids = []
    for m in mention_names:
        u = await db.users.find_one({"username": m.lower()}, {"_id": 0})
        if u:
            mention_ids.append(u["id"])
    reply = {
        "id": _id(), "channel_id": channel_id, "author_id": user["id"],
        "content": content, "type": "text", "thread_id": message_id,
        "attachments": body.get("attachments", []),
        "edited_at": None, "is_deleted": False, "reactions": {},
        "reply_to_id": message_id, "mention_ids": mention_ids,
        "thread_count": 0, "created_at": _now()
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
    await _user(request)
    if len(q) < 2:
        return []
    query = {"content": {"$regex": q, "$options": "i"}, "is_deleted": {"$ne": True}}
    if channel_id:
        query["channel_id"] = channel_id
    elif server_id:
        chs = await db.channels.find({"server_id": server_id}, {"_id": 0, "id": 1}).to_list(200)
        query["channel_id"] = {"$in": [c["id"] for c in chs]}
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
        {"user_id": user["id"], "is_banned": {"$ne": True}}, {"_id": 0, "server_id": 1}
    ).to_list(100)
    unread = {}
    for m in memberships:
        chs = await db.channels.find({"server_id": m["server_id"], "type": "text"}, {"_id": 0, "id": 1}).to_list(100)
        for ch in chs:
            rs = await db.read_states.find_one({"user_id": user["id"], "channel_id": ch["id"]}, {"_id": 0})
            last = rs["last_read_at"] if rs else "1970-01-01T00:00:00"
            cnt = await db.messages.count_documents({
                "channel_id": ch["id"], "created_at": {"$gt": last},
                "author_id": {"$ne": user["id"]}, "is_deleted": {"$ne": True}
            })
            mcnt = await db.messages.count_documents({
                "channel_id": ch["id"], "created_at": {"$gt": last},
                "mention_ids": user["id"], "is_deleted": {"$ne": True}
            })
            if cnt > 0:
                unread[ch["id"]] = {"count": cnt, "mentions": mcnt}
    dm_unread = await db.direct_messages.count_documents({"receiver_id": user["id"], "read": False})
    return {"channels": unread, "dm_total": dm_unread}


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
    m = {
        "id": _id(), "group_id": gid, "sender_id": user["id"],
        "content": inp.content, "encrypted_content": inp.encrypted_content or "",
        "is_encrypted": inp.is_encrypted, "created_at": _now()
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
