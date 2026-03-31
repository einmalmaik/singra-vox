"""
Singra Vox – Phase 3 Routes
Message Pinning, Notifications, Custom Emoji, Webhooks, Bot Tokens
"""
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pathlib import Path
import os
import uuid
import secrets
import re
import jwt as pyjwt

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

_c = AsyncIOMotorClient(os.environ['MONGO_URL'])
db = _c[os.environ['DB_NAME']]
_jwt = os.environ.get('JWT_SECRET', '')

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
        p = pyjwt.decode(token, _jwt, algorithms=["HS256"])
        if p.get("type") != "access":
            raise HTTPException(401, "Invalid token")
        u = await db.users.find_one({"id": p["sub"]}, {"_id": 0})
        if not u:
            raise HTTPException(401, "User not found")
        u.pop("password_hash", None)
        return u
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

async def _perm(uid, sid, perm):
    m = await db.server_members.find_one({"user_id": uid, "server_id": sid}, {"_id": 0})
    if not m or m.get("is_banned"):
        return False
    s = await db.servers.find_one({"id": sid}, {"_id": 0})
    if s and s.get("owner_id") == uid:
        return True
    for rid in m.get("roles", []):
        r = await db.roles.find_one({"id": rid}, {"_id": 0})
        if r and r.get("permissions", {}).get(perm):
            return True
    return False


# ── Helper: create notification ──
async def _notify(user_id, ntype, title, body, link=None, from_user_id=None):
    await db.notifications.insert_one({
        "id": _id(), "user_id": user_id, "type": ntype,
        "title": title, "body": body, "link": link or "",
        "from_user_id": from_user_id, "read": False,
        "created_at": _now()
    })


phase3 = APIRouter(prefix="/api", tags=["Phase3"])

# ═══════════════════════════════════════════════════
#  MESSAGE PINNING
# ═══════════════════════════════════════════════════
@phase3.post("/messages/{message_id}/pin")
async def pin_message(message_id: str, request: Request):
    user = await _user(request)
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Message not found")
    ch = await db.channels.find_one({"id": msg["channel_id"]}, {"_id": 0})
    if not ch:
        raise HTTPException(404)
    if not await _perm(user["id"], ch["server_id"], "pin_messages"):
        if not await _perm(user["id"], ch["server_id"], "manage_messages"):
            raise HTTPException(403, "No permission to pin")
    await db.messages.update_one({"id": message_id}, {"$set": {"is_pinned": True, "pinned_by": user["id"], "pinned_at": _now()}})
    return {"ok": True}

@phase3.delete("/messages/{message_id}/pin")
async def unpin_message(message_id: str, request: Request):
    user = await _user(request)
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404)
    ch = await db.channels.find_one({"id": msg["channel_id"]}, {"_id": 0})
    if ch and not await _perm(user["id"], ch["server_id"], "pin_messages"):
        if not await _perm(user["id"], ch["server_id"], "manage_messages"):
            raise HTTPException(403)
    await db.messages.update_one({"id": message_id}, {"$set": {"is_pinned": False, "pinned_by": None, "pinned_at": None}})
    return {"ok": True}

@phase3.get("/channels/{channel_id}/pins")
async def get_pins(channel_id: str, request: Request):
    user = await _user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel or not await _perm(user["id"], channel["server_id"], "read_messages"):
        raise HTTPException(403, "No permission")
    pins = await db.messages.find(
        {"channel_id": channel_id, "is_pinned": True, "is_deleted": {"$ne": True}}, {"_id": 0}
    ).sort("pinned_at", -1).to_list(50)
    for p in pins:
        p["author"] = await db.users.find_one({"id": p["author_id"]}, {"_id": 0, "password_hash": 0})
    return pins

# ═══════════════════════════════════════════════════
#  CHANNEL TOPIC INLINE EDIT
# ═══════════════════════════════════════════════════
@phase3.put("/channels/{channel_id}/topic")
async def update_topic(channel_id: str, request: Request):
    user = await _user(request)
    body = await request.json()
    ch = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not ch:
        raise HTTPException(404)
    if not await _perm(user["id"], ch["server_id"], "manage_channels"):
        raise HTTPException(403)
    topic = body.get("topic", "")
    await db.channels.update_one({"id": channel_id}, {"$set": {"topic": topic}})
    return {"ok": True, "topic": topic}

# ═══════════════════════════════════════════════════
#  NOTIFICATIONS
# ═══════════════════════════════════════════════════
@phase3.get("/notifications")
async def get_notifications(request: Request, limit: int = 50, unread_only: bool = False):
    user = await _user(request)
    q = {"user_id": user["id"]}
    if unread_only:
        q["read"] = False
    notifs = await db.notifications.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for n in notifs:
        if n.get("from_user_id"):
            n["from_user"] = await db.users.find_one({"id": n["from_user_id"]}, {"_id": 0, "password_hash": 0})
    unread_count = await db.notifications.count_documents({"user_id": user["id"], "read": False})
    return {"notifications": notifs, "unread_count": unread_count}

@phase3.post("/notifications/{notif_id}/read")
async def mark_notif_read(notif_id: str, request: Request):
    user = await _user(request)
    await db.notifications.update_one({"id": notif_id, "user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}

@phase3.post("/notifications/read-all")
async def mark_all_read(request: Request):
    user = await _user(request)
    await db.notifications.update_many({"user_id": user["id"], "read": False}, {"$set": {"read": True}})
    return {"ok": True}

@phase3.delete("/notifications/{notif_id}")
async def delete_notif(notif_id: str, request: Request):
    user = await _user(request)
    await db.notifications.delete_one({"id": notif_id, "user_id": user["id"]})
    return {"ok": True}

# ═══════════════════════════════════════════════════
#  CUSTOM EMOJI
# ═══════════════════════════════════════════════════
@phase3.post("/servers/{server_id}/emojis")
async def upload_emoji(server_id: str, request: Request):
    user = await _user(request)
    if not await _perm(user["id"], server_id, "manage_emojis"):
        if not await _perm(user["id"], server_id, "manage_server"):
            raise HTTPException(403, "No permission")
    body = await request.json()
    name = body.get("name", "").strip().lower().replace(" ", "_")
    data = body.get("data", "")
    if not name or not data:
        raise HTTPException(400, "Name and image data required")
    if len(name) > 32:
        raise HTTPException(400, "Emoji name too long (max 32)")
    if len(data) > 350_000:
        raise HTTPException(400, "Image too large (max ~256KB)")
    existing = await db.server_emojis.count_documents({"server_id": server_id})
    if existing >= 50:
        raise HTTPException(400, "Emoji limit reached (50)")
    if await db.server_emojis.find_one({"server_id": server_id, "name": name}):
        raise HTTPException(400, "Emoji name already exists")
    eid = _id()
    await db.server_emojis.insert_one({
        "id": eid, "server_id": server_id, "name": name,
        "data": data, "uploaded_by": user["id"], "created_at": _now()
    })
    return {"id": eid, "name": name, "url": f"/api/emojis/{eid}"}

@phase3.get("/servers/{server_id}/emojis")
async def list_emojis(server_id: str, request: Request):
    await _user(request)
    emojis = await db.server_emojis.find(
        {"server_id": server_id}, {"_id": 0, "data": 0}
    ).to_list(100)
    for e in emojis:
        e["url"] = f"/api/emojis/{e['id']}"
    return emojis

@phase3.get("/emojis/{emoji_id}")
async def get_emoji_image(emoji_id: str):
    e = await db.server_emojis.find_one({"id": emoji_id}, {"_id": 0})
    if not e:
        raise HTTPException(404)
    import base64
    from fastapi.responses import Response as RawResp
    try:
        raw = base64.b64decode(e["data"])
        return RawResp(content=raw, media_type="image/png",
                       headers={"Cache-Control": "public, max-age=31536000, immutable"})
    except Exception:
        raise HTTPException(500)

@phase3.delete("/servers/{server_id}/emojis/{emoji_id}")
async def delete_emoji(server_id: str, emoji_id: str, request: Request):
    user = await _user(request)
    if not await _perm(user["id"], server_id, "manage_emojis"):
        if not await _perm(user["id"], server_id, "manage_server"):
            raise HTTPException(403)
    await db.server_emojis.delete_one({"id": emoji_id, "server_id": server_id})
    return {"ok": True}

# ═══════════════════════════════════════════════════
#  WEBHOOKS
# ═══════════════════════════════════════════════════
@phase3.post("/servers/{server_id}/webhooks")
async def create_webhook(server_id: str, request: Request):
    user = await _user(request)
    if not await _perm(user["id"], server_id, "manage_webhooks"):
        if not await _perm(user["id"], server_id, "manage_server"):
            raise HTTPException(403)
    body = await request.json()
    channel_id = body.get("channel_id")
    if not channel_id:
        raise HTTPException(400, "channel_id required")
    token = secrets.token_urlsafe(32)
    wh = {
        "id": _id(), "server_id": server_id, "channel_id": channel_id,
        "name": body.get("name", "Webhook"),
        "avatar_url": body.get("avatar_url", ""),
        "token": token, "enabled": True,
        "created_by": user["id"], "created_at": _now(),
        "last_used": None, "use_count": 0
    }
    await db.webhooks.insert_one(wh)
    wh.pop("_id", None)
    return wh

@phase3.get("/servers/{server_id}/webhooks")
async def list_webhooks(server_id: str, request: Request):
    user = await _user(request)
    if not await _perm(user["id"], server_id, "manage_webhooks"):
        if not await _perm(user["id"], server_id, "manage_server"):
            raise HTTPException(403)
    whs = await db.webhooks.find({"server_id": server_id}, {"_id": 0}).to_list(50)
    return whs

@phase3.put("/servers/{server_id}/webhooks/{wh_id}")
async def update_webhook(server_id: str, wh_id: str, request: Request):
    user = await _user(request)
    if not await _perm(user["id"], server_id, "manage_webhooks"):
        if not await _perm(user["id"], server_id, "manage_server"):
            raise HTTPException(403)
    body = await request.json()
    updates = {k: v for k, v in body.items() if k in ("name", "avatar_url", "enabled", "channel_id")}
    if updates:
        await db.webhooks.update_one({"id": wh_id, "server_id": server_id}, {"$set": updates})
    return await db.webhooks.find_one({"id": wh_id}, {"_id": 0})

@phase3.delete("/servers/{server_id}/webhooks/{wh_id}")
async def delete_webhook(server_id: str, wh_id: str, request: Request):
    user = await _user(request)
    if not await _perm(user["id"], server_id, "manage_webhooks"):
        if not await _perm(user["id"], server_id, "manage_server"):
            raise HTTPException(403)
    await db.webhooks.delete_one({"id": wh_id, "server_id": server_id})
    return {"ok": True}

# External webhook execution – NO AUTH, uses token
@phase3.post("/webhooks/exec/{token}")
async def exec_webhook(token: str, request: Request):
    wh = await db.webhooks.find_one({"token": token}, {"_id": 0})
    if not wh:
        raise HTTPException(404, "Webhook not found")
    if not wh.get("enabled"):
        raise HTTPException(403, "Webhook disabled")
    # Rate limit: max 30 per minute
    recent = await db.webhook_logs.count_documents({
        "webhook_id": wh["id"],
        "created_at": {"$gt": (datetime.now(timezone.utc) - __import__('datetime').timedelta(minutes=1)).isoformat()}
    })
    if recent >= 30:
        raise HTTPException(429, "Rate limit exceeded (30/min)")
    body = await request.json()
    content = body.get("content", "")
    if not content:
        raise HTTPException(400, "content required")
    msg = {
        "id": _id(), "channel_id": wh["channel_id"], "author_id": f"webhook:{wh['id']}",
        "content": content, "type": "webhook",
        "attachments": body.get("attachments", []),
        "edited_at": None, "is_deleted": False, "reactions": {},
        "reply_to_id": None, "mention_ids": [],
        "thread_id": None, "thread_count": 0,
        "webhook_name": body.get("username") or wh.get("name", "Webhook"),
        "webhook_avatar": body.get("avatar_url") or wh.get("avatar_url", ""),
        "created_at": _now()
    }
    await db.messages.insert_one(msg)
    msg.pop("_id", None)
    await db.webhooks.update_one({"id": wh["id"]}, {"$set": {"last_used": _now()}, "$inc": {"use_count": 1}})
    await db.webhook_logs.insert_one({"webhook_id": wh["id"], "created_at": _now()})
    return {"ok": True, "message_id": msg["id"]}

# ═══════════════════════════════════════════════════
#  BOT TOKENS
# ═══════════════════════════════════════════════════
@phase3.post("/servers/{server_id}/bot-tokens")
async def create_bot_token(server_id: str, request: Request):
    user = await _user(request)
    if not await _perm(user["id"], server_id, "manage_server"):
        raise HTTPException(403)
    body = await request.json()
    token = f"svbot_{secrets.token_urlsafe(48)}"
    bt = {
        "id": _id(), "server_id": server_id,
        "name": body.get("name", "Bot"),
        "token": token,
        "permissions": body.get("permissions", {"send_messages": True, "read_messages": True}),
        "created_by": user["id"], "created_at": _now()
    }
    await db.bot_tokens.insert_one(bt)
    bt.pop("_id", None)
    return bt

@phase3.get("/servers/{server_id}/bot-tokens")
async def list_bot_tokens(server_id: str, request: Request):
    user = await _user(request)
    if not await _perm(user["id"], server_id, "manage_server"):
        raise HTTPException(403)
    tokens = await db.bot_tokens.find({"server_id": server_id}, {"_id": 0}).to_list(20)
    for t in tokens:
        t["token"] = t["token"][:12] + "..." # Mask token in list
    return tokens

@phase3.delete("/servers/{server_id}/bot-tokens/{token_id}")
async def delete_bot_token(server_id: str, token_id: str, request: Request):
    user = await _user(request)
    if not await _perm(user["id"], server_id, "manage_server"):
        raise HTTPException(403)
    await db.bot_tokens.delete_one({"id": token_id, "server_id": server_id})
    return {"ok": True}

# ═══════════════════════════════════════════════════
#  STARTUP INDEXES
# ═══════════════════════════════════════════════════
async def create_phase3_indexes():
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.notifications.create_index("id", unique=True)
    await db.server_emojis.create_index([("server_id", 1), ("name", 1)], unique=True)
    await db.server_emojis.create_index("id", unique=True)
    await db.webhooks.create_index("id", unique=True)
    await db.webhooks.create_index("token", unique=True)
    await db.webhook_logs.create_index([("webhook_id", 1), ("created_at", -1)])
    await db.bot_tokens.create_index("id", unique=True)
    await db.bot_tokens.create_index("token", unique=True)
