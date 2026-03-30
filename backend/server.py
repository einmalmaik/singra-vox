"""
SovereignVoice Backend - MVP
Privacy-first, self-hosted communication platform
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import (
    FastAPI, APIRouter, Request, Response, HTTPException,
    WebSocket, WebSocketDisconnect, Query
)
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime, timezone, timedelta
import os
import uuid
import logging
import secrets
import asyncio
import bcrypt
import jwt as pyjwt

# ============================================================
# Configuration
# ============================================================
mongo_url = os.environ['MONGO_URL']
db_name = os.environ['DB_NAME']
jwt_secret = os.environ.get('JWT_SECRET', secrets.token_hex(32))
admin_email = os.environ.get('ADMIN_EMAIL', 'admin@sovereignvoice.local')
admin_password = os.environ.get('ADMIN_PASSWORD', 'SV_Admin_2024!')
frontend_url = os.environ.get('FRONTEND_URL', 'http://localhost:3000')

client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="Singra Vox", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url, "http://localhost:3000", "https://sovereign-voice.preview.emergentagent.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# Helpers
# ============================================================
JWT_ALG = "HS256"

def now_utc():
    return datetime.now(timezone.utc).isoformat()

def new_id():
    return str(uuid.uuid4())

def hash_pw(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_pw(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))

def make_access_token(uid: str, email: str) -> str:
    return pyjwt.encode(
        {"sub": uid, "email": email, "exp": datetime.now(timezone.utc) + timedelta(hours=1), "type": "access"},
        jwt_secret, algorithm=JWT_ALG
    )

def make_refresh_token(uid: str) -> str:
    return pyjwt.encode(
        {"sub": uid, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"},
        jwt_secret, algorithm=JWT_ALG
    )

async def current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        ah = request.headers.get("Authorization", "")
        if ah.startswith("Bearer "):
            token = ah[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        p = pyjwt.decode(token, jwt_secret, algorithms=[JWT_ALG])
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

def set_cookies(resp: Response, at: str, rt: str):
    resp.set_cookie("access_token", at, httponly=True, secure=False, samesite="lax", max_age=3600, path="/")
    resp.set_cookie("refresh_token", rt, httponly=True, secure=False, samesite="lax", max_age=604800, path="/")

DEFAULT_PERMISSIONS = {
    "manage_server": False, "manage_channels": False, "manage_roles": False,
    "manage_members": False, "kick_members": False, "ban_members": False,
    "send_messages": True, "read_messages": True, "manage_messages": False,
    "attach_files": True, "mention_everyone": False,
    "join_voice": True, "speak": True, "mute_members": False,
    "deafen_members": False, "priority_speaker": False, "create_invites": True
}

async def check_permission(user_id: str, server_id: str, permission: str) -> bool:
    member = await db.server_members.find_one({"user_id": user_id, "server_id": server_id}, {"_id": 0})
    if not member or member.get("is_banned"):
        return False
    server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if server and server.get("owner_id") == user_id:
        return True
    for role_id in member.get("roles", []):
        role = await db.roles.find_one({"id": role_id}, {"_id": 0})
        if role and role.get("permissions", {}).get(permission):
            return True
    default_role = await db.roles.find_one({"server_id": server_id, "is_default": True}, {"_id": 0})
    if default_role and default_role.get("permissions", {}).get(permission):
        return True
    return DEFAULT_PERMISSIONS.get(permission, False)

async def log_audit(server_id, actor_id, action, target_type, target_id, details):
    await db.audit_log.insert_one({
        "id": new_id(), "server_id": server_id, "actor_id": actor_id,
        "action": action, "target_type": target_type, "target_id": target_id,
        "details": details, "created_at": now_utc()
    })

# ============================================================
# Models
# ============================================================
class RegisterInput(BaseModel):
    email: str
    username: str
    password: str
    display_name: str = ""

class LoginInput(BaseModel):
    email: str
    password: str

class ServerCreateInput(BaseModel):
    name: str
    description: str = ""

class ChannelCreateInput(BaseModel):
    name: str
    type: str = "text"
    topic: str = ""
    parent_id: Optional[str] = None
    is_private: bool = False

class MessageCreateInput(BaseModel):
    content: str
    reply_to_id: Optional[str] = None
    attachments: List[dict] = []

class DMCreateInput(BaseModel):
    content: str
    encrypted_content: Optional[str] = None
    is_encrypted: bool = False
    nonce: Optional[str] = None

class RoleCreateInput(BaseModel):
    name: str
    color: str = "#99AAB5"
    permissions: dict = {}

class InviteCreateInput(BaseModel):
    max_uses: int = 0
    expires_hours: int = 24

class ModerationInput(BaseModel):
    user_id: str
    reason: str = ""
    duration_minutes: int = 0

class ProfileUpdateInput(BaseModel):
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    status: Optional[str] = None

# ============================================================
# WebSocket Manager
# ============================================================
class WSManager:
    def __init__(self):
        self.conns: Dict[str, WebSocket] = {}
        self.user_servers: Dict[str, set] = {}

    async def connect(self, ws: WebSocket, uid: str):
        await ws.accept()
        self.conns[uid] = ws
        members = await db.server_members.find(
            {"user_id": uid, "is_banned": {"$ne": True}}, {"_id": 0, "server_id": 1}
        ).to_list(100)
        self.user_servers[uid] = {m["server_id"] for m in members}
        await db.users.update_one({"id": uid}, {"$set": {"status": "online", "last_seen": now_utc()}})

    def disconnect(self, uid: str):
        self.conns.pop(uid, None)
        self.user_servers.pop(uid, None)

    async def send(self, uid: str, data: dict):
        ws = self.conns.get(uid)
        if ws:
            try:
                await ws.send_json(data)
            except Exception:
                self.disconnect(uid)

    async def broadcast_server(self, sid: str, data: dict, exclude: str = None):
        for uid, svrs in list(self.user_servers.items()):
            if sid in svrs and uid != exclude:
                await self.send(uid, data)

    def add_server(self, uid: str, sid: str):
        if uid in self.user_servers:
            self.user_servers[uid].add(sid)

ws_mgr = WSManager()

# ============================================================
# AUTH ROUTES
# ============================================================
auth_r = APIRouter(prefix="/api/auth", tags=["Auth"])

@auth_r.post("/register")
async def register(inp: RegisterInput, response: Response):
    email = inp.email.lower().strip()
    if await db.users.find_one({"email": email}, {"_id": 0}):
        raise HTTPException(400, "Email already registered")
    if await db.users.find_one({"username": inp.username.lower()}, {"_id": 0}):
        raise HTTPException(400, "Username taken")
    user_count = await db.users.count_documents({})
    uid = new_id()
    user = {
        "id": uid, "email": email, "username": inp.username.lower(),
        "display_name": inp.display_name or inp.username,
        "password_hash": hash_pw(inp.password),
        "avatar_url": "", "status": "online", "public_key": "",
        "role": "admin" if user_count == 0 else "user",
        "created_at": now_utc(), "last_seen": now_utc()
    }
    await db.users.insert_one(user)
    at = make_access_token(uid, email)
    rt = make_refresh_token(uid)
    set_cookies(response, at, rt)
    safe_user = {k: v for k, v in user.items() if k not in ("password_hash", "_id")}
    return {"user": safe_user, "access_token": at}

@auth_r.post("/login")
async def login(inp: LoginInput, request: Request, response: Response):
    email = inp.email.lower().strip()
    ip = request.client.host if request.client else "unknown"
    ident = f"{ip}:{email}"
    attempt = await db.login_attempts.find_one({"identifier": ident}, {"_id": 0})
    if attempt and attempt.get("count", 0) >= 5:
        locked = attempt.get("locked_until", "")
        if locked and datetime.fromisoformat(locked) > datetime.now(timezone.utc):
            raise HTTPException(429, "Too many attempts. Try again later.")
        else:
            await db.login_attempts.delete_one({"identifier": ident})
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not verify_pw(inp.password, user["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": ident},
            {"$inc": {"count": 1}, "$set": {"locked_until": (datetime.now(timezone.utc) + timedelta(minutes=15)).isoformat()}},
            upsert=True
        )
        raise HTTPException(401, "Invalid credentials")
    await db.login_attempts.delete_one({"identifier": ident})
    await db.users.update_one({"id": user["id"]}, {"$set": {"status": "online", "last_seen": now_utc()}})
    at = make_access_token(user["id"], email)
    rt = make_refresh_token(user["id"])
    set_cookies(response, at, rt)
    safe_user = {k: v for k, v in user.items() if k not in ("password_hash", "_id")}
    return {"user": safe_user, "access_token": at}

@auth_r.post("/logout")
async def logout(request: Request, response: Response):
    try:
        user = await current_user(request)
        await db.users.update_one({"id": user["id"]}, {"$set": {"status": "offline", "last_seen": now_utc()}})
    except Exception:
        pass
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}

@auth_r.get("/me")
async def me(request: Request):
    user = await current_user(request)
    at = make_access_token(user["id"], user.get("email", ""))
    return {**user, "access_token": at}

@auth_r.post("/refresh")
async def refresh(request: Request, response: Response):
    rt = request.cookies.get("refresh_token")
    if not rt:
        raise HTTPException(401, "No refresh token")
    try:
        p = pyjwt.decode(rt, jwt_secret, algorithms=[JWT_ALG])
        if p.get("type") != "refresh":
            raise HTTPException(401, "Invalid token")
        user = await db.users.find_one({"id": p["sub"]}, {"_id": 0})
        if not user:
            raise HTTPException(401, "User not found")
        at = make_access_token(user["id"], user["email"])
        response.set_cookie("access_token", at, httponly=True, secure=False, samesite="lax", max_age=3600, path="/")
        return {"ok": True}
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "Refresh token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

# ============================================================
# SETUP ROUTES
# ============================================================
setup_r = APIRouter(prefix="/api/setup", tags=["Setup"])

@setup_r.get("/status")
async def setup_status():
    user_count = await db.users.count_documents({})
    server_count = await db.servers.count_documents({})
    return {"needs_setup": user_count == 0, "needs_server": server_count == 0 and user_count > 0, "has_servers": server_count > 0}

@setup_r.post("/bootstrap")
async def bootstrap(inp: ServerCreateInput, request: Request):
    user = await current_user(request)
    sid = new_id()
    gen_id = new_id()
    voice_id = new_id()
    server = {
        "id": sid, "name": inp.name, "description": inp.description or "",
        "icon_url": "", "owner_id": user["id"], "created_at": now_utc(),
        "settings": {"default_channel_id": gen_id, "allow_invites": True, "retention_days": 0}
    }
    await db.servers.insert_one(server)
    await db.channels.insert_many([
        {"id": gen_id, "server_id": sid, "name": "general", "type": "text", "topic": "General discussion", "parent_id": None, "position": 0, "is_private": False, "slowmode_seconds": 0, "created_at": now_utc()},
        {"id": voice_id, "server_id": sid, "name": "Voice Lounge", "type": "voice", "topic": "", "parent_id": None, "position": 1, "is_private": False, "slowmode_seconds": 0, "created_at": now_utc()},
    ])
    admin_rid = new_id()
    member_rid = new_id()
    await db.roles.insert_many([
        {"id": admin_rid, "server_id": sid, "name": "Admin", "color": "#E74C3C", "permissions": {k: True for k in DEFAULT_PERMISSIONS}, "position": 100, "is_default": False, "created_at": now_utc()},
        {"id": member_rid, "server_id": sid, "name": "Member", "color": "#99AAB5", "permissions": DEFAULT_PERMISSIONS, "position": 0, "is_default": True, "created_at": now_utc()},
    ])
    await db.server_members.insert_one({
        "server_id": sid, "user_id": user["id"], "roles": [admin_rid],
        "nickname": "", "joined_at": now_utc(), "muted_until": None, "is_banned": False, "ban_reason": ""
    })
    server.pop("_id", None)
    return {"server": server}

# ============================================================
# SERVER ROUTES
# ============================================================
servers_r = APIRouter(prefix="/api/servers", tags=["Servers"])

@servers_r.get("")
async def list_servers(request: Request):
    user = await current_user(request)
    memberships = await db.server_members.find({"user_id": user["id"], "is_banned": {"$ne": True}}, {"_id": 0, "server_id": 1}).to_list(100)
    sids = [m["server_id"] for m in memberships]
    if not sids:
        return []
    servers = await db.servers.find({"id": {"$in": sids}}, {"_id": 0}).to_list(100)
    return servers

@servers_r.post("")
async def create_server(inp: ServerCreateInput, request: Request):
    user = await current_user(request)
    sid = new_id()
    gen_id = new_id()
    voice_id = new_id()
    server = {
        "id": sid, "name": inp.name, "description": inp.description or "",
        "icon_url": "", "owner_id": user["id"], "created_at": now_utc(),
        "settings": {"default_channel_id": gen_id, "allow_invites": True, "retention_days": 0}
    }
    await db.servers.insert_one(server)
    await db.channels.insert_many([
        {"id": gen_id, "server_id": sid, "name": "general", "type": "text", "topic": "", "parent_id": None, "position": 0, "is_private": False, "slowmode_seconds": 0, "created_at": now_utc()},
        {"id": voice_id, "server_id": sid, "name": "Voice", "type": "voice", "topic": "", "parent_id": None, "position": 1, "is_private": False, "slowmode_seconds": 0, "created_at": now_utc()},
    ])
    admin_rid = new_id()
    member_rid = new_id()
    await db.roles.insert_many([
        {"id": admin_rid, "server_id": sid, "name": "Admin", "color": "#E74C3C", "permissions": {k: True for k in DEFAULT_PERMISSIONS}, "position": 100, "is_default": False, "created_at": now_utc()},
        {"id": member_rid, "server_id": sid, "name": "Member", "color": "#99AAB5", "permissions": DEFAULT_PERMISSIONS, "position": 0, "is_default": True, "created_at": now_utc()},
    ])
    await db.server_members.insert_one({
        "server_id": sid, "user_id": user["id"], "roles": [admin_rid],
        "nickname": "", "joined_at": now_utc(), "muted_until": None, "is_banned": False, "ban_reason": ""
    })
    server.pop("_id", None)
    return server

@servers_r.get("/{server_id}")
async def get_server(server_id: str, request: Request):
    user = await current_user(request)
    member = await db.server_members.find_one({"server_id": server_id, "user_id": user["id"]}, {"_id": 0})
    if not member or member.get("is_banned"):
        raise HTTPException(403, "Not a member")
    server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if not server:
        raise HTTPException(404, "Server not found")
    return server

@servers_r.put("/{server_id}")
async def update_server(server_id: str, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_server"):
        raise HTTPException(403, "No permission")
    body = await request.json()
    updates = {k: v for k, v in body.items() if k in ("name", "description", "icon_url") and v is not None}
    if updates:
        await db.servers.update_one({"id": server_id}, {"$set": updates})
    return await db.servers.find_one({"id": server_id}, {"_id": 0})

# --- Channels ---
@servers_r.get("/{server_id}/channels")
async def list_channels(server_id: str, request: Request):
    user = await current_user(request)
    member = await db.server_members.find_one({"server_id": server_id, "user_id": user["id"]}, {"_id": 0})
    if not member or member.get("is_banned"):
        raise HTTPException(403, "Not a member")
    channels = await db.channels.find({"server_id": server_id}, {"_id": 0}).sort("position", 1).to_list(100)
    # Add voice states to voice channels
    for ch in channels:
        if ch["type"] == "voice":
            states = await db.voice_states.find({"channel_id": ch["id"]}, {"_id": 0}).to_list(50)
            for s in states:
                u = await db.users.find_one({"id": s["user_id"]}, {"_id": 0, "password_hash": 0})
                s["user"] = u
            ch["voice_states"] = states
    return channels

@servers_r.post("/{server_id}/channels")
async def create_channel(server_id: str, inp: ChannelCreateInput, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_channels"):
        raise HTTPException(403, "No permission")
    ch = {
        "id": new_id(), "server_id": server_id, "name": inp.name.lower().replace(" ", "-"),
        "type": inp.type, "topic": inp.topic or "", "parent_id": inp.parent_id,
        "position": await db.channels.count_documents({"server_id": server_id}),
        "is_private": inp.is_private, "slowmode_seconds": 0, "created_at": now_utc()
    }
    await db.channels.insert_one(ch)
    ch.pop("_id", None)
    if ch["type"] == "voice":
        ch["voice_states"] = []
    await log_audit(server_id, user["id"], "channel_create", "channel", ch["id"], {"name": ch["name"]})
    await ws_mgr.broadcast_server(server_id, {"type": "channel_create", "channel": ch})
    return ch

# --- Members ---
@servers_r.get("/{server_id}/members")
async def list_members(server_id: str, request: Request):
    user = await current_user(request)
    member = await db.server_members.find_one({"server_id": server_id, "user_id": user["id"]}, {"_id": 0})
    if not member:
        raise HTTPException(403, "Not a member")
    members = await db.server_members.find({"server_id": server_id, "is_banned": {"$ne": True}}, {"_id": 0}).to_list(500)
    result = []
    for m in members:
        u = await db.users.find_one({"id": m["user_id"]}, {"_id": 0, "password_hash": 0})
        if u:
            m["user"] = u
            result.append(m)
    return result

@servers_r.put("/{server_id}/members/{user_id}")
async def update_member(server_id: str, user_id: str, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "manage_members"):
        raise HTTPException(403, "No permission")
    body = await request.json()
    updates = {}
    if "roles" in body:
        updates["roles"] = body["roles"]
    if "nickname" in body:
        updates["nickname"] = body["nickname"]
    if updates:
        await db.server_members.update_one({"server_id": server_id, "user_id": user_id}, {"$set": updates})
    return {"ok": True}

@servers_r.delete("/{server_id}/members/{user_id}")
async def kick_member(server_id: str, user_id: str, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "kick_members"):
        raise HTTPException(403, "No permission")
    await db.server_members.delete_one({"server_id": server_id, "user_id": user_id})
    await log_audit(server_id, actor["id"], "member_kick", "user", user_id, {})
    await ws_mgr.broadcast_server(server_id, {"type": "member_kicked", "user_id": user_id})
    return {"ok": True}

# --- Roles ---
@servers_r.get("/{server_id}/roles")
async def list_roles(server_id: str, request: Request):
    await current_user(request)
    return await db.roles.find({"server_id": server_id}, {"_id": 0}).sort("position", -1).to_list(50)

@servers_r.post("/{server_id}/roles")
async def create_role(server_id: str, inp: RoleCreateInput, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_roles"):
        raise HTTPException(403, "No permission")
    role = {
        "id": new_id(), "server_id": server_id, "name": inp.name,
        "color": inp.color, "permissions": {**DEFAULT_PERMISSIONS, **inp.permissions},
        "position": await db.roles.count_documents({"server_id": server_id}),
        "is_default": False, "created_at": now_utc()
    }
    await db.roles.insert_one(role)
    role.pop("_id", None)
    return role

@servers_r.put("/{server_id}/roles/{role_id}")
async def update_role(server_id: str, role_id: str, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_roles"):
        raise HTTPException(403, "No permission")
    body = await request.json()
    updates = {k: v for k, v in body.items() if k in ("name", "color", "permissions", "position")}
    if updates:
        await db.roles.update_one({"id": role_id, "server_id": server_id}, {"$set": updates})
    return await db.roles.find_one({"id": role_id}, {"_id": 0})

@servers_r.delete("/{server_id}/roles/{role_id}")
async def delete_role(server_id: str, role_id: str, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_roles"):
        raise HTTPException(403, "No permission")
    role = await db.roles.find_one({"id": role_id}, {"_id": 0})
    if role and role.get("is_default"):
        raise HTTPException(400, "Cannot delete default role")
    await db.roles.delete_one({"id": role_id})
    return {"ok": True}

# --- Moderation ---
@servers_r.post("/{server_id}/moderation/ban")
async def ban_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "ban_members"):
        raise HTTPException(403, "No permission")
    await db.server_members.update_one(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"is_banned": True, "ban_reason": inp.reason}}
    )
    await log_audit(server_id, actor["id"], "member_ban", "user", inp.user_id, {"reason": inp.reason})
    await ws_mgr.broadcast_server(server_id, {"type": "member_banned", "user_id": inp.user_id})
    return {"ok": True}

@servers_r.post("/{server_id}/moderation/unban")
async def unban_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "ban_members"):
        raise HTTPException(403, "No permission")
    await db.server_members.update_one(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"is_banned": False, "ban_reason": ""}}
    )
    return {"ok": True}

@servers_r.post("/{server_id}/moderation/mute")
async def mute_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "mute_members"):
        raise HTTPException(403, "No permission")
    muted_until = (datetime.now(timezone.utc) + timedelta(minutes=inp.duration_minutes or 10)).isoformat()
    await db.server_members.update_one(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"muted_until": muted_until}}
    )
    await log_audit(server_id, actor["id"], "member_mute", "user", inp.user_id, {"duration": inp.duration_minutes})
    return {"ok": True}

@servers_r.post("/{server_id}/moderation/unmute")
async def unmute_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "mute_members"):
        raise HTTPException(403, "No permission")
    await db.server_members.update_one(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"muted_until": None}}
    )
    return {"ok": True}

@servers_r.get("/{server_id}/moderation/audit-log")
async def get_audit_log(server_id: str, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_server"):
        raise HTTPException(403, "No permission")
    logs = await db.audit_log.find({"server_id": server_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    # Attach actor info
    for log_entry in logs:
        actor = await db.users.find_one({"id": log_entry.get("actor_id")}, {"_id": 0, "password_hash": 0})
        log_entry["actor"] = actor
    return logs

# --- Invites ---
@servers_r.post("/{server_id}/invites")
async def create_invite(server_id: str, inp: InviteCreateInput, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "create_invites"):
        raise HTTPException(403, "No permission")
    code = secrets.token_urlsafe(8)
    invite = {
        "code": code, "server_id": server_id, "creator_id": user["id"],
        "uses": 0, "max_uses": inp.max_uses,
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=inp.expires_hours)).isoformat() if inp.expires_hours else None,
        "created_at": now_utc()
    }
    await db.invites.insert_one(invite)
    invite.pop("_id", None)
    return invite

# --- Voice ---
@servers_r.post("/{server_id}/voice/{channel_id}/join")
async def voice_join(server_id: str, channel_id: str, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "join_voice"):
        raise HTTPException(403, "No permission")
    await db.voice_states.delete_many({"user_id": user["id"]})
    state = {
        "user_id": user["id"], "channel_id": channel_id, "server_id": server_id,
        "is_muted": False, "is_deafened": False, "joined_at": now_utc()
    }
    await db.voice_states.insert_one(state)
    state.pop("_id", None)
    u = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    state["user"] = u
    await ws_mgr.broadcast_server(server_id, {"type": "voice_join", "channel_id": channel_id, "state": state})
    return state

@servers_r.post("/{server_id}/voice/{channel_id}/leave")
async def voice_leave(server_id: str, channel_id: str, request: Request):
    user = await current_user(request)
    await db.voice_states.delete_one({"user_id": user["id"], "channel_id": channel_id})
    await ws_mgr.broadcast_server(server_id, {"type": "voice_leave", "user_id": user["id"], "channel_id": channel_id})
    return {"ok": True}

@servers_r.put("/{server_id}/voice/{channel_id}/state")
async def voice_update_state(server_id: str, channel_id: str, request: Request):
    user = await current_user(request)
    body = await request.json()
    updates = {k: v for k, v in body.items() if k in ("is_muted", "is_deafened")}
    if updates:
        await db.voice_states.update_one({"user_id": user["id"], "channel_id": channel_id}, {"$set": updates})
    state = await db.voice_states.find_one({"user_id": user["id"], "channel_id": channel_id}, {"_id": 0})
    if state:
        await ws_mgr.broadcast_server(server_id, {"type": "voice_state_update", "channel_id": channel_id, "user_id": user["id"], "state": state})
    return state or {"ok": True}

# ============================================================
# CHANNEL ROUTES
# ============================================================
channels_r = APIRouter(prefix="/api/channels", tags=["Channels"])

@channels_r.put("/{channel_id}")
async def update_channel(channel_id: str, request: Request):
    user = await current_user(request)
    ch = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not ch:
        raise HTTPException(404, "Channel not found")
    if not await check_permission(user["id"], ch["server_id"], "manage_channels"):
        raise HTTPException(403, "No permission")
    body = await request.json()
    updates = {k: v for k, v in body.items() if k in ("name", "topic", "is_private", "slowmode_seconds") and v is not None}
    if updates:
        await db.channels.update_one({"id": channel_id}, {"$set": updates})
    return await db.channels.find_one({"id": channel_id}, {"_id": 0})

@channels_r.delete("/{channel_id}")
async def delete_channel(channel_id: str, request: Request):
    user = await current_user(request)
    ch = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not ch:
        raise HTTPException(404, "Channel not found")
    if not await check_permission(user["id"], ch["server_id"], "manage_channels"):
        raise HTTPException(403, "No permission")
    await db.channels.delete_one({"id": channel_id})
    await db.messages.delete_many({"channel_id": channel_id})
    await ws_mgr.broadcast_server(ch["server_id"], {"type": "channel_delete", "channel_id": channel_id})
    return {"ok": True}

@channels_r.get("/{channel_id}/messages")
async def get_messages(channel_id: str, request: Request, before: str = None, limit: int = 50):
    await current_user(request)
    query = {"channel_id": channel_id, "is_deleted": {"$ne": True}}
    if before:
        query["created_at"] = {"$lt": before}
    messages = await db.messages.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    messages.reverse()
    for msg in messages:
        author = await db.users.find_one({"id": msg["author_id"]}, {"_id": 0, "password_hash": 0})
        msg["author"] = author
    return messages

@channels_r.post("/{channel_id}/messages")
async def send_message(channel_id: str, inp: MessageCreateInput, request: Request):
    user = await current_user(request)
    ch = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not ch:
        raise HTTPException(404, "Channel not found")
    if not await check_permission(user["id"], ch["server_id"], "send_messages"):
        raise HTTPException(403, "No permission")
    member = await db.server_members.find_one({"server_id": ch["server_id"], "user_id": user["id"]}, {"_id": 0})
    if member and member.get("muted_until"):
        if datetime.fromisoformat(member["muted_until"]) > datetime.now(timezone.utc):
            raise HTTPException(403, "You are muted")
    import re
    mention_names = re.findall(r'@(\w+)', inp.content)
    mention_ids = []
    for mn in mention_names:
        mu = await db.users.find_one({"username": mn.lower()}, {"_id": 0, "id": 1})
        if mu:
            mention_ids.append(mu["id"])
    msg = {
        "id": new_id(), "channel_id": channel_id, "author_id": user["id"],
        "content": inp.content, "type": "text",
        "attachments": inp.attachments, "edited_at": None,
        "is_deleted": False, "reactions": {},
        "reply_to_id": inp.reply_to_id, "mention_ids": mention_ids,
        "thread_id": None, "thread_count": 0, "created_at": now_utc()
    }
    await db.messages.insert_one(msg)
    msg.pop("_id", None)
    msg["author"] = user
    await ws_mgr.broadcast_server(ch["server_id"], {"type": "new_message", "message": msg, "channel_id": channel_id})
    return msg

# ============================================================
# MESSAGE ROUTES
# ============================================================
messages_r = APIRouter(prefix="/api/messages", tags=["Messages"])

@messages_r.put("/{message_id}")
async def edit_message(message_id: str, request: Request):
    user = await current_user(request)
    body = await request.json()
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Message not found")
    if msg["author_id"] != user["id"]:
        raise HTTPException(403, "Not your message")
    old_content = msg["content"]
    new_content = body.get("content", old_content)
    await db.messages.update_one({"id": message_id}, {"$set": {"content": new_content, "edited_at": now_utc()}})
    await db.message_revisions.insert_one({
        "id": new_id(), "message_id": message_id, "content": old_content,
        "editor_id": user["id"], "edited_at": now_utc()
    })
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    msg["author"] = user
    ch = await db.channels.find_one({"id": msg["channel_id"]}, {"_id": 0})
    if ch:
        await ws_mgr.broadcast_server(ch["server_id"], {"type": "message_edit", "message": msg})
    return msg

@messages_r.delete("/{message_id}")
async def delete_message(message_id: str, request: Request):
    user = await current_user(request)
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Message not found")
    ch = await db.channels.find_one({"id": msg["channel_id"]}, {"_id": 0})
    is_author = msg["author_id"] == user["id"]
    can_manage = ch and await check_permission(user["id"], ch["server_id"], "manage_messages")
    if not is_author and not can_manage:
        raise HTTPException(403, "No permission")
    await db.messages.update_one({"id": message_id}, {"$set": {"is_deleted": True, "content": "[deleted]"}})
    if ch:
        await ws_mgr.broadcast_server(ch["server_id"], {"type": "message_delete", "message_id": message_id, "channel_id": msg["channel_id"]})
    return {"ok": True}

@messages_r.post("/{message_id}/reactions/{emoji}")
async def toggle_reaction(message_id: str, emoji: str, request: Request):
    user = await current_user(request)
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404)
    reactions = msg.get("reactions", {})
    if emoji not in reactions:
        reactions[emoji] = []
    if user["id"] in reactions[emoji]:
        reactions[emoji].remove(user["id"])
        if not reactions[emoji]:
            del reactions[emoji]
    else:
        reactions[emoji].append(user["id"])
    await db.messages.update_one({"id": message_id}, {"$set": {"reactions": reactions}})
    return {"reactions": reactions}

# ============================================================
# DM ROUTES
# ============================================================
dm_r = APIRouter(prefix="/api/dm", tags=["DM"])

@dm_r.get("/conversations")
async def dm_conversations(request: Request):
    user = await current_user(request)
    pipeline = [
        {"$match": {"$or": [{"sender_id": user["id"]}, {"receiver_id": user["id"]}]}},
        {"$sort": {"created_at": -1}},
        {"$group": {
            "_id": {"$cond": [{"$eq": ["$sender_id", user["id"]]}, "$receiver_id", "$sender_id"]},
            "last_message": {"$first": "$$ROOT"},
            "unread_count": {"$sum": {"$cond": [
                {"$and": [{"$eq": ["$receiver_id", user["id"]]}, {"$eq": ["$read", False]}]}, 1, 0
            ]}}
        }}
    ]
    convos = await db.direct_messages.aggregate(pipeline).to_list(100)
    result = []
    for c in convos:
        other_user = await db.users.find_one({"id": c["_id"]}, {"_id": 0, "password_hash": 0})
        if other_user:
            last_msg = c["last_message"]
            last_msg.pop("_id", None)
            result.append({"user": other_user, "last_message": last_msg, "unread_count": c["unread_count"]})
    return result

@dm_r.get("/{other_user_id}")
async def get_dm_messages(other_user_id: str, request: Request, before: str = None, limit: int = 50):
    user = await current_user(request)
    query = {"$or": [
        {"sender_id": user["id"], "receiver_id": other_user_id},
        {"sender_id": other_user_id, "receiver_id": user["id"]}
    ]}
    if before:
        query["created_at"] = {"$lt": before}
    messages = await db.direct_messages.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    messages.reverse()
    await db.direct_messages.update_many(
        {"sender_id": other_user_id, "receiver_id": user["id"], "read": False},
        {"$set": {"read": True}}
    )
    for msg in messages:
        sender = await db.users.find_one({"id": msg["sender_id"]}, {"_id": 0, "password_hash": 0})
        msg["sender"] = sender
    return messages

@dm_r.post("/{other_user_id}")
async def send_dm(other_user_id: str, inp: DMCreateInput, request: Request):
    user = await current_user(request)
    other = await db.users.find_one({"id": other_user_id}, {"_id": 0})
    if not other:
        raise HTTPException(404, "User not found")
    msg = {
        "id": new_id(), "sender_id": user["id"], "receiver_id": other_user_id,
        "content": inp.content, "encrypted_content": inp.encrypted_content or "",
        "is_encrypted": inp.is_encrypted, "nonce": inp.nonce or "",
        "attachments": [], "read": False, "created_at": now_utc()
    }
    await db.direct_messages.insert_one(msg)
    msg.pop("_id", None)
    msg["sender"] = {k: v for k, v in user.items() if k != "password_hash"}
    await ws_mgr.send(other_user_id, {"type": "dm_message", "message": msg})
    return msg

# ============================================================
# INVITE ROUTES
# ============================================================
invites_r = APIRouter(prefix="/api/invites", tags=["Invites"])

@invites_r.get("/{code}")
async def get_invite(code: str):
    invite = await db.invites.find_one({"code": code}, {"_id": 0})
    if not invite:
        raise HTTPException(404, "Invite not found")
    if invite.get("expires_at") and datetime.fromisoformat(invite["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(410, "Invite expired")
    if invite.get("max_uses") and invite["uses"] >= invite["max_uses"]:
        raise HTTPException(410, "Invite exhausted")
    server = await db.servers.find_one({"id": invite["server_id"]}, {"_id": 0})
    return {"invite": invite, "server": server}

@invites_r.post("/{code}/accept")
async def accept_invite(code: str, request: Request):
    user = await current_user(request)
    invite = await db.invites.find_one({"code": code}, {"_id": 0})
    if not invite:
        raise HTTPException(404, "Invite not found")
    if invite.get("expires_at") and datetime.fromisoformat(invite["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(410, "Invite expired")
    existing = await db.server_members.find_one({"server_id": invite["server_id"], "user_id": user["id"]}, {"_id": 0})
    if existing:
        if existing.get("is_banned"):
            raise HTTPException(403, "You are banned")
        return {"ok": True, "server_id": invite["server_id"]}
    default_role = await db.roles.find_one({"server_id": invite["server_id"], "is_default": True}, {"_id": 0})
    await db.server_members.insert_one({
        "server_id": invite["server_id"], "user_id": user["id"],
        "roles": [default_role["id"]] if default_role else [],
        "nickname": "", "joined_at": now_utc(), "muted_until": None, "is_banned": False, "ban_reason": ""
    })
    await db.invites.update_one({"code": code}, {"$inc": {"uses": 1}})
    ws_mgr.add_server(user["id"], invite["server_id"])
    await ws_mgr.broadcast_server(invite["server_id"], {"type": "member_joined", "user": {k: v for k, v in user.items()}})
    return {"ok": True, "server_id": invite["server_id"]}

# ============================================================
# USER ROUTES
# ============================================================
users_r = APIRouter(prefix="/api/users", tags=["Users"])

@users_r.get("/search")
async def search_users(request: Request, q: str = ""):
    await current_user(request)
    if len(q) < 2:
        return []
    return await db.users.find(
        {"$or": [{"username": {"$regex": q, "$options": "i"}}, {"display_name": {"$regex": q, "$options": "i"}}]},
        {"_id": 0, "password_hash": 0}
    ).to_list(20)

@users_r.get("/{user_id}")
async def get_user_profile(user_id: str, request: Request):
    await current_user(request)
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(404, "User not found")
    return user

@users_r.put("/me")
async def update_profile(inp: ProfileUpdateInput, request: Request):
    user = await current_user(request)
    updates = {k: v for k, v in inp.model_dump().items() if v is not None}
    if updates:
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
    return await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})

@users_r.post("/me/public-key")
async def set_public_key(request: Request):
    user = await current_user(request)
    body = await request.json()
    await db.users.update_one({"id": user["id"]}, {"$set": {"public_key": body.get("public_key", "")}})
    return {"ok": True}

@users_r.get("/{user_id}/public-key")
async def get_public_key(user_id: str, request: Request):
    await current_user(request)
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404)
    return {"public_key": user.get("public_key", "")}

# ============================================================
# Include All Routers
# ============================================================
app.include_router(auth_r)
app.include_router(setup_r)
app.include_router(servers_r)
app.include_router(channels_r)
app.include_router(messages_r)
app.include_router(dm_r)
app.include_router(invites_r)
app.include_router(users_r)

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Singra Vox"}

# Phase 2 routes
from routes_phase2 import phase2, create_phase2_indexes
app.include_router(phase2)

# ============================================================
# WebSocket
# ============================================================
@app.websocket("/api/ws")
async def ws_endpoint(websocket: WebSocket, token: str = Query(None)):
    ws_token = token
    if not ws_token:
        ws_token = websocket.cookies.get("access_token")
    if not ws_token:
        await websocket.close(code=4001)
        return
    try:
        p = pyjwt.decode(ws_token, jwt_secret, algorithms=[JWT_ALG])
        uid = p["sub"]
        user = await db.users.find_one({"id": uid}, {"_id": 0})
        if not user:
            await websocket.close(code=4001)
            return
    except Exception:
        await websocket.close(code=4001)
        return
    await ws_mgr.connect(websocket, uid)
    try:
        while True:
            data = await websocket.receive_json()
            if data.get("type") == "typing":
                ch = await db.channels.find_one({"id": data.get("channel_id")}, {"_id": 0})
                if ch:
                    await ws_mgr.broadcast_server(ch["server_id"], {
                        "type": "typing", "user_id": uid, "channel_id": data["channel_id"],
                        "username": user.get("display_name", user.get("username", ""))
                    }, exclude=uid)
            elif data.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            # ── WebRTC Voice Signaling (P2P relay) ──
            elif data.get("type") in ("voice_offer", "voice_answer", "voice_ice"):
                target = data.get("target_user_id")
                if target:
                    await ws_mgr.send(target, {
                        "type": data["type"],
                        "from_user_id": uid,
                        "sdp": data.get("sdp"),
                        "candidate": data.get("candidate"),
                    })
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WS error: {e}")
    finally:
        ws_mgr.disconnect(uid)
        await db.users.update_one({"id": uid}, {"$set": {"status": "offline", "last_seen": now_utc()}})
        await db.voice_states.delete_many({"user_id": uid})

# ============================================================
# Startup
# ============================================================
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("username")
    await db.users.create_index("id", unique=True)
    await db.servers.create_index("id", unique=True)
    await db.channels.create_index("id", unique=True)
    await db.channels.create_index("server_id")
    await db.messages.create_index("id", unique=True)
    await db.messages.create_index([("channel_id", 1), ("created_at", -1)])
    await db.direct_messages.create_index("id", unique=True)
    await db.direct_messages.create_index([("sender_id", 1), ("receiver_id", 1), ("created_at", -1)])
    await db.server_members.create_index([("server_id", 1), ("user_id", 1)], unique=True)
    await db.roles.create_index("id", unique=True)
    await db.invites.create_index("code", unique=True)
    await db.voice_states.create_index("user_id")
    await db.audit_log.create_index([("server_id", 1), ("created_at", -1)])
    await db.login_attempts.create_index("identifier")
    await create_phase2_indexes()

    admin_exists = await db.users.find_one({"email": admin_email}, {"_id": 0})
    if not admin_exists:
        uid = new_id()
        await db.users.insert_one({
            "id": uid, "email": admin_email, "username": "admin",
            "display_name": "Admin", "password_hash": hash_pw(admin_password),
            "avatar_url": "", "status": "offline", "public_key": "",
            "role": "admin", "created_at": now_utc(), "last_seen": now_utc()
        })
        logger.info(f"Admin seeded: {admin_email}")
    elif not verify_pw(admin_password, admin_exists.get("password_hash", "")):
        await db.users.update_one({"email": admin_email}, {"$set": {"password_hash": hash_pw(admin_password)}})

    Path("/app/memory").mkdir(exist_ok=True)
    with open("/app/memory/test_credentials.md", "w") as f:
        f.write(f"# Test Credentials\n\n## Admin\n- Email: {admin_email}\n- Password: {admin_password}\n- Role: admin\n\n")
        f.write("## Auth Endpoints\n- POST /api/auth/register\n- POST /api/auth/login\n- POST /api/auth/logout\n- GET /api/auth/me\n- POST /api/auth/refresh\n")

    logger.info("Singra Vox backend started")

@app.on_event("shutdown")
async def shutdown():
    client.close()
