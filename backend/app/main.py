"""
Singra Vox backend application.
"""
import base64
import binascii
import json
from pathlib import Path
import asyncio
from datetime import datetime, timezone, timedelta
import hashlib
import logging
import os
import re
import secrets
import uuid

from dotenv import load_dotenv
from fastapi import (
    APIRouter,
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import Response as RawResponse
from fastapi.middleware.cors import CORSMiddleware
from livekit import api as livekit_api
from motor.motor_asyncio import AsyncIOMotorClient
import jwt as pyjwt
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from typing import Any, Dict, List, Optional
from app.auth_service import (
    AuthConfig,
    build_access_token,
    clear_auth_cookies,
    create_auth_session,
    get_request_token,
    hash_password,
    load_active_session,
    load_current_user,
    normalize_client_platform,
    normalize_jwt_secret,
    revoke_session,
    revoke_user_sessions,
    set_auth_cookies,
    verify_password,
    refresh_auth_session,
    list_user_sessions,
)
from app.emailing import render_password_reset_email, render_verification_email, send_email
from app.blob_storage import ensure_bucket, get_blob, put_blob
from app.permissions import (
    DEFAULT_PERMISSIONS,
    build_viewer_context,
    get_channel_permissions,
    get_message_history_cutoff as get_permission_history_cutoff,
    has_channel_permission,
    has_server_permission,
)
from app.pagination import clamp_page_limit
from app.rate_limits import enforce_fixed_window_rate_limit
from app.voice_access import build_voice_capabilities
from app.ws import ws_mgr

ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

# ============================================================
# Configuration
# ============================================================
mongo_url = os.environ["MONGO_URL"]
db_name = os.environ["DB_NAME"]
jwt_secret = normalize_jwt_secret(os.environ.get("JWT_SECRET", secrets.token_hex(32)))
cookie_secure = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
livekit_url = os.environ.get("LIVEKIT_URL", "").strip()
livekit_api_key = os.environ.get("LIVEKIT_API_KEY", "").strip()
livekit_api_secret = os.environ.get("LIVEKIT_API_SECRET", "").strip()
# Public URL clients (browsers/apps) use to connect to LiveKit.
# Falls back to LIVEKIT_URL when not explicitly set.
livekit_public_url = os.environ.get("LIVEKIT_PUBLIC_URL", "").strip() or livekit_url
default_frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000").strip()
configured_cors = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", default_frontend_url).split(",")
    if origin.strip()
]
default_dev_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "tauri://localhost",
    "http://tauri.localhost",
]
allow_origins = list(dict.fromkeys(configured_cors + default_dev_origins))
INSTANCE_SETTINGS_ID = "instance:primary"
OWNER_ROLE = "owner"
ADMIN_ROLE = "admin"
USER_ROLE = "user"
EMAIL_VERIFICATION_TTL_MINUTES = int(os.environ.get("EMAIL_VERIFICATION_TTL_MINUTES", "15"))
EMAIL_VERIFICATION_PURPOSE = "verify_email"
PASSWORD_RESET_TTL_MINUTES = int(os.environ.get("PASSWORD_RESET_TTL_MINUTES", "15"))
PASSWORD_RESET_PURPOSE = "password_reset"
EMAIL_VERIFICATION_CODE_LENGTH = 6
E2EE_PROTOCOL_VERSION = "sv-e2ee-v1"
E2EE_DEVICE_HEADER = "X-Singra-Device-Id"
MAX_E2EE_BLOB_BYTES = int(os.environ.get("MAX_E2EE_BLOB_BYTES", str(50 * 1024 * 1024)))
USERNAME_PATTERN = re.compile(r"^[a-z0-9_]{3,32}$")

client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = FastAPI(title="Singra Vox", version="1.0.0")
app.state.auth_config = AuthConfig(jwt_secret=jwt_secret, cookie_secure=cookie_secure)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
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
    return hash_password(password)


def verify_pw(plain: str, hashed: str) -> bool:
    valid, _ = verify_password(plain, hashed)
    return valid


def normalize_username(value: str) -> str:
    normalized = value.lower().strip()
    if not USERNAME_PATTERN.fullmatch(normalized):
        raise HTTPException(
            400,
            "Username must be 3-32 characters and only contain lowercase letters, numbers and underscores",
        )
    return normalized


def hash_verification_code(*, email: str, purpose: str, code: str) -> str:
    payload = f"{jwt_secret}:{email.lower().strip()}:{purpose}:{code}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def generate_numeric_code(length: int = EMAIL_VERIFICATION_CODE_LENGTH) -> str:
    digits = "0123456789"
    return "".join(secrets.choice(digits) for _ in range(length))

def make_access_token(uid: str, email: str, session_id: str) -> str:
    return build_access_token(user_id=uid, email=email, session_id=session_id, jwt_secret=jwt_secret)


def sanitize_user(user: dict) -> dict:
    safe_user = dict(user)
    safe_user.pop("_id", None)
    safe_user.pop("password_hash", None)
    legacy_role = safe_user.get("role")
    if not safe_user.get("instance_role"):
        safe_user["instance_role"] = OWNER_ROLE if legacy_role == OWNER_ROLE else (ADMIN_ROLE if legacy_role == ADMIN_ROLE else USER_ROLE)
    if "email_verified" not in safe_user:
        safe_user["email_verified"] = True
    return safe_user


async def current_user(request: Request) -> dict:
    user, _session = await load_current_user(db, request)
    return sanitize_user(user)


def set_cookies(resp: Response, at: str, rt: str):
    set_auth_cookies(response=resp, access_token=at, refresh_token=rt, cookie_secure=cookie_secure)


async def get_instance_settings() -> dict:
    settings = await db.instance_settings.find_one({"id": INSTANCE_SETTINGS_ID}, {"_id": 0})
    if settings:
        return settings
    return {
        "id": INSTANCE_SETTINGS_ID,
        "initialized": False,
        "instance_name": "",
        "owner_user_id": None,
        "allow_open_signup": False,
        "server_count": 0,
    }


async def require_instance_initialized() -> dict:
    settings = await get_instance_settings()
    if not settings.get("initialized"):
        raise HTTPException(409, "Instance setup required")
    return settings


async def require_instance_admin(user: dict) -> dict:
    if user.get("instance_role") not in {OWNER_ROLE, ADMIN_ROLE}:
        raise HTTPException(403, "Instance admin required")
    return user


async def require_instance_owner(user: dict) -> dict:
    if user.get("instance_role") != OWNER_ROLE:
        raise HTTPException(403, "Instance owner required")
    return user

async def check_permission(user_id: str, server_id: str, permission: str, *, channel: Optional[dict] = None) -> bool:
    if channel is not None:
        return await has_channel_permission(db, user_id, channel, permission)
    return await has_server_permission(db, user_id, server_id, permission)


async def get_message_history_cutoff(user_id: str, server_id: str, *, channel: Optional[dict] = None) -> Optional[str]:
    return await get_permission_history_cutoff(db, user_id, server_id, channel=channel)

async def log_audit(server_id, actor_id, action, target_type, target_id, details):
    await db.audit_log.insert_one({
        "id": new_id(), "server_id": server_id, "actor_id": actor_id,
        "action": action, "target_type": target_type, "target_id": target_id,
        "details": details, "created_at": now_utc()
    })


async def ensure_unique_identity(email: str, username: str):
    if await db.users.find_one({"email": email}, {"_id": 0}):
        raise HTTPException(400, "Email already registered")
    if await db.users.find_one({"username": username}, {"_id": 0}):
        raise HTTPException(400, "Username taken")


def email_verification_required_detail(email: str) -> dict:
    return {
        "code": "email_verification_required",
        "message": "Verify your email before signing in",
        "email": email,
    }


def session_closed_payload(reason: str) -> dict:
    return {
        "type": "session_revoked",
        "reason": reason,
    }


async def issue_email_verification(user: dict) -> dict:
    return await issue_auth_code(
        user=user,
        purpose=EMAIL_VERIFICATION_PURPOSE,
        expires_minutes=EMAIL_VERIFICATION_TTL_MINUTES,
        email_renderer=render_verification_email,
    )


async def issue_password_reset(user: dict) -> dict:
    return await issue_auth_code(
        user=user,
        purpose=PASSWORD_RESET_PURPOSE,
        expires_minutes=PASSWORD_RESET_TTL_MINUTES,
        email_renderer=render_password_reset_email,
    )


async def issue_auth_code(
    *,
    user: dict,
    purpose: str,
    expires_minutes: int,
    email_renderer,
) -> dict:
    code = generate_numeric_code()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)).isoformat()
    email = user["email"].lower().strip()
    await db.email_verifications.delete_many({
        "user_id": user["id"],
        "purpose": purpose,
    })
    await db.email_verifications.insert_one({
        "id": new_id(),
        "user_id": user["id"],
        "email": email,
        "purpose": purpose,
        "code_hash": hash_verification_code(
            email=email,
            purpose=purpose,
            code=code,
        ),
        "expires_at": expires_at,
        "created_at": now_utc(),
    })

    settings = await get_instance_settings()
    subject, text_body, html_body = email_renderer(
        app_name="Singra Vox",
        instance_name=settings.get("instance_name") or "Singra Vox",
        code=code,
        expires_minutes=expires_minutes,
    )
    await send_email(
        to_email=email,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )
    return {"email": email, "expires_at": expires_at}


async def get_server_member(server_id: str, user_id: str) -> Optional[dict]:
    return await db.server_members.find_one(
        {"server_id": server_id, "user_id": user_id},
        {"_id": 0},
    )


def auth_response_for_user(user: dict, *, session_id: str, refresh_token: str) -> dict:
    safe_user = sanitize_user(user)
    access_token = make_access_token(safe_user["id"], safe_user["email"], session_id)
    return {
        "user": safe_user,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "session_id": session_id,
    }


async def issue_auth_response(user: dict, request: Request, response: Response) -> dict:
    session, access_token, refresh_token = await create_auth_session(
        db,
        user=user,
        request=request,
        auth_config=app.state.auth_config,
        device_id=request_device_id(request),
    )
    payload = auth_response_for_user(
        user,
        session_id=session["session_id"],
        refresh_token=refresh_token,
    )
    set_cookies(response, access_token, refresh_token)
    return payload


async def list_member_server_ids(user_id: str) -> List[str]:
    memberships = await db.server_members.find(
        {"user_id": user_id, "is_banned": {"$ne": True}},
        {"_id": 0, "server_id": 1},
    ).to_list(500)
    return [membership["server_id"] for membership in memberships]


async def build_member_payload(server_id: str, user_id: str) -> Optional[dict]:
    member = await db.server_members.find_one(
        {"server_id": server_id, "user_id": user_id, "is_banned": {"$ne": True}},
        {"_id": 0},
    )
    if not member:
        return None

    member_user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not member_user:
        return None

    member["user"] = sanitize_user(member_user)
    return member


async def delete_server_cascade(server_id: str):
    channels = await db.channels.find({"server_id": server_id}, {"_id": 0, "id": 1}).to_list(2000)
    channel_ids = [channel["id"] for channel in channels]

    if channel_ids:
        messages = await db.messages.find({"channel_id": {"$in": channel_ids}}, {"_id": 0, "id": 1}).to_list(5000)
        message_ids = [message["id"] for message in messages]
        if message_ids:
            await db.message_revisions.delete_many({"message_id": {"$in": message_ids}})
        await db.messages.delete_many({"channel_id": {"$in": channel_ids}})
        await db.channel_access.delete_many({"channel_id": {"$in": channel_ids}})
        await db.channel_overrides.delete_many({"channel_id": {"$in": channel_ids}})
        await db.voice_states.delete_many({"channel_id": {"$in": channel_ids}})
        await db.read_states.delete_many({"channel_id": {"$in": channel_ids}})
        await db.webhooks.delete_many({"channel_id": {"$in": channel_ids}})
        await db.webhook_logs.delete_many({"channel_id": {"$in": channel_ids}})

    await db.audit_log.delete_many({"server_id": server_id})
    await db.notifications.delete_many({"server_id": server_id})
    await db.server_emojis.delete_many({"server_id": server_id})
    await db.bot_tokens.delete_many({"server_id": server_id})
    await db.invites.delete_many({"server_id": server_id})
    await db.roles.delete_many({"server_id": server_id})
    await db.server_members.delete_many({"server_id": server_id})
    await db.channels.delete_many({"server_id": server_id})
    await db.servers.delete_one({"id": server_id})


def request_device_id(request: Request) -> Optional[str]:
    return (request.headers.get(E2EE_DEVICE_HEADER) or "").strip() or None


def redact_e2ee_fields(message: dict) -> dict:
    safe = dict(message)
    safe.pop("_id", None)
    return safe


def decode_base64_bytes(value: str, *, field_name: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(400, f"Invalid base64 payload for {field_name}") from exc


async def get_e2ee_account(user_id: str) -> Optional[dict]:
    return await db.e2ee_accounts.find_one({"user_id": user_id}, {"_id": 0})


async def get_device_record(user_id: str, device_id: str) -> Optional[dict]:
    return await db.e2ee_devices.find_one(
        {"user_id": user_id, "device_id": device_id},
        {"_id": 0},
    )


async def require_verified_device(request: Request, user: dict) -> dict:
    device_id = request_device_id(request)
    if not device_id:
        raise HTTPException(428, "E2EE device header required for end-to-end encryption")
    device = await get_device_record(user["id"], device_id)
    if not device or device.get("revoked_at"):
        raise HTTPException(428, "Verified desktop device required for end-to-end encryption")
    if not device.get("verified_at"):
        raise HTTPException(428, "This E2EE device is not verified yet")
    return device


def sanitize_device_record(device: dict) -> dict:
    safe = dict(device)
    safe.pop("_id", None)
    return safe


async def build_e2ee_state(user_id: str, current_device_id: Optional[str]) -> dict:
    account = await get_e2ee_account(user_id)
    devices = await db.e2ee_devices.find(
        {"user_id": user_id},
        {"_id": 0},
    ).sort("created_at", 1).to_list(50)
    current_device = None
    if current_device_id:
        current_device = next((device for device in devices if device["device_id"] == current_device_id), None)
    return {
        "enabled": bool(account),
        "account": account,
        "devices": [sanitize_device_record(device) for device in devices],
        "current_device": sanitize_device_record(current_device) if current_device else None,
    }


async def list_channel_recipient_user_ids(channel: dict) -> List[str]:
    members = await db.server_members.find(
        {"server_id": channel["server_id"], "is_banned": {"$ne": True}},
        {"_id": 0, "user_id": 1, "roles": 1},
    ).to_list(500)
    access_entries = await db.channel_access.find(
        {"channel_id": channel["id"]},
        {"_id": 0},
    ).to_list(500)

    if not channel.get("is_private") or not access_entries:
        return [member["user_id"] for member in members]

    allowed_users = set()
    allowed_roles = {
        entry["target_id"]
        for entry in access_entries
        if entry.get("type") == "role"
    }
    for entry in access_entries:
        if entry.get("type") == "user":
            allowed_users.add(entry["target_id"])

    for member in members:
        if member["user_id"] in allowed_users:
            continue
        if allowed_roles.intersection(member.get("roles") or []):
            allowed_users.add(member["user_id"])

    server = await db.servers.find_one({"id": channel["server_id"]}, {"_id": 0, "owner_id": 1})
    if server and server.get("owner_id"):
        allowed_users.add(server["owner_id"])

    return list(allowed_users)


async def list_active_voice_participant_user_ids(channel_id: str) -> List[str]:
    """
    Return the current voice participants for a channel as the authoritative
    audience for encrypted media keys.

    Media keys must only be distributable to devices that are actively present
    in the voice channel. Otherwise a user who already left or got kicked could
    keep a still-valid room key and continue to decrypt the SFU media stream.
    """
    states = await db.voice_states.find({"channel_id": channel_id}, {"_id": 0, "user_id": 1}).to_list(200)
    return sorted({state["user_id"] for state in states if state.get("user_id")})


async def ensure_private_channel_member_access(user_id: str, channel: dict) -> None:
    if not channel.get("is_private"):
        return
    required_permission = "join_voice" if channel.get("type") == "voice" else "read_messages"
    if not await has_channel_permission(db, user_id, channel, required_permission):
        raise HTTPException(403, "No access to this private channel")


async def list_group_recipient_user_ids(group_id: str) -> List[str]:
    group = await db.group_conversations.find_one({"id": group_id}, {"_id": 0, "members": 1})
    if not group:
        raise HTTPException(404, "Group conversation not found")
    return list(group.get("members") or [])


async def build_e2ee_recipient_payload(user_ids: List[str]) -> dict:
    normalized_ids = sorted({user_id for user_id in user_ids if user_id})
    recipients = []
    for recipient_id in normalized_ids:
        account = await get_e2ee_account(recipient_id)
        devices = await db.e2ee_devices.find(
            {
                "user_id": recipient_id,
                "verified_at": {"$ne": None},
                "revoked_at": None,
            },
            {"_id": 0},
        ).to_list(50)
        recipients.append({
            "user_id": recipient_id,
            "recovery_public_key": account.get("recovery_public_key") if account else None,
            "devices": [
                {
                    "device_id": device["device_id"],
                    "device_name": device.get("device_name", ""),
                    "public_key": device["public_key"],
                    "verified_at": device.get("verified_at"),
                }
                for device in devices
            ],
        })
    return {
        "protocol_version": E2EE_PROTOCOL_VERSION,
        "recipients": recipients,
    }


async def authorize_blob_access(user: dict, blob_record: dict) -> None:
    scope_kind = blob_record.get("scope_kind")
    scope_id = blob_record.get("scope_id")

    if scope_kind == "dm":
        participants = blob_record.get("participant_user_ids") or []
        if user["id"] not in participants:
            raise HTTPException(403, "No access to this encrypted attachment")
        return

    if scope_kind == "group":
        participants = await list_group_recipient_user_ids(scope_id)
        if user["id"] not in participants:
            raise HTTPException(403, "No access to this encrypted attachment")
        return

    if scope_kind == "channel":
        channel = await db.channels.find_one({"id": scope_id}, {"_id": 0})
        if not channel:
            raise HTTPException(404, "Channel not found")
        if not await check_permission(user["id"], channel["server_id"], "read_messages", channel=channel):
            raise HTTPException(403, "No access to this encrypted attachment")
        await ensure_private_channel_member_access(user["id"], channel)
        return

    raise HTTPException(400, "Unsupported encrypted attachment scope")


async def hydrate_message_mentions(message: dict) -> dict:
    message["mentions_everyone"] = bool(message.get("mentions_everyone"))

    user_ids = list(dict.fromkeys(message.get("mentioned_user_ids") or message.get("mention_ids") or []))
    role_ids = list(dict.fromkeys(message.get("mentioned_role_ids") or []))

    if user_ids:
        mentioned_users = await db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "password_hash": 0, "id": 1, "username": 1, "display_name": 1},
        ).to_list(len(user_ids))
        mentioned_users_by_id = {entry["id"]: sanitize_user(entry) for entry in mentioned_users}
        message["mentioned_users"] = [
            mentioned_users_by_id[user_id]
            for user_id in user_ids
            if user_id in mentioned_users_by_id
        ]
    else:
        message["mentioned_users"] = []

    if role_ids:
        mentioned_roles = await db.roles.find(
            {"id": {"$in": role_ids}},
            {"_id": 0, "id": 1, "name": 1, "color": 1, "mentionable": 1, "is_default": 1},
        ).to_list(len(role_ids))
        mentioned_roles_by_id = {entry["id"]: entry for entry in mentioned_roles}
        message["mentioned_roles"] = [
            mentioned_roles_by_id[role_id]
            for role_id in role_ids
            if role_id in mentioned_roles_by_id
        ]
    else:
        message["mentioned_roles"] = []

    return message


async def resolve_message_mentions(
    *,
    server_id: str,
    actor_id: str,
    channel: Optional[dict] = None,
    content: str,
    mentioned_user_ids: Optional[List[str]] = None,
    mentioned_role_ids: Optional[List[str]] = None,
    mentions_everyone: bool = False,
) -> dict:
    member_docs = await db.server_members.find(
        {"server_id": server_id, "is_banned": {"$ne": True}},
        {"_id": 0, "user_id": 1, "roles": 1},
    ).to_list(2000)
    member_map = {member["user_id"]: member for member in member_docs}

    can_mention_everyone = await check_permission(actor_id, server_id, "mention_everyone", channel=channel)

    valid_user_ids: List[str] = []
    provided_user_ids = list(dict.fromkeys(mentioned_user_ids or []))
    if provided_user_ids:
        valid_user_ids = [user_id for user_id in provided_user_ids if user_id in member_map and user_id != actor_id]
    else:
        import re
        fallback_names = re.findall(r'@(\w+)', content or "")
        if fallback_names:
            matching_users = await db.users.find(
                {"username": {"$in": [entry.lower() for entry in fallback_names]}},
                {"_id": 0, "id": 1, "username": 1},
            ).to_list(len(fallback_names))
            username_map = {entry["username"]: entry["id"] for entry in matching_users}
            valid_user_ids = [
                username_map[name.lower()]
                for name in fallback_names
                if username_map.get(name.lower()) in member_map and username_map.get(name.lower()) != actor_id
            ]
        valid_user_ids = list(dict.fromkeys(valid_user_ids))

    provided_role_ids = list(dict.fromkeys(mentioned_role_ids or []))
    valid_role_ids: List[str] = []
    if provided_role_ids:
        server_roles = await db.roles.find(
            {"server_id": server_id, "id": {"$in": provided_role_ids}},
            {"_id": 0, "id": 1, "mentionable": 1, "is_default": 1},
        ).to_list(len(provided_role_ids))
        roles_by_id = {role["id"]: role for role in server_roles}
        for role_id in provided_role_ids:
            role = roles_by_id.get(role_id)
            if not role:
                continue
            if role.get("is_default"):
                if can_mention_everyone:
                    mentions_everyone = True
                continue
            if role.get("mentionable") or can_mention_everyone:
                valid_role_ids.append(role_id)

    normalized_everyone = bool(mentions_everyone)
    lowered_content = (content or "").lower()
    if ("@everyone" in lowered_content or "@here" in lowered_content) and can_mention_everyone:
        normalized_everyone = True
    if normalized_everyone and not can_mention_everyone:
        normalized_everyone = False

    notification_targets = set(valid_user_ids)
    if valid_role_ids:
        for member in member_docs:
            if any(role_id in (member.get("roles") or []) for role_id in valid_role_ids):
                notification_targets.add(member["user_id"])
    if normalized_everyone:
        notification_targets.update(member_map.keys())
    notification_targets.discard(actor_id)

    return {
        "mentioned_user_ids": valid_user_ids,
        "mentioned_role_ids": valid_role_ids,
        "mentions_everyone": normalized_everyone,
        "notify_user_ids": list(notification_targets),
    }


async def create_default_server(owner: dict, name: str, description: str = "") -> dict:
    sid = new_id()
    general_channel_id = new_id()
    voice_channel_id = new_id()
    server = {
        "id": sid,
        "name": name,
        "description": description or "",
        "icon_url": "",
        "owner_id": owner["id"],
        "created_at": now_utc(),
        "settings": {
            "default_channel_id": general_channel_id,
            "allow_invites": True,
            "retention_days": 0,
        },
    }
    await db.servers.insert_one(server)
    await db.channels.insert_many([
        {
            "id": general_channel_id,
            "server_id": sid,
            "name": "general",
            "type": "text",
            "topic": "General discussion",
            "parent_id": None,
            "position": 0,
            "is_private": False,
            "slowmode_seconds": 0,
            "created_at": now_utc(),
        },
        {
            "id": voice_channel_id,
            "server_id": sid,
            "name": "Voice",
            "type": "voice",
            "topic": "",
            "parent_id": None,
            "position": 1,
            "is_private": False,
            "slowmode_seconds": 0,
            "created_at": now_utc(),
        },
    ])
    admin_role_id = new_id()
    member_role_id = new_id()
    await db.roles.insert_many([
        {
            "id": admin_role_id,
            "server_id": sid,
            "name": "Admin",
            "color": "#E74C3C",
            "permissions": {key: True for key in DEFAULT_PERMISSIONS},
            "position": 100,
            "is_default": False,
            "mentionable": False,
            "created_at": now_utc(),
        },
        {
            "id": member_role_id,
            "server_id": sid,
            "name": "@everyone",
            "color": "#99AAB5",
            "permissions": DEFAULT_PERMISSIONS,
            "position": 0,
            "is_default": True,
            "mentionable": False,
            "created_at": now_utc(),
        },
    ])
    await db.server_members.insert_one({
        "server_id": sid,
        "user_id": owner["id"],
        "roles": [admin_role_id],
        "nickname": "",
        "joined_at": now_utc(),
        "muted_until": None,
        "is_banned": False,
        "ban_reason": "",
    })
    return server

# ============================================================
# Models
# ============================================================
class RegisterInput(BaseModel):
    email: str
    username: str
    password: str = Field(min_length=8, max_length=256)
    display_name: str = ""

class LoginInput(BaseModel):
    email: str
    password: str


class RefreshInput(BaseModel):
    refresh_token: Optional[str] = None


class VerifyEmailInput(BaseModel):
    email: str
    code: str = Field(min_length=4, max_length=8)


class ResendVerificationInput(BaseModel):
    email: str


class ForgotPasswordInput(BaseModel):
    email: str


class ResetPasswordInput(BaseModel):
    email: str
    code: str = Field(min_length=4, max_length=8)
    new_password: str = Field(min_length=8, max_length=256)


class PasswordChangeInput(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=256)


class BootstrapInput(BaseModel):
    instance_name: str = Field(min_length=2, max_length=80)
    owner_email: str
    owner_username: str
    owner_password: str = Field(min_length=8, max_length=256)
    owner_display_name: str = Field(min_length=1, max_length=80)
    allow_open_signup: bool = True


class InstanceAdminUpdateInput(BaseModel):
    user_id: str

class ServerCreateInput(BaseModel):
    name: str
    description: str = ""

class ChannelCreateInput(BaseModel):
    name: str
    type: str = "text"
    topic: str = ""
    parent_id: Optional[str] = None
    is_private: bool = False


class ChannelReorderItem(BaseModel):
    id: str
    parent_id: Optional[str] = None
    position: int


class ChannelReorderInput(BaseModel):
    items: List[ChannelReorderItem]

class MessageCreateInput(BaseModel):
    content: str = ""
    reply_to_id: Optional[str] = None
    attachments: List[dict] = []
    mentioned_user_ids: List[str] = []
    mentioned_role_ids: List[str] = []
    mentions_everyone: bool = False
    is_e2ee: bool = False
    ciphertext: Optional[str] = None
    nonce: Optional[str] = None
    sender_device_id: Optional[str] = None
    protocol_version: str = E2EE_PROTOCOL_VERSION
    message_type: str = "text"
    key_envelopes: List[dict] = []

class DMCreateInput(BaseModel):
    content: str = ""
    encrypted_content: Optional[str] = None
    is_encrypted: bool = False
    nonce: Optional[str] = None
    attachments: List[dict] = []
    is_e2ee: bool = False
    ciphertext: Optional[str] = None
    sender_device_id: Optional[str] = None
    protocol_version: str = E2EE_PROTOCOL_VERSION
    message_type: str = "text"
    key_envelopes: List[dict] = []


class E2EEBootstrapInput(BaseModel):
    device_id: str
    device_name: str = Field(min_length=2, max_length=80)
    device_public_key: str
    recovery_public_key: str
    encrypted_recovery_private_key: str
    recovery_salt: str
    recovery_nonce: str


class E2EEDeviceInput(BaseModel):
    device_id: str
    device_name: str = Field(min_length=2, max_length=80)
    device_public_key: str


class EncryptedBlobInitInput(BaseModel):
    scope_kind: str
    scope_id: str
    participant_user_ids: List[str] = []


class EncryptedBlobContentInput(BaseModel):
    ciphertext_b64: str
    sha256: str
    size_bytes: int = Field(gt=0, le=MAX_E2EE_BLOB_BYTES)
    content_type: str = "application/octet-stream"


class EncryptedMediaKeyInput(BaseModel):
    sender_device_id: str
    key_version: str
    participant_user_ids: List[str] = []
    key_envelopes: List[dict]

class RoleCreateInput(BaseModel):
    name: str
    color: str = "#99AAB5"
    permissions: dict = {}
    mentionable: bool = False

class InviteCreateInput(BaseModel):
    max_uses: int = Field(default=0, ge=0)
    expires_hours: int = Field(default=24, ge=0)

class ModerationInput(BaseModel):
    user_id: str
    reason: str = ""
    duration_minutes: int = 0


class OwnershipTransferInput(BaseModel):
    user_id: str

class ProfileUpdateInput(BaseModel):
    username: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    status: Optional[str] = None


class VoiceTokenInput(BaseModel):
    server_id: str
    channel_id: str

async def log_status_history(user_id: str, status: str):
    await db.status_history.insert_one({
        "id": new_id(),
        "user_id": user_id,
        "status": status,
        "created_at": now_utc()
    })

# ============================================================
# Presence
# ============================================================
async def broadcast_presence_update(user_id: str):
    member_user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not member_user:
        return

    payload = {
        "type": "presence_update",
        "user_id": user_id,
        "user": sanitize_user(member_user),
    }
    member_server_ids = set(await list_member_server_ids(user_id))
    if not member_server_ids:
        return

    # Presence is scoped to mutual communities, but a user can share more than
    # one server with the same recipient. We de-duplicate the fan-out here so
    # clients do not receive the same presence packet once per shared server.
    recipient_ids = [
        uid
        for uid, server_ids in list(ws_mgr.user_servers.items())
        if member_server_ids.intersection(server_ids)
    ]
    for recipient_id in recipient_ids:
        await ws_mgr.send(recipient_id, payload)


async def clear_voice_membership(
    user_id: str,
    *,
    server_id: Optional[str] = None,
    channel_id: Optional[str] = None,
    force_reason: Optional[str] = None,
):
    query = {"user_id": user_id}
    if server_id:
        query["server_id"] = server_id
    if channel_id:
        query["channel_id"] = channel_id

    states = await db.voice_states.find(query, {"_id": 0}).to_list(20)
    if not states:
        return

    await db.voice_states.delete_many(query)
    for state in states:
        await ws_mgr.broadcast_server(
            state["server_id"],
            {
                "type": "voice_leave",
                "server_id": state["server_id"],
                "channel_id": state["channel_id"],
                "user_id": user_id,
            },
        )

    if force_reason:
        await ws_mgr.send(
            user_id,
            {
                "type": "voice_force_leave",
                "server_id": server_id or states[0]["server_id"],
                "channel_id": channel_id or states[0]["channel_id"],
                "reason": force_reason,
            },
        )

# ============================================================
# AUTH ROUTES
# ============================================================
auth_r = APIRouter(prefix="/api/auth", tags=["Auth"])

@auth_r.post("/register")
async def register(inp: RegisterInput, response: Response):
    settings = await require_instance_initialized()
    if not settings.get("allow_open_signup", True):
        raise HTTPException(403, "Open signup is disabled")
    email = inp.email.lower().strip()
    username = normalize_username(inp.username)
    await ensure_unique_identity(email, username)
    uid = new_id()
    user = {
        "id": uid, "email": email, "username": username,
        "display_name": inp.display_name or inp.username,
        "password_hash": hash_pw(inp.password),
        "avatar_url": "", "status": "offline", "public_key": "",
        "role": USER_ROLE, "instance_role": USER_ROLE,
        "email_verified": False,
        "email_verified_at": None,
        "created_at": now_utc(), "last_seen": now_utc()
    }
    await db.users.insert_one(user)
    try:
        verification_state = await issue_email_verification(user)
    except Exception:
        await db.users.delete_one({"id": uid})
        raise HTTPException(503, "Verification email could not be sent")
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {
        "ok": True,
        "verification_required": True,
        "email": verification_state["email"],
        "expires_at": verification_state["expires_at"],
    }

@auth_r.post("/login")
async def login(inp: LoginInput, request: Request, response: Response):
    await require_instance_initialized()
    email = inp.email.lower().strip()
    ip = request.client.host if request.client else "unknown"
    await enforce_fixed_window_rate_limit(
        db,
        scope="auth.login",
        key=f"{ip}:{email}",
        limit=5,
        window_seconds=15 * 60,
        error_message="Too many login attempts. Try again later.",
        code="login_rate_limited",
    )
    user = await db.users.find_one({"email": email}, {"_id": 0})
    valid_password = False
    needs_rehash = False
    if user:
        valid_password, needs_rehash = verify_password(inp.password, user["password_hash"])
    if not user or not valid_password:
        raise HTTPException(401, "Invalid credentials")
    if not user.get("email_verified", True):
        raise HTTPException(403, email_verification_required_detail(email))
    if needs_rehash:
        upgraded_hash = hash_pw(inp.password)
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"password_hash": upgraded_hash}},
        )
        user["password_hash"] = upgraded_hash
    await db.users.update_one({"id": user["id"]}, {"$set": {"status": "online", "last_seen": now_utc()}})
    await log_status_history(user["id"], "online")
    auth_payload = await issue_auth_response(user, request, response)
    await broadcast_presence_update(user["id"])
    return auth_payload


@auth_r.post("/verify-email")
async def verify_email(inp: VerifyEmailInput, request: Request, response: Response):
    email = inp.email.lower().strip()
    await enforce_fixed_window_rate_limit(
        db,
        scope="auth.verify_email",
        key=f"{request.client.host if request.client else 'unknown'}:{email}",
        limit=10,
        window_seconds=15 * 60,
        error_message="Too many verification attempts. Try again later.",
        code="verify_email_rate_limited",
    )
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        raise HTTPException(404, "Account not found")

    if user.get("email_verified", True):
        raise HTTPException(400, "Email is already verified")

    verification = await db.email_verifications.find_one(
        {"user_id": user["id"], "purpose": EMAIL_VERIFICATION_PURPOSE},
        {"_id": 0},
    )
    if not verification:
        raise HTTPException(400, "No verification code available")
    if datetime.fromisoformat(verification["expires_at"]) <= datetime.now(timezone.utc):
        await db.email_verifications.delete_one({"id": verification["id"]})
        raise HTTPException(410, "Verification code expired")

    expected_hash = hash_verification_code(
        email=email,
        purpose=EMAIL_VERIFICATION_PURPOSE,
        code=inp.code.strip(),
    )
    if expected_hash != verification.get("code_hash"):
        raise HTTPException(400, "Invalid verification code")

    verified_at = now_utc()
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"email_verified": True, "email_verified_at": verified_at, "status": "online", "last_seen": verified_at}},
    )
    await log_status_history(user["id"], "online")
    await db.email_verifications.delete_many({"user_id": user["id"], "purpose": EMAIL_VERIFICATION_PURPOSE})

    verified_user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    auth_payload = await issue_auth_response(verified_user, request, response)
    await broadcast_presence_update(verified_user["id"])
    return auth_payload


@auth_r.post("/resend-verification")
async def resend_verification(inp: ResendVerificationInput, request: Request):
    email = inp.email.lower().strip()
    await enforce_fixed_window_rate_limit(
        db,
        scope="auth.resend_verification",
        key=f"{request.client.host if request.client else 'unknown'}:{email}",
        limit=5,
        window_seconds=15 * 60,
        error_message="Too many verification requests. Try again later.",
        code="resend_verification_rate_limited",
    )
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        return {"ok": True}
    if user.get("email_verified", True):
        return {"ok": True, "already_verified": True}

    try:
        verification_state = await issue_email_verification(user)
    except Exception:
        raise HTTPException(503, "Verification email could not be sent")

    return {
        "ok": True,
        "email": verification_state["email"],
        "expires_at": verification_state["expires_at"],
    }


@auth_r.post("/forgot-password")
async def forgot_password(inp: ForgotPasswordInput, request: Request):
    email = inp.email.lower().strip()
    await enforce_fixed_window_rate_limit(
        db,
        scope="auth.forgot_password",
        key=f"{request.client.host if request.client else 'unknown'}:{email}",
        limit=5,
        window_seconds=15 * 60,
        error_message="Too many password reset requests. Try again later.",
        code="forgot_password_rate_limited",
    )
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user or not user.get("email_verified", True):
        return {"ok": True}

    try:
        reset_state = await issue_password_reset(user)
    except Exception:
        logger.exception("Failed to issue password reset for %s", email)
        return {"ok": True}

    return {
        "ok": True,
        "email": reset_state["email"],
        "expires_at": reset_state["expires_at"],
    }


@auth_r.post("/reset-password")
async def reset_password(inp: ResetPasswordInput, request: Request):
    email = inp.email.lower().strip()
    await enforce_fixed_window_rate_limit(
        db,
        scope="auth.reset_password",
        key=f"{request.client.host if request.client else 'unknown'}:{email}",
        limit=10,
        window_seconds=15 * 60,
        error_message="Too many password reset attempts. Try again later.",
        code="reset_password_rate_limited",
    )
    user = await db.users.find_one({"email": email}, {"_id": 0})
    if not user:
        raise HTTPException(400, "Invalid reset code")

    reset_request = await db.email_verifications.find_one(
        {"user_id": user["id"], "purpose": PASSWORD_RESET_PURPOSE},
        {"_id": 0},
    )
    if not reset_request:
        raise HTTPException(400, "No reset code available")
    if datetime.fromisoformat(reset_request["expires_at"]) <= datetime.now(timezone.utc):
        await db.email_verifications.delete_one({"id": reset_request["id"]})
        raise HTTPException(410, "Reset code expired")

    expected_hash = hash_verification_code(
        email=email,
        purpose=PASSWORD_RESET_PURPOSE,
        code=inp.code.strip(),
    )
    if expected_hash != reset_request.get("code_hash"):
        raise HTTPException(400, "Invalid reset code")

    password_matches, _ = verify_password(inp.new_password, user["password_hash"])
    if password_matches:
        raise HTTPException(400, "Choose a different password")

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_pw(inp.new_password), "last_seen": now_utc()}},
    )
    await db.email_verifications.delete_many({"user_id": user["id"], "purpose": PASSWORD_RESET_PURPOSE})
    await revoke_user_sessions(db, user["id"])
    return {"ok": True}

@auth_r.post("/logout")
async def logout(request: Request, response: Response):
    try:
        user, session = await load_current_user(db, request)
        await revoke_session(db, session["session_id"])
        await ws_mgr.close_session(session["session_id"], session_closed_payload("logout"))
        await db.users.update_one({"id": user["id"]}, {"$set": {"status": "offline", "last_seen": now_utc()}})
        await log_status_history(user["id"], "offline")
        await clear_voice_membership(user["id"])
        await broadcast_presence_update(user["id"])
    except Exception:
        pass
    clear_auth_cookies(response)
    return {"ok": True}


@auth_r.post("/logout-all")
async def logout_all(request: Request, response: Response):
    user, _session = await load_current_user(db, request)
    await revoke_user_sessions(db, user["id"])
    await ws_mgr.close_user_sessions(user["id"], session_closed_payload("logout_all"))
    await db.users.update_one({"id": user["id"]}, {"$set": {"status": "offline", "last_seen": now_utc()}})
    await log_status_history(user["id"], "offline")
    await clear_voice_membership(user["id"])
    await broadcast_presence_update(user["id"])
    clear_auth_cookies(response)
    return {"ok": True}


@auth_r.get("/sessions")
async def auth_sessions(request: Request):
    user, current_session = await load_current_user(db, request)
    sessions = await list_user_sessions(db, user["id"])
    for session in sessions:
        session["current"] = session["session_id"] == current_session["session_id"]
    return {"sessions": sessions}


@auth_r.delete("/sessions/{session_id}")
async def revoke_auth_session(session_id: str, request: Request):
    user, current_session = await load_current_user(db, request)
    target = await db.auth_sessions.find_one(
        {"session_id": session_id, "user_id": user["id"]},
        {"_id": 0, "session_id": 1},
    )
    if not target:
        raise HTTPException(404, "Session not found")
    await revoke_session(db, session_id)
    await ws_mgr.close_session(session_id, session_closed_payload("session_revoked"))
    if session_id == current_session["session_id"]:
        await clear_voice_membership(user["id"])
        await db.users.update_one({"id": user["id"]}, {"$set": {"status": "offline", "last_seen": now_utc()}})
        await log_status_history(user["id"], "offline")
        await broadcast_presence_update(user["id"])
    return {"ok": True}

@auth_r.get("/me")
async def me(request: Request):
    user, session = await load_current_user(db, request)
    at = make_access_token(user["id"], user.get("email", ""), session["session_id"])
    return {**sanitize_user(user), "access_token": at, "session_id": session["session_id"]}

@auth_r.post("/refresh")
async def refresh(inp: RefreshInput, request: Request, response: Response):
    rt = inp.refresh_token or get_request_token(request, prefer_refresh=True)
    if not rt:
        raise HTTPException(401, "No refresh token")
    await enforce_fixed_window_rate_limit(
        db,
        scope="auth.refresh",
        key=f"{request.client.host if request.client else 'unknown'}:{normalize_client_platform(request)}",
        limit=30,
        window_seconds=15 * 60,
        error_message="Too many refresh attempts. Try again later.",
        code="refresh_rate_limited",
    )
    user, session, access_token, refresh_token = await refresh_auth_session(
        db,
        refresh_token=rt,
        request=request,
        auth_config=app.state.auth_config,
        requested_device_id=request_device_id(request),
    )
    previous_session_id = session.get("replaced_from")
    if previous_session_id:
        await ws_mgr.close_session(previous_session_id, session_closed_payload("session_rotated"))
    set_cookies(response, access_token, refresh_token)
    return {
        "ok": True,
        "user": sanitize_user(user),
        "access_token": access_token,
        "refresh_token": refresh_token,
        "session_id": session["session_id"],
    }

# ============================================================
# E2EE ROUTES
# ============================================================
e2ee_r = APIRouter(prefix="/api/e2ee", tags=["E2EE"])


@e2ee_r.get("/state")
async def get_e2ee_state(request: Request):
    user = await current_user(request)
    return await build_e2ee_state(user["id"], request_device_id(request))


@e2ee_r.get("/recovery/account")
async def get_recovery_bundle(request: Request):
    user = await current_user(request)
    account = await get_e2ee_account(user["id"])
    if not account:
        raise HTTPException(404, "End-to-end encryption is not configured for this account")
    return {
        "enabled": True,
        "recovery_public_key": account.get("recovery_public_key"),
        "encrypted_recovery_private_key": account.get("encrypted_recovery_private_key"),
        "recovery_salt": account.get("recovery_salt"),
        "recovery_nonce": account.get("recovery_nonce"),
        "protocol_version": account.get("protocol_version", E2EE_PROTOCOL_VERSION),
    }


@e2ee_r.post("/bootstrap")
async def bootstrap_e2ee(inp: E2EEBootstrapInput, request: Request):
    user = await current_user(request)
    existing_account = await get_e2ee_account(user["id"])
    if existing_account:
        raise HTTPException(409, "End-to-end encryption is already configured for this account")

    header_device_id = request_device_id(request)
    if header_device_id and header_device_id != inp.device_id:
        raise HTTPException(400, "Desktop device id header does not match the bootstrap payload")

    created_at = now_utc()
    account_doc = {
        "id": new_id(),
        "user_id": user["id"],
        "protocol_version": E2EE_PROTOCOL_VERSION,
        "recovery_public_key": inp.recovery_public_key,
        "encrypted_recovery_private_key": inp.encrypted_recovery_private_key,
        "recovery_salt": inp.recovery_salt,
        "recovery_nonce": inp.recovery_nonce,
        "created_at": created_at,
        "updated_at": created_at,
    }
    device_doc = {
        "id": new_id(),
        "user_id": user["id"],
        "device_id": inp.device_id,
        "device_name": inp.device_name,
        "public_key": inp.device_public_key,
        "verified_at": created_at,
        "verified_by_device_id": inp.device_id,
        "revoked_at": None,
        "created_at": created_at,
        "last_seen": created_at,
    }
    await db.e2ee_accounts.insert_one(account_doc)
    await db.e2ee_devices.insert_one(device_doc)
    return await build_e2ee_state(user["id"], inp.device_id)


@e2ee_r.post("/devices")
async def register_e2ee_device(inp: E2EEDeviceInput, request: Request):
    user = await current_user(request)
    account = await get_e2ee_account(user["id"])
    if not account:
        raise HTTPException(409, "Configure end-to-end encryption first (Settings > Privacy)")

    existing = await get_device_record(user["id"], inp.device_id)
    created_at = now_utc()
    if existing:
        if existing.get("revoked_at"):
            raise HTTPException(409, "This device was revoked and cannot be reused")
        await db.e2ee_devices.update_one(
            {"user_id": user["id"], "device_id": inp.device_id},
            {"$set": {"device_name": inp.device_name, "public_key": inp.device_public_key, "last_seen": created_at}},
        )
    else:
        await db.e2ee_devices.insert_one({
            "id": new_id(),
            "user_id": user["id"],
            "device_id": inp.device_id,
            "device_name": inp.device_name,
            "public_key": inp.device_public_key,
            "verified_at": None,
            "verified_by_device_id": None,
            "revoked_at": None,
            "created_at": created_at,
            "last_seen": created_at,
        })

    return await build_e2ee_state(user["id"], inp.device_id)


@e2ee_r.post("/devices/{device_id}/approve")
async def approve_e2ee_device(device_id: str, request: Request):
    user = await current_user(request)
    actor_device = await require_verified_device(request, user)
    target = await get_device_record(user["id"], device_id)
    if not target:
        raise HTTPException(404, "Device not found")
    if target.get("revoked_at"):
        raise HTTPException(409, "Revoked devices cannot be approved")
    if target["device_id"] == actor_device["device_id"]:
        raise HTTPException(400, "This device is already trusted")

    verified_at = now_utc()
    await db.e2ee_devices.update_one(
        {"user_id": user["id"], "device_id": device_id},
        {"$set": {"verified_at": verified_at, "verified_by_device_id": actor_device["device_id"], "last_seen": verified_at}},
    )
    return await build_e2ee_state(user["id"], request_device_id(request))


@e2ee_r.post("/devices/{device_id}/verify-recovery")
async def verify_device_via_recovery(device_id: str, request: Request):
    user = await current_user(request)
    target = await get_device_record(user["id"], device_id)
    if not target:
        raise HTTPException(404, "Device not found")
    if target.get("revoked_at"):
        raise HTTPException(409, "Revoked devices cannot be recovered")
    verified_at = now_utc()
    await db.e2ee_devices.update_one(
        {"user_id": user["id"], "device_id": device_id},
        {"$set": {"verified_at": verified_at, "verified_by_device_id": "recovery", "last_seen": verified_at}},
    )
    return await build_e2ee_state(user["id"], device_id)


@e2ee_r.post("/devices/{device_id}/revoke")
async def revoke_e2ee_device(device_id: str, request: Request):
    user = await current_user(request)
    actor_device = await require_verified_device(request, user)
    target = await get_device_record(user["id"], device_id)
    if not target:
        raise HTTPException(404, "Device not found")
    if target["device_id"] == actor_device["device_id"]:
        raise HTTPException(400, "Revoke this device from another trusted device")
    await db.e2ee_devices.update_one(
        {"user_id": user["id"], "device_id": device_id},
        {"$set": {"revoked_at": now_utc()}},
    )
    return await build_e2ee_state(user["id"], actor_device["device_id"])


@e2ee_r.get("/dm/{other_user_id}/recipients")
async def dm_recipients(other_user_id: str, request: Request):
    user = await current_user(request)
    other = await db.users.find_one({"id": other_user_id}, {"_id": 0, "id": 1})
    if not other:
        raise HTTPException(404, "User not found")
    return await build_e2ee_recipient_payload([user["id"], other_user_id])


@e2ee_r.get("/groups/{group_id}/recipients")
async def group_recipients(group_id: str, request: Request):
    user = await current_user(request)
    recipients = await list_group_recipient_user_ids(group_id)
    if user["id"] not in recipients:
        raise HTTPException(403, "No access to this group conversation")
    return await build_e2ee_recipient_payload(recipients)


@e2ee_r.get("/channels/{channel_id}/recipients")
async def channel_recipients(channel_id: str, request: Request):
    user = await current_user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not channel.get("is_private"):
        raise HTTPException(400, "Only private channels use the end-to-end recipient API")
    if not await check_permission(user["id"], channel["server_id"], "read_messages", channel=channel):
        raise HTTPException(403, "No permission")
    await ensure_private_channel_member_access(user["id"], channel)
    recipients = await list_channel_recipient_user_ids(channel)
    return await build_e2ee_recipient_payload(recipients)


@e2ee_r.post("/blobs/init")
async def init_encrypted_blob(inp: EncryptedBlobInitInput, request: Request):
    user = await current_user(request)
    device = await require_verified_device(request, user)
    scope_kind = (inp.scope_kind or "").strip().lower()
    participant_user_ids = sorted(set(inp.participant_user_ids or []))

    if scope_kind == "dm":
        if user["id"] not in participant_user_ids or len(participant_user_ids) != 2:
            raise HTTPException(400, "Encrypted DM uploads require both DM participants")
    elif scope_kind == "group":
        group_users = sorted(await list_group_recipient_user_ids(inp.scope_id))
        if participant_user_ids != group_users:
            raise HTTPException(400, "Encrypted group upload recipients do not match the group members")
    elif scope_kind == "channel":
        channel = await db.channels.find_one({"id": inp.scope_id}, {"_id": 0})
        if not channel:
            raise HTTPException(404, "Channel not found")
        if not channel.get("is_private"):
            raise HTTPException(400, "Only private channels support encrypted blob uploads")
        allowed_users = sorted(await list_channel_recipient_user_ids(channel))
        if sorted(participant_user_ids) != allowed_users:
            raise HTTPException(400, "Encrypted channel upload recipients do not match the channel audience")
    else:
        raise HTTPException(400, "Unsupported encrypted blob scope")

    upload_id = new_id()
    object_key = f"ciphertext/{scope_kind}/{inp.scope_id}/{upload_id}"
    await db.e2ee_blob_uploads.insert_one({
        "id": upload_id,
        "user_id": user["id"],
        "device_id": device["device_id"],
        "scope_kind": scope_kind,
        "scope_id": inp.scope_id,
        "participant_user_ids": participant_user_ids,
        "object_key": object_key,
        "status": "pending",
        "created_at": now_utc(),
    })
    return {"upload_id": upload_id, "protocol_version": E2EE_PROTOCOL_VERSION}


@e2ee_r.put("/blobs/{upload_id}/content")
async def upload_encrypted_blob_content(upload_id: str, inp: EncryptedBlobContentInput, request: Request):
    user = await current_user(request)
    await require_verified_device(request, user)
    upload = await db.e2ee_blob_uploads.find_one({"id": upload_id, "user_id": user["id"]}, {"_id": 0})
    if not upload or upload.get("status") != "pending":
        raise HTTPException(404, "Encrypted upload not found")

    ciphertext = decode_base64_bytes(inp.ciphertext_b64, field_name="ciphertext_b64")
    if len(ciphertext) != inp.size_bytes:
        raise HTTPException(400, "Encrypted blob size does not match the declared ciphertext size")
    await put_blob(
        object_key=upload["object_key"],
        data=ciphertext,
        content_type=inp.content_type,
    )
    await db.e2ee_blob_uploads.update_one(
        {"id": upload_id},
        {
            "$set": {
                "status": "uploaded",
                "sha256": inp.sha256,
                "size_bytes": inp.size_bytes,
                "content_type": inp.content_type,
                "uploaded_at": now_utc(),
            },
        },
    )
    return {"ok": True}


@e2ee_r.post("/blobs/{upload_id}/complete")
async def finalize_encrypted_blob(upload_id: str, request: Request):
    user = await current_user(request)
    device = await require_verified_device(request, user)
    upload = await db.e2ee_blob_uploads.find_one({"id": upload_id, "user_id": user["id"]}, {"_id": 0})
    if not upload or upload.get("status") != "uploaded":
        raise HTTPException(404, "Encrypted upload is not ready to finalize")

    blob_id = new_id()
    blob_record = {
        "id": blob_id,
        "scope_kind": upload["scope_kind"],
        "scope_id": upload["scope_id"],
        "participant_user_ids": upload.get("participant_user_ids") or [],
        "object_key": upload["object_key"],
        "sha256": upload.get("sha256"),
        "size_bytes": upload.get("size_bytes"),
        "content_type": upload.get("content_type", "application/octet-stream"),
        "uploader_user_id": user["id"],
        "uploaded_by_device_id": device["device_id"],
        "created_at": now_utc(),
    }
    await db.e2ee_blobs.insert_one(blob_record)
    await db.e2ee_blob_uploads.delete_one({"id": upload_id})
    return {
        "id": blob_id,
        "size_bytes": blob_record["size_bytes"],
        "content_type": blob_record["content_type"],
        "url": f"/api/e2ee/blobs/{blob_id}",
    }


@e2ee_r.get("/blobs/{blob_id}")
async def fetch_encrypted_blob(blob_id: str, request: Request):
    user = await current_user(request)
    blob_record = await db.e2ee_blobs.find_one({"id": blob_id}, {"_id": 0})
    if not blob_record:
        raise HTTPException(404, "Encrypted attachment not found")
    await authorize_blob_access(user, blob_record)
    blob_bytes = await get_blob(object_key=blob_record["object_key"])
    return RawResponse(content=blob_bytes, media_type=blob_record.get("content_type", "application/octet-stream"))


@e2ee_r.get("/media/channels/{channel_id}/current")
async def get_current_media_key(channel_id: str, request: Request):
    user = await current_user(request)
    device = await require_verified_device(request, user)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not channel.get("is_private") or channel.get("type") != "voice":
        raise HTTPException(400, "Only private voice channels use encrypted media keys")
    if not await check_permission(user["id"], channel["server_id"], "join_voice", channel=channel):
        raise HTTPException(403, "No permission")
    await ensure_private_channel_member_access(user["id"], channel)
    active_voice_user_ids = await list_active_voice_participant_user_ids(channel_id)
    if user["id"] not in active_voice_user_ids:
        raise HTTPException(403, "You are not an active participant in this encrypted voice channel")

    media_key = await db.e2ee_media_keys.find_one(
        {"channel_id": channel_id},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if not media_key:
        return {"key_package": None}

    matching_envelopes = [
        envelope for envelope in media_key.get("key_envelopes", [])
        if envelope.get("recipient_device_id") == device["device_id"]
    ]
    return {"key_package": {**media_key, "key_envelopes": matching_envelopes}}


@e2ee_r.post("/media/channels/{channel_id}/rotate")
async def rotate_media_key(channel_id: str, inp: EncryptedMediaKeyInput, request: Request):
    user = await current_user(request)
    device = await require_verified_device(request, user)
    if inp.sender_device_id != device["device_id"]:
        raise HTTPException(400, "Encrypted media payload must originate from the current desktop device")
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not channel.get("is_private") or channel.get("type") != "voice":
        raise HTTPException(400, "Only private voice channels use encrypted media keys")
    if not await check_permission(user["id"], channel["server_id"], "join_voice", channel=channel):
        raise HTTPException(403, "No permission")
    await ensure_private_channel_member_access(user["id"], channel)

    participant_user_ids = sorted({participant_id for participant_id in (inp.participant_user_ids or []) if participant_id})
    active_voice_user_ids = await list_active_voice_participant_user_ids(channel_id)
    if participant_user_ids != active_voice_user_ids:
        raise HTTPException(400, "Encrypted media rotation recipients must match the active voice participants")
    if user["id"] not in participant_user_ids:
        raise HTTPException(400, "Encrypted media rotation must include the rotating participant")

    record = {
        "id": new_id(),
        "channel_id": channel_id,
        "sender_user_id": user["id"],
        "sender_device_id": inp.sender_device_id,
        "key_version": inp.key_version,
        "participant_user_ids": participant_user_ids,
        "key_envelopes": inp.key_envelopes,
        "created_at": now_utc(),
    }
    await db.e2ee_media_keys.insert_one(record)
    return {"ok": True, "key_package": {**record, "_id": None}}

# ============================================================
# SETUP ROUTES
# ============================================================
setup_r = APIRouter(prefix="/api/setup", tags=["Setup"])

@setup_r.get("/status")
async def setup_status():
    settings = await get_instance_settings()
    server_count = await db.servers.count_documents({})
    return {
        "initialized": settings.get("initialized", False),
        "setup_required": not settings.get("initialized", False),
        "allow_open_signup": settings.get("allow_open_signup", False),
        "community_count": server_count,
        "server_count": server_count,
        "instance_name": settings.get("instance_name", ""),
    }

@setup_r.post("/bootstrap")
async def bootstrap(inp: BootstrapInput, request: Request, response: Response):
    existing_settings = await get_instance_settings()
    if existing_settings.get("initialized"):
        raise HTTPException(409, "Instance is already initialized")

    email = inp.owner_email.lower().strip()
    username = normalize_username(inp.owner_username)
    await ensure_unique_identity(email, username)

    try:
        await db.instance_settings.insert_one({
            "id": INSTANCE_SETTINGS_ID,
            "initialized": False,
            "setup_in_progress": True,
            "instance_name": inp.instance_name.strip(),
            "allow_open_signup": bool(inp.allow_open_signup),
            "created_at": now_utc(),
        })
    except DuplicateKeyError:
        claimed = await db.instance_settings.find_one({"id": INSTANCE_SETTINGS_ID}, {"_id": 0})
        if claimed and claimed.get("initialized"):
            raise HTTPException(409, "Instance is already initialized")
        raise HTTPException(409, "Setup is already in progress")

    uid = new_id()
    owner_user = {
        "id": uid,
        "email": email,
        "username": username,
        "display_name": inp.owner_display_name.strip(),
        "password_hash": hash_pw(inp.owner_password),
        "avatar_url": "",
        "status": "online",
        "public_key": "",
        "role": OWNER_ROLE,
        "instance_role": OWNER_ROLE,
        "email_verified": True,
        "email_verified_at": now_utc(),
        "created_at": now_utc(),
        "last_seen": now_utc(),
    }

    try:
        await db.users.insert_one(owner_user)
        await db.instance_settings.update_one(
            {"id": INSTANCE_SETTINGS_ID},
            {
                "$set": {
                    "initialized": True,
                    "instance_name": inp.instance_name.strip(),
                    "owner_user_id": uid,
                    "allow_open_signup": bool(inp.allow_open_signup),
                    "setup_completed_at": now_utc(),
                    "setup_in_progress": False,
                }
            },
        )
    except Exception:
        await db.instance_settings.delete_one({"id": INSTANCE_SETTINGS_ID, "initialized": False})
        await db.users.delete_one({"id": uid})
        raise

    auth_payload = await issue_auth_response(owner_user, request, response)
    return {
        **auth_payload,
        "setup": {
            "initialized": True,
            "instance_name": inp.instance_name.strip(),
            "allow_open_signup": bool(inp.allow_open_signup),
        },
    }


instance_r = APIRouter(prefix="/api/instance", tags=["Instance"])


@instance_r.get("/admins")
async def list_instance_admins(request: Request):
    user = await current_user(request)
    await require_instance_admin(user)
    admins = await db.users.find(
        {"instance_role": {"$in": [OWNER_ROLE, ADMIN_ROLE]}},
        {"_id": 0, "password_hash": 0},
    ).sort("created_at", 1).to_list(100)
    return [sanitize_user(admin) for admin in admins]


@instance_r.post("/admins")
async def promote_instance_admin(inp: InstanceAdminUpdateInput, request: Request):
    user = await current_user(request)
    await require_instance_owner(user)
    target = await db.users.find_one({"id": inp.user_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("instance_role") == OWNER_ROLE:
        return sanitize_user(target)
    await db.users.update_one(
        {"id": inp.user_id},
        {"$set": {"instance_role": ADMIN_ROLE, "role": ADMIN_ROLE}},
    )
    updated = await db.users.find_one({"id": inp.user_id}, {"_id": 0, "password_hash": 0})
    return sanitize_user(updated)


@instance_r.delete("/admins/{user_id}")
async def demote_instance_admin(user_id: str, request: Request):
    user = await current_user(request)
    await require_instance_owner(user)
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("instance_role") == OWNER_ROLE:
        raise HTTPException(400, "Owner cannot be demoted")
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"instance_role": USER_ROLE, "role": USER_ROLE}},
    )
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return sanitize_user(updated)

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
    await require_instance_owner(user)
    server = await create_default_server(user, inp.name, inp.description)
    ws_mgr.add_server(user["id"], server["id"])
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
    server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if server:
        await ws_mgr.broadcast_server(server_id, {"type": "server_updated", "server": server})
    return server


@servers_r.delete("/{server_id}")
async def delete_server(server_id: str, request: Request):
    actor = await current_user(request)
    server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if not server:
        raise HTTPException(404, "Server not found")
    if server.get("owner_id") != actor["id"]:
        raise HTTPException(403, "Only the current server owner can delete this server")

    memberships = await db.server_members.find({"server_id": server_id}, {"_id": 0, "user_id": 1}).to_list(1000)
    member_ids = sorted({membership["user_id"] for membership in memberships if membership.get("user_id")})

    for member_id in member_ids:
        await clear_voice_membership(member_id, server_id=server_id, force_reason="deleted")

    await delete_server_cascade(server_id)

    for member_id in member_ids:
        ws_mgr.remove_server(member_id, server_id)
        await ws_mgr.send(member_id, {"type": "server_deleted", "server_id": server_id})

    return {"ok": True}


@servers_r.post("/{server_id}/ownership/transfer")
async def transfer_server_ownership(server_id: str, inp: OwnershipTransferInput, request: Request):
    actor = await current_user(request)
    server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if not server:
        raise HTTPException(404, "Server not found")
    if server.get("owner_id") != actor["id"]:
        raise HTTPException(403, "Only the current server owner can transfer ownership")
    if inp.user_id == actor["id"]:
        raise HTTPException(400, "You already own this server")

    target_member = await get_server_member(server_id, inp.user_id)
    if not target_member or target_member.get("is_banned"):
        raise HTTPException(404, "Target member not found")

    await db.servers.update_one({"id": server_id}, {"$set": {"owner_id": inp.user_id}})
    updated_server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    await log_audit(
        server_id,
        actor["id"],
        "ownership_transfer",
        "server",
        server_id,
        {"from_user_id": actor["id"], "to_user_id": inp.user_id},
    )
    await ws_mgr.broadcast_server(server_id, {"type": "server_updated", "server": updated_server})
    return updated_server


@servers_r.post("/{server_id}/leave")
async def leave_server(server_id: str, request: Request):
    user = await current_user(request)
    server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if not server:
        raise HTTPException(404, "Server not found")

    membership = await get_server_member(server_id, user["id"])
    if not membership or membership.get("is_banned"):
        raise HTTPException(403, "Not a member")

    if server.get("owner_id") == user["id"]:
        raise HTTPException(400, "Transfer ownership before leaving this server")

    await clear_voice_membership(user["id"], server_id=server_id, force_reason="left")
    await db.server_members.delete_one({"server_id": server_id, "user_id": user["id"]})
    ws_mgr.remove_server(user["id"], server_id)
    await log_audit(server_id, user["id"], "member_leave", "user", user["id"], {})
    payload = {"type": "member_left", "server_id": server_id, "user_id": user["id"]}
    await ws_mgr.broadcast_server(server_id, payload)
    await ws_mgr.send(user["id"], {"type": "server_left", "server_id": server_id, "user_id": user["id"]})
    return {"ok": True}

# --- Channels ---
@servers_r.get("/{server_id}/channels")
async def list_channels(server_id: str, request: Request):
    user = await current_user(request)
    member = await db.server_members.find_one({"server_id": server_id, "user_id": user["id"]}, {"_id": 0})
    if not member or member.get("is_banned"):
        raise HTTPException(403, "Not a member")
    channels = await db.channels.find({"server_id": server_id}, {"_id": 0}).sort("position", 1).to_list(100)
    visible_channels = []
    # Add voice states to voice channels
    for ch in channels:
        visible_permission = "join_voice" if ch.get("type") == "voice" else "read_messages"
        if not await check_permission(user["id"], server_id, visible_permission, channel=ch):
            continue
        if ch["type"] == "voice":
            states = await db.voice_states.find({"channel_id": ch["id"]}, {"_id": 0}).to_list(50)
            for s in states:
                u = await db.users.find_one({"id": s["user_id"]}, {"_id": 0, "password_hash": 0})
                s["user"] = u
            ch["voice_states"] = states
        visible_channels.append(ch)
    return visible_channels

@servers_r.post("/{server_id}/channels")
async def create_channel(server_id: str, inp: ChannelCreateInput, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_channels"):
        raise HTTPException(403, "No permission")
    channel_type = (inp.type or "text").strip().lower()
    if channel_type not in {"text", "voice", "category"}:
        raise HTTPException(400, "Unsupported channel type")

    parent_id = inp.parent_id
    if channel_type == "category":
        parent_id = None
    elif parent_id:
        parent = await db.channels.find_one({"id": parent_id, "server_id": server_id}, {"_id": 0})
        if not parent or parent.get("type") != "category":
            raise HTTPException(400, "Parent must be a category in the same server")

    display_name = inp.name.strip()
    if not display_name:
        raise HTTPException(400, "Channel name is required")

    ch = {
        "id": new_id(),
        "server_id": server_id,
        "name": display_name if channel_type == "category" else display_name.lower().replace(" ", "-"),
        "type": channel_type,
        "topic": "" if channel_type == "category" else (inp.topic or ""),
        "parent_id": parent_id,
        "position": await db.channels.count_documents({"server_id": server_id, "parent_id": parent_id}),
        "is_private": False if channel_type == "category" else inp.is_private,
        "slowmode_seconds": 0,
        "created_at": now_utc()
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


@servers_r.get("/{server_id}/viewer-context")
async def get_server_viewer_context(server_id: str, request: Request):
    user = await current_user(request)
    member = await db.server_members.find_one({"server_id": server_id, "user_id": user["id"]}, {"_id": 0})
    if not member or member.get("is_banned"):
        raise HTTPException(403, "Not a member")
    return await build_viewer_context(db, user["id"], server_id)


@servers_r.get("/{server_id}/moderation/bans")
async def list_bans(server_id: str, request: Request):
    actor = await current_user(request)
    if not (
        await check_permission(actor["id"], server_id, "ban_members")
        or await check_permission(actor["id"], server_id, "manage_members")
    ):
        raise HTTPException(403, "No permission")

    banned_members = await db.server_members.find(
        {"server_id": server_id, "is_banned": True},
        {"_id": 0},
    ).to_list(500)
    result = []
    for member in banned_members:
        banned_user = await db.users.find_one({"id": member["user_id"]}, {"_id": 0, "password_hash": 0})
        if banned_user:
            member["user"] = sanitize_user(banned_user)
            result.append(member)
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
        member_payload = await build_member_payload(server_id, user_id)
        if member_payload:
            await ws_mgr.broadcast_server(
                server_id,
                {"type": "member_updated", "server_id": server_id, "member": member_payload},
            )
    return {"ok": True}

@servers_r.delete("/{server_id}/members/{user_id}")
async def kick_member(server_id: str, user_id: str, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "kick_members"):
        raise HTTPException(403, "No permission")
    server = await db.servers.find_one({"id": server_id}, {"_id": 0, "owner_id": 1})
    if server and server.get("owner_id") == user_id:
        raise HTTPException(400, "Cannot remove the server owner")
    await clear_voice_membership(user_id, server_id=server_id, force_reason="kicked")
    await db.server_members.delete_one({"server_id": server_id, "user_id": user_id})
    ws_mgr.remove_server(user_id, server_id)
    await log_audit(server_id, actor["id"], "member_kick", "user", user_id, {})
    payload = {"type": "member_kicked", "server_id": server_id, "user_id": user_id}
    await ws_mgr.broadcast_server(server_id, payload)
    await ws_mgr.send(user_id, payload)
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
        "is_default": False, "mentionable": bool(inp.mentionable), "created_at": now_utc()
    }
    await db.roles.insert_one(role)
    role.pop("_id", None)
    await ws_mgr.broadcast_server(server_id, {"type": "role_created", "server_id": server_id, "role": role})
    return role

@servers_r.put("/{server_id}/roles/{role_id}")
async def update_role(server_id: str, role_id: str, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_roles"):
        raise HTTPException(403, "No permission")
    role = await db.roles.find_one({"id": role_id, "server_id": server_id}, {"_id": 0})
    if not role:
        raise HTTPException(404, "Role not found")
    body = await request.json()
    allowed_keys = ("permissions",) if role.get("is_default") else ("name", "color", "permissions", "position", "mentionable")
    updates = {k: v for k, v in body.items() if k in allowed_keys}
    if "permissions" in updates:
        updates["permissions"] = {**DEFAULT_PERMISSIONS, **updates["permissions"]}
    if role.get("is_default"):
        updates["name"] = "@everyone"
        updates["mentionable"] = False
    if updates:
        await db.roles.update_one({"id": role_id, "server_id": server_id}, {"$set": updates})
    role = await db.roles.find_one({"id": role_id}, {"_id": 0})
    if role:
        await ws_mgr.broadcast_server(server_id, {"type": "role_updated", "server_id": server_id, "role": role})
    return role

@servers_r.delete("/{server_id}/roles/{role_id}")
async def delete_role(server_id: str, role_id: str, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_roles"):
        raise HTTPException(403, "No permission")
    role = await db.roles.find_one({"id": role_id}, {"_id": 0})
    if role and role.get("is_default"):
        raise HTTPException(400, "Cannot delete default role")
    await db.roles.delete_one({"id": role_id})
    await ws_mgr.broadcast_server(server_id, {"type": "role_deleted", "server_id": server_id, "role_id": role_id})
    return {"ok": True}

# --- Moderation ---
@servers_r.post("/{server_id}/moderation/ban")
async def ban_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "ban_members"):
        raise HTTPException(403, "No permission")
    await enforce_fixed_window_rate_limit(
        db,
        scope="moderation.ban",
        key=f"{server_id}:{actor['id']}",
        limit=20,
        window_seconds=10 * 60,
        error_message="Too many moderation actions. Try again later.",
        code="moderation_rate_limited",
    )
    server = await db.servers.find_one({"id": server_id}, {"_id": 0, "owner_id": 1})
    if server and server.get("owner_id") == inp.user_id:
        raise HTTPException(400, "Cannot ban the server owner")
    await clear_voice_membership(inp.user_id, server_id=server_id, force_reason="banned")
    await db.server_members.update_one(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"is_banned": True, "ban_reason": inp.reason}}
    )
    ws_mgr.remove_server(inp.user_id, server_id)
    await log_audit(server_id, actor["id"], "member_ban", "user", inp.user_id, {"reason": inp.reason})
    payload = {"type": "member_banned", "server_id": server_id, "user_id": inp.user_id}
    await ws_mgr.broadcast_server(server_id, payload)
    await ws_mgr.send(inp.user_id, payload)
    return {"ok": True}

@servers_r.post("/{server_id}/moderation/unban")
async def unban_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "ban_members"):
        raise HTTPException(403, "No permission")
    await enforce_fixed_window_rate_limit(
        db,
        scope="moderation.unban",
        key=f"{server_id}:{actor['id']}",
        limit=20,
        window_seconds=10 * 60,
        error_message="Too many moderation actions. Try again later.",
        code="moderation_rate_limited",
    )
    membership = await get_server_member(server_id, inp.user_id)
    if not membership or not membership.get("is_banned"):
        raise HTTPException(404, "Banned member not found")
    await db.server_members.update_one(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"is_banned": False, "ban_reason": ""}}
    )
    ws_mgr.add_server(inp.user_id, server_id)
    member_payload = await build_member_payload(server_id, inp.user_id)
    await log_audit(server_id, actor["id"], "member_unban", "user", inp.user_id, {})
    await ws_mgr.broadcast_server(
        server_id,
        {
            "type": "member_unbanned",
            "server_id": server_id,
            "user_id": inp.user_id,
            "member": member_payload,
        },
    )
    await ws_mgr.send(
        inp.user_id,
        {
            "type": "member_unbanned",
            "server_id": server_id,
            "user_id": inp.user_id,
            "member": member_payload,
        },
    )
    return {"ok": True}

@servers_r.post("/{server_id}/moderation/mute")
async def mute_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "mute_members"):
        raise HTTPException(403, "No permission")
    await enforce_fixed_window_rate_limit(
        db,
        scope="moderation.mute",
        key=f"{server_id}:{actor['id']}",
        limit=40,
        window_seconds=10 * 60,
        error_message="Too many moderation actions. Try again later.",
        code="moderation_rate_limited",
    )
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
    await enforce_fixed_window_rate_limit(
        db,
        scope="moderation.unmute",
        key=f"{server_id}:{actor['id']}",
        limit=40,
        window_seconds=10 * 60,
        error_message="Too many moderation actions. Try again later.",
        code="moderation_rate_limited",
    )
    await db.server_members.update_one(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"muted_until": None}}
    )
    return {"ok": True}

@servers_r.post("/{server_id}/moderation/deafen")
async def deafen_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "deafen_members"):
        raise HTTPException(403, "No permission")
    await enforce_fixed_window_rate_limit(
        db,
        scope="moderation.deafen",
        key=f"{server_id}:{actor['id']}",
        limit=40,
        window_seconds=10 * 60,
        error_message="Too many moderation actions. Try again later.",
        code="moderation_rate_limited",
    )

    await db.voice_states.update_many(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"is_deafened": True}},
    )
    updated_states = await db.voice_states.find(
        {"server_id": server_id, "user_id": inp.user_id},
        {"_id": 0},
    ).to_list(20)
    for state in updated_states:
        await ws_mgr.broadcast_server(
            server_id,
            {
                "type": "voice_state_update",
                "channel_id": state["channel_id"],
                "user_id": inp.user_id,
                "state": state,
            },
        )
    await log_audit(server_id, actor["id"], "member_deafen", "user", inp.user_id, {})
    return {"ok": True}

@servers_r.post("/{server_id}/moderation/undeafen")
async def undeafen_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "deafen_members"):
        raise HTTPException(403, "No permission")
    await enforce_fixed_window_rate_limit(
        db,
        scope="moderation.undeafen",
        key=f"{server_id}:{actor['id']}",
        limit=40,
        window_seconds=10 * 60,
        error_message="Too many moderation actions. Try again later.",
        code="moderation_rate_limited",
    )

    await db.voice_states.update_many(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"is_deafened": False}},
    )
    updated_states = await db.voice_states.find(
        {"server_id": server_id, "user_id": inp.user_id},
        {"_id": 0},
    ).to_list(20)
    for state in updated_states:
        await ws_mgr.broadcast_server(
            server_id,
            {
                "type": "voice_state_update",
                "channel_id": state["channel_id"],
                "user_id": inp.user_id,
                "state": state,
            },
        )
    await log_audit(server_id, actor["id"], "member_undeafen", "user", inp.user_id, {})
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
    channel = await db.channels.find_one({"id": channel_id, "server_id": server_id, "type": "voice"}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Voice channel not found")
    if not await check_permission(user["id"], server_id, "join_voice", channel=channel):
        raise HTTPException(403, "No permission")
    await ensure_private_channel_member_access(user["id"], channel)
    await clear_voice_membership(user["id"])
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
    await clear_voice_membership(user["id"], server_id=server_id, channel_id=channel_id)
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


voice_r = APIRouter(prefix="/api/voice", tags=["Voice"])


@voice_r.post("/token")
async def create_voice_token(request: Request, inp: VoiceTokenInput):
    user = await current_user(request)
    channel = await db.channels.find_one(
        {"id": inp.channel_id, "server_id": inp.server_id, "type": "voice"},
        {"_id": 0},
    )
    if not channel:
        raise HTTPException(404, "Voice channel not found")
    can_join = await check_permission(user["id"], inp.server_id, "join_voice", channel=channel)
    can_speak = await check_permission(user["id"], inp.server_id, "speak", channel=channel)
    can_stream = await check_permission(user["id"], inp.server_id, "stream", channel=channel)
    if not can_join:
        raise HTTPException(403, "No permission")
    await ensure_private_channel_member_access(user["id"], channel)
    if not livekit_url or not livekit_api_key or not livekit_api_secret:
        raise HTTPException(503, "Voice service is not configured")

    room_name = f"server-{inp.server_id}-channel-{inp.channel_id}"
    access_token = (
        livekit_api.AccessToken(livekit_api_key, livekit_api_secret)
        .with_identity(user["id"])
        .with_name(user.get("display_name") or user.get("username") or user["id"])
        .with_grants(
            livekit_api.VideoGrants(
                room=room_name,
                **build_voice_capabilities(
                    can_join=can_join,
                    can_speak=can_speak,
                    can_stream=can_stream,
                ),
            )
        )
        .to_jwt()
    )
    return {
        "server_url": livekit_public_url,
        "participant_token": access_token,
        "room_name": room_name,
        "e2ee_required": bool(channel.get("is_private")),
        "media_key_endpoint": f"/api/e2ee/media/channels/{inp.channel_id}/current" if channel.get("is_private") else None,
        "media_rotate_endpoint": f"/api/e2ee/media/channels/{inp.channel_id}/rotate" if channel.get("is_private") else None,
    }

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
    updates = {k: v for k, v in body.items() if k in ("name", "topic", "is_private", "slowmode_seconds", "position") and v is not None}
    if "name" in updates and isinstance(updates["name"], str):
        display_name = updates["name"].strip()
        if not display_name:
            raise HTTPException(400, "Channel name is required")
        updates["name"] = display_name if ch["type"] == "category" else display_name.lower().replace(" ", "-")
    if "parent_id" in body:
        parent_id = body.get("parent_id")
        if ch["type"] == "category":
            parent_id = None
        elif parent_id:
            parent = await db.channels.find_one(
                {"id": parent_id, "server_id": ch["server_id"]},
                {"_id": 0},
            )
            if not parent or parent.get("type") != "category":
                raise HTTPException(400, "Parent must be a category in the same server")
        updates["parent_id"] = parent_id
    if ch["type"] == "category":
        updates.pop("topic", None)
        updates["is_private"] = False
    if updates:
        await db.channels.update_one({"id": channel_id}, {"$set": updates})
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if channel:
        if channel["type"] == "voice":
            channel["voice_states"] = await db.voice_states.find({"channel_id": channel_id}, {"_id": 0}).to_list(50)
        await ws_mgr.broadcast_server(channel["server_id"], {"type": "channel_updated", "channel": channel})
    return channel

@servers_r.put("/{server_id}/channels/reorder")
async def reorder_channels(server_id: str, inp: ChannelReorderInput, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_channels"):
        raise HTTPException(403, "No permission")
    if not inp.items:
        return {"ok": True, "channels": []}

    channel_ids = [item.id for item in inp.items]
    existing_channels = await db.channels.find(
        {"server_id": server_id, "id": {"$in": channel_ids}},
        {"_id": 0},
    ).to_list(len(channel_ids))
    existing_map = {channel["id"]: channel for channel in existing_channels}
    if len(existing_map) != len(channel_ids):
        raise HTTPException(400, "One or more channels do not belong to this server")

    parent_ids = {item.parent_id for item in inp.items if item.parent_id}
    if parent_ids:
        parent_channels = await db.channels.find(
            {"server_id": server_id, "id": {"$in": list(parent_ids)}},
            {"_id": 0},
        ).to_list(len(parent_ids))
        parent_map = {channel["id"]: channel for channel in parent_channels}
        for parent_id in parent_ids:
            parent = parent_map.get(parent_id)
            if not parent or parent.get("type") != "category":
                raise HTTPException(400, "Parent must be a category in the same server")

    updated_channels = []
    for item in inp.items:
        channel = existing_map[item.id]
        next_parent = None if channel.get("type") == "category" else item.parent_id
        await db.channels.update_one(
            {"id": item.id, "server_id": server_id},
            {"$set": {"parent_id": next_parent, "position": item.position}},
        )
        updated = await db.channels.find_one({"id": item.id, "server_id": server_id}, {"_id": 0})
        if updated:
            if updated["type"] == "voice":
                updated["voice_states"] = await db.voice_states.find({"channel_id": updated["id"]}, {"_id": 0}).to_list(50)
            updated_channels.append(updated)
            await ws_mgr.broadcast_server(server_id, {"type": "channel_updated", "channel": updated})

    await log_audit(
        server_id,
        user["id"],
        "channel_reorder",
        "server",
        server_id,
        {"channel_ids": channel_ids},
    )
    return {"ok": True, "channels": updated_channels}

@channels_r.delete("/{channel_id}")
async def delete_channel(channel_id: str, request: Request):
    user = await current_user(request)
    ch = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not ch:
        raise HTTPException(404, "Channel not found")
    if not await check_permission(user["id"], ch["server_id"], "manage_channels"):
        raise HTTPException(403, "No permission")
    if ch.get("type") == "category":
        await db.channels.update_many(
            {"server_id": ch["server_id"], "parent_id": channel_id},
            {"$set": {"parent_id": None}},
        )
        reparented_children = await db.channels.find(
            {"server_id": ch["server_id"], "parent_id": None, "id": {"$ne": channel_id}},
            {"_id": 0},
        ).to_list(200)
        for child in reparented_children:
            await ws_mgr.broadcast_server(ch["server_id"], {"type": "channel_updated", "channel": child})
    await db.channels.delete_one({"id": channel_id})
    await db.messages.delete_many({"channel_id": channel_id})
    await ws_mgr.broadcast_server(ch["server_id"], {"type": "channel_delete", "channel_id": channel_id})
    return {"ok": True}

@channels_r.get("/{channel_id}/messages")
async def get_messages(channel_id: str, request: Request, before: str = None, limit: int = 50):
    user = await current_user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    limit = clamp_page_limit(limit)
    if not await check_permission(user["id"], channel["server_id"], "read_messages", channel=channel):
        raise HTTPException(403, "No permission")
    await ensure_private_channel_member_access(user["id"], channel)
    query = {"channel_id": channel_id, "is_deleted": {"$ne": True}}
    history_cutoff = await get_message_history_cutoff(user["id"], channel["server_id"], channel=channel)
    created_at_filters = {}
    if before:
        created_at_filters["$lt"] = before
    if history_cutoff:
        created_at_filters["$gte"] = history_cutoff
    if created_at_filters:
        query["created_at"] = created_at_filters
    messages = await db.messages.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    messages.reverse()
    for msg in messages:
        author = await db.users.find_one({"id": msg["author_id"]}, {"_id": 0, "password_hash": 0})
        msg["author"] = author
        await hydrate_message_mentions(msg)
    next_before = messages[0]["created_at"] if messages else None
    return {
        "messages": messages,
        "next_before": next_before,
        "has_more_before": len(messages) == limit,
    }

@channels_r.post("/{channel_id}/messages")
async def send_message(channel_id: str, inp: MessageCreateInput, request: Request):
    user = await current_user(request)
    ch = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not ch:
        raise HTTPException(404, "Channel not found")
    if not await check_permission(user["id"], ch["server_id"], "send_messages", channel=ch):
        raise HTTPException(403, "No permission")
    if inp.attachments and not await check_permission(user["id"], ch["server_id"], "attach_files", channel=ch):
        raise HTTPException(403, "No permission to upload files")
    await ensure_private_channel_member_access(user["id"], ch)
    member = await db.server_members.find_one({"server_id": ch["server_id"], "user_id": user["id"]}, {"_id": 0})
    if member and member.get("muted_until"):
        if datetime.fromisoformat(member["muted_until"]) > datetime.now(timezone.utc):
            raise HTTPException(403, "You are muted")
    is_e2ee_channel = bool(ch.get("is_private"))
    mention_data = await resolve_message_mentions(
        server_id=ch["server_id"],
        actor_id=user["id"],
        channel=ch,
        content=inp.content,
        mentioned_user_ids=inp.mentioned_user_ids,
        mentioned_role_ids=inp.mentioned_role_ids,
        mentions_everyone=inp.mentions_everyone,
    )
    if is_e2ee_channel:
        device = await require_verified_device(request, user)
        if not inp.is_e2ee or not inp.ciphertext or not inp.nonce or not inp.sender_device_id:
            raise HTTPException(400, "Private channels require encrypted desktop messages")
        if inp.sender_device_id != device["device_id"]:
            raise HTTPException(400, "Encrypted messages must originate from the active E2EE device")
        msg = {
            "id": new_id(),
            "channel_id": channel_id,
            "author_id": user["id"],
            "content": "[encrypted]",
            "type": inp.message_type or "text",
            "attachments": inp.attachments,
            "edited_at": None,
            "is_deleted": False,
            "reactions": {},
            "reply_to_id": inp.reply_to_id,
            "mention_ids": mention_data["mentioned_user_ids"],
            "mentioned_user_ids": mention_data["mentioned_user_ids"],
            "mentioned_role_ids": mention_data["mentioned_role_ids"],
            "mentions_everyone": mention_data["mentions_everyone"],
            "thread_id": None,
            "thread_count": 0,
            "created_at": now_utc(),
            "is_e2ee": True,
            "ciphertext": inp.ciphertext,
            "nonce": inp.nonce,
            "sender_device_id": inp.sender_device_id,
            "protocol_version": inp.protocol_version or E2EE_PROTOCOL_VERSION,
            "key_envelopes": inp.key_envelopes,
        }
    else:
        msg = {
            "id": new_id(), "channel_id": channel_id, "author_id": user["id"],
            "content": inp.content, "type": "text",
            "attachments": inp.attachments, "edited_at": None,
            "is_deleted": False, "reactions": {},
            "reply_to_id": inp.reply_to_id, "mention_ids": mention_data["mentioned_user_ids"],
            "mentioned_user_ids": mention_data["mentioned_user_ids"],
            "mentioned_role_ids": mention_data["mentioned_role_ids"],
            "mentions_everyone": mention_data["mentions_everyone"],
            "thread_id": None, "thread_count": 0, "created_at": now_utc(),
            "is_e2ee": False,
        }
    await db.messages.insert_one(msg)
    msg.pop("_id", None)
    msg["author"] = user
    await hydrate_message_mentions(msg)
    
    try:
        await ws_mgr.broadcast_server(ch["server_id"], {"type": "new_message", "message": msg, "channel_id": channel_id})
    except Exception as e:
        logger.error(f"Failed to broadcast message: {e}")

    # Notifications are deduplicated across direct mentions, role mentions and
    # @everyone so a user only receives one notification per message.
    for mid in mention_data["notify_user_ids"]:
        if mid != user["id"]:
            try:
                await create_notification(
                    mid,
                    ntype="mention",
                    title=f"@{user['display_name']} mentioned you",
                    body="[Encrypted message]" if is_e2ee_channel else inp.content[:100],
                    link=f"/channel/{channel_id}",
                    from_user_id=user["id"],
                )
            except Exception as e:
                logger.error(f"Failed to create notification for {mid}: {e}")
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
    if msg.get("is_e2ee"):
        raise HTTPException(400, "Editing encrypted messages is not supported yet")
    old_content = msg["content"]
    new_content = body.get("content", old_content)
    ch = await db.channels.find_one({"id": msg["channel_id"]}, {"_id": 0}) if msg.get("channel_id") else None
    mention_data = await resolve_message_mentions(
        server_id=ch["server_id"],
        actor_id=user["id"],
        channel=ch,
        content=new_content,
        mentioned_user_ids=[],
        mentioned_role_ids=[],
        mentions_everyone=False,
    ) if ch else {
        "mentioned_user_ids": [],
        "mentioned_role_ids": [],
        "mentions_everyone": False,
    }
    await db.messages.update_one({"id": message_id}, {"$set": {
        "content": new_content,
        "edited_at": now_utc(),
        "mention_ids": mention_data["mentioned_user_ids"],
        "mentioned_user_ids": mention_data["mentioned_user_ids"],
        "mentioned_role_ids": mention_data["mentioned_role_ids"],
        "mentions_everyone": mention_data["mentions_everyone"],
    }})
    await db.message_revisions.insert_one({
        "id": new_id(), "message_id": message_id, "content": old_content,
        "editor_id": user["id"], "edited_at": now_utc()
    })
    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    msg["author"] = user
    await hydrate_message_mentions(msg)
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
    can_manage = ch and await check_permission(user["id"], ch["server_id"], "manage_messages", channel=ch)
    if not is_author and not can_manage:
        raise HTTPException(403, "No permission")
    await db.messages.update_one({"id": message_id}, {"$set": {"is_deleted": True, "content": "[deleted]"}})
    if ch:
        await ws_mgr.broadcast_server(ch["server_id"], {"type": "message_delete", "message_id": message_id, "channel_id": msg["channel_id"]})
    return {"ok": True}

@messages_r.get("/{message_id}")
async def get_message(message_id: str, request: Request):
    user = await current_user(request)
    msg = await db.messages.find_one({"id": message_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Message not found")

    channel = await db.channels.find_one({"id": msg["channel_id"]}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not await check_permission(user["id"], channel["server_id"], "read_messages", channel=channel):
        raise HTTPException(403, "No permission")
    await ensure_private_channel_member_access(user["id"], channel)
    history_cutoff = await get_message_history_cutoff(user["id"], channel["server_id"], channel=channel)
    if history_cutoff and msg.get("created_at") and msg["created_at"] < history_cutoff:
        raise HTTPException(403, "No permission to read message history")

    # The jump-to-message flow reuses the same hydrated payload shape as the
    # channel timeline, so the frontend can merge a fetched message without
    # having to special-case authors or deleted states.
    author = await db.users.find_one({"id": msg["author_id"]}, {"_id": 0, "password_hash": 0})
    msg["author"] = sanitize_user(author) if author else None
    await hydrate_message_mentions(msg)
    return msg

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
    limit = clamp_page_limit(limit)
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
    next_before = messages[0]["created_at"] if messages else None
    return {
        "messages": messages,
        "next_before": next_before,
        "has_more_before": len(messages) == limit,
    }

@dm_r.post("/{other_user_id}")
async def send_dm(other_user_id: str, inp: DMCreateInput, request: Request):
    user = await current_user(request)
    other = await db.users.find_one({"id": other_user_id}, {"_id": 0})
    if not other:
        raise HTTPException(404, "User not found")
    sender_account = await get_e2ee_account(user["id"])
    receiver_account = await get_e2ee_account(other_user_id)
    use_e2ee = bool(sender_account and receiver_account)

    if use_e2ee:
        device = await require_verified_device(request, user)
        if not inp.is_e2ee or not inp.ciphertext or not inp.nonce or not inp.sender_device_id:
            raise HTTPException(400, "Direct messages require encrypted desktop payloads when both users use end-to-end encryption")
        if inp.sender_device_id != device["device_id"]:
            raise HTTPException(400, "Encrypted messages must originate from the active E2EE device")

    msg = {
        "id": new_id(),
        "sender_id": user["id"],
        "receiver_id": other_user_id,
        "content": inp.content if not use_e2ee else "[encrypted]",
        "encrypted_content": inp.encrypted_content or inp.ciphertext or "",
        "is_encrypted": inp.is_encrypted or use_e2ee,
        "is_e2ee": use_e2ee,
        "nonce": inp.nonce or "",
        "attachments": inp.attachments,
        "sender_device_id": inp.sender_device_id or None,
        "protocol_version": inp.protocol_version or E2EE_PROTOCOL_VERSION,
        "message_type": inp.message_type or "text",
        "key_envelopes": inp.key_envelopes or [],
        "read": False,
        "created_at": now_utc(),
    }
    await db.direct_messages.insert_one(msg)
    msg.pop("_id", None)
    msg["sender"] = {k: v for k, v in user.items() if k != "password_hash"}
    await ws_mgr.send(other_user_id, {"type": "dm_message", "message": msg})
    # DM notification
    await create_notification(
        other_user_id,
        ntype="dm",
        title=f"DM from {user['display_name']}",
        body="[Encrypted message]" if use_e2ee or inp.is_encrypted else inp.content[:100],
        link=f"/dm/{user['id']}",
        from_user_id=user["id"],
    )
    return msg

# ============================================================
# INVITE ROUTES
# ============================================================
invites_r = APIRouter(prefix="/api/invites", tags=["Invites"])


def invite_is_expired(invite: dict) -> bool:
    expires_at = invite.get("expires_at")
    return bool(expires_at and datetime.fromisoformat(expires_at) < datetime.now(timezone.utc))


def invite_is_exhausted(invite: dict) -> bool:
    max_uses = int(invite.get("max_uses") or 0)
    if max_uses <= 0:
        return False
    return int(invite.get("uses") or 0) >= max_uses

@invites_r.get("/{code}")
async def get_invite(code: str):
    invite = await db.invites.find_one({"code": code}, {"_id": 0})
    if not invite:
        raise HTTPException(404, "Invite not found")
    if invite_is_expired(invite):
        raise HTTPException(410, "Invite expired")
    if invite_is_exhausted(invite):
        raise HTTPException(410, "Invite exhausted")
    server = await db.servers.find_one({"id": invite["server_id"]}, {"_id": 0})
    return {"invite": invite, "server": server}

@invites_r.post("/{code}/accept")
async def accept_invite(code: str, request: Request):
    user = await current_user(request)
    await enforce_fixed_window_rate_limit(
        db,
        scope="invites.accept",
        key=f"{user['id']}:{code}",
        limit=15,
        window_seconds=10 * 60,
        error_message="Too many invite accept attempts. Try again later.",
        code="invite_accept_rate_limited",
    )
    invite = await db.invites.find_one({"code": code}, {"_id": 0})
    if not invite:
        raise HTTPException(404, "Invite not found")
    if invite_is_expired(invite):
        raise HTTPException(410, "Invite expired")
    existing = await db.server_members.find_one({"server_id": invite["server_id"], "user_id": user["id"]}, {"_id": 0})
    if existing:
        if existing.get("is_banned"):
            raise HTTPException(403, "You are banned")
        return {"ok": True, "server_id": invite["server_id"]}
    if invite_is_exhausted(invite):
        raise HTTPException(410, "Invite exhausted")
    await db.server_members.insert_one({
        "server_id": invite["server_id"], "user_id": user["id"],
        # The default @everyone permissions are applied implicitly through
        # check_permission, so memberships only store explicit extra roles.
        "roles": [],
        "nickname": "", "joined_at": now_utc(), "muted_until": None, "is_banned": False, "ban_reason": ""
    })
    # The invite usage counter is incremented atomically so concurrent accepts
    # cannot bypass a finite max-use limit.
    usage_query = {"code": code}
    if invite.get("max_uses"):
        usage_query["uses"] = {"$lt": invite["max_uses"]}
    invite_after_increment = await db.invites.find_one_and_update(
        usage_query,
        {"$inc": {"uses": 1}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not invite_after_increment:
        await db.server_members.delete_one({"server_id": invite["server_id"], "user_id": user["id"]})
        raise HTTPException(410, "Invite exhausted")
    ws_mgr.add_server(user["id"], invite["server_id"])
    member_payload = await build_member_payload(invite["server_id"], user["id"])
    await ws_mgr.broadcast_server(
        invite["server_id"],
        {
            "type": "member_joined",
            "server_id": invite["server_id"],
            "member": member_payload,
            "user": sanitize_user(user),
        },
    )
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
    next_username = updates.pop("username", None)
    if next_username is not None:
        normalized_username = normalize_username(next_username)
        if normalized_username != user["username"]:
            existing_user = await db.users.find_one({"username": normalized_username}, {"_id": 0, "id": 1})
            if existing_user and existing_user.get("id") != user["id"]:
                raise HTTPException(400, "Username taken")
            updates["username"] = normalized_username
    if updates:
        if "status" in updates and updates["status"] != user.get("status"):
            await log_status_history(user["id"], updates["status"])
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
        await broadcast_presence_update(user["id"])
    return await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})


@users_r.put("/me/password")
async def change_password(inp: PasswordChangeInput, request: Request):
    user = await current_user(request)
    stored_user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not stored_user or not verify_pw(inp.current_password, stored_user["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    if inp.current_password == inp.new_password:
        raise HTTPException(400, "New password must be different from the current password")

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_pw(inp.new_password)}},
    )
    await db.email_verifications.delete_many({"user_id": user["id"], "purpose": PASSWORD_RESET_PURPOSE})
    return {"ok": True}

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
app.include_router(e2ee_r)
app.include_router(setup_r)
app.include_router(instance_r)
app.include_router(servers_r)
app.include_router(voice_r)
app.include_router(channels_r)
app.include_router(messages_r)
app.include_router(dm_r)
app.include_router(invites_r)
app.include_router(users_r)

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Singra Vox"}

# ─── New modular route imports (replacing legacy phase2 / phase3 files) ──────
from app.routes.threads import router as threads_router
from app.routes.search import router as search_router
from app.routes.unread import router as unread_router
from app.routes.overrides import router as overrides_router
from app.routes.groups import router as groups_router
from app.routes.gdpr import router as gdpr_router
from app.routes.pins import router as pins_router
from app.routes.notifications import router as notifications_router
from app.routes.emojis import router as emojis_router
from app.routes.webhooks import router as webhooks_router
from app.routes.bots import router as bots_router
from app.routes.files import router as files_router
from app.services.notifications import send_notification as create_notification

app.include_router(threads_router)
app.include_router(search_router)
app.include_router(unread_router)
app.include_router(overrides_router)
app.include_router(groups_router)
app.include_router(gdpr_router)
app.include_router(pins_router)
app.include_router(notifications_router)
app.include_router(emojis_router)
app.include_router(webhooks_router)
app.include_router(bots_router)
app.include_router(files_router)


async def migrate_legacy_instance_state():
    settings = await db.instance_settings.find_one({"id": INSTANCE_SETTINGS_ID}, {"_id": 0})
    if settings:
        return

    legacy_users = await db.users.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    if not legacy_users:
        return

    owner = next((user for user in legacy_users if user.get("role") in {OWNER_ROLE, ADMIN_ROLE}), legacy_users[0])
    await db.instance_settings.insert_one({
        "id": INSTANCE_SETTINGS_ID,
        "initialized": True,
        "instance_name": "Singra Vox",
        "owner_user_id": owner["id"],
        "allow_open_signup": True,
        "created_at": owner.get("created_at", now_utc()),
        "setup_completed_at": now_utc(),
        "migrated_from_legacy": True,
    })
    for legacy_user in legacy_users:
        instance_role = USER_ROLE
        if legacy_user["id"] == owner["id"]:
            instance_role = OWNER_ROLE
        elif legacy_user.get("role") == ADMIN_ROLE:
            instance_role = ADMIN_ROLE
        await db.users.update_one(
            {"id": legacy_user["id"]},
            {"$set": {"instance_role": instance_role, "role": instance_role}},
        )
    logger.info("Migrated legacy instance state into instance_settings")


async def migrate_default_roles():
    default_roles = await db.roles.find({"is_default": True}, {"_id": 0}).to_list(500)
    for role in default_roles:
        await db.roles.update_one(
            {"id": role["id"]},
            {
                "$set": {
                    "name": "@everyone",
                    "mentionable": False,
                    "permissions": {**DEFAULT_PERMISSIONS, **(role.get("permissions") or {})},
                }
            },
        )
        await db.server_members.update_many(
            {"server_id": role["server_id"], "roles": role["id"]},
            {"$pull": {"roles": role["id"]}},
        )
    if default_roles:
        logger.info("Normalized default roles to @everyone")


async def migrate_email_verification_state():
    result = await db.users.update_many(
        {"email_verified": {"$exists": False}},
        {"$set": {"email_verified": True, "email_verified_at": now_utc()}},
    )
    if result.modified_count:
        logger.info("Marked %s legacy users as email verified", result.modified_count)

# ============================================================
# WebSocket
# ============================================================
@app.websocket("/api/ws")
async def ws_endpoint(websocket: WebSocket, token: str = Query(None), platform: str = Query("web")):
    ws_token = token
    if not ws_token:
        ws_token = websocket.cookies.get("access_token")
    if not ws_token:
        await websocket.close(code=4001)
        return
    try:
        p = pyjwt.decode(ws_token, jwt_secret, algorithms=[JWT_ALG])
        if p.get("type") != "access" or not p.get("sid"):
            await websocket.close(code=4001)
            return
        session = await load_active_session(db, session_id=p["sid"])
        if not session:
            await websocket.close(code=4001)
            return
        uid = p["sub"]
        user = await db.users.find_one({"id": uid}, {"_id": 0})
        if not user:
            await websocket.close(code=4001)
            return
    except Exception:
        await websocket.close(code=4001)
        return
    
    connection_id = await ws_mgr.connect(websocket, uid, platform, p["sid"])
    
    # Initialize user servers and presence
    if uid not in ws_mgr.user_servers:
        members = await db.server_members.find(
            {"user_id": uid, "is_banned": {"$ne": True}}, {"_id": 0, "server_id": 1}
        ).to_list(100)
        ws_mgr.user_servers[uid] = {m["server_id"] for m in members}
    
    if len(ws_mgr.conns[uid]) == 1:
        # Check if user has a preferred status, otherwise default to online
        current_status = user.get("status", "online")
        if current_status == "offline":
            current_status = "online"
        
        await db.users.update_one({"id": uid}, {"$set": {"status": current_status, "last_seen": now_utc()}})
        await log_status_history(uid, current_status)
        await broadcast_presence_update(uid)

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
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error(f"WS error: {e}")
    finally:
        remaining_connections = ws_mgr.disconnect(uid, connection_id)
        if remaining_connections == 0:
            await db.users.update_one({"id": uid}, {"$set": {"status": "offline", "last_seen": now_utc()}})
            await log_status_history(uid, "offline")
            await clear_voice_membership(uid)
            await broadcast_presence_update(uid)

# ============================================================
# Startup
# ============================================================
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("username")
    await db.users.create_index("id", unique=True)
    await db.users.create_index("instance_role")
    await db.instance_settings.create_index("id", unique=True)
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
    await db.email_verifications.create_index([("user_id", 1), ("purpose", 1)], unique=True)
    await db.email_verifications.create_index("expires_at")
    await db.voice_states.create_index("user_id")
    await db.audit_log.create_index([("server_id", 1), ("created_at", -1)])
    await db.auth_sessions.create_index("session_id", unique=True)
    await db.auth_sessions.create_index([("user_id", 1), ("issued_at", -1)])
    await db.auth_sessions.create_index("refresh_token_hash", unique=True)
    await db.auth_sessions.create_index("expires_at")
    await db.rate_limits.create_index([("scope", 1), ("key_hash", 1), ("window_id", 1)], unique=True)
    await db.rate_limits.create_index("expires_at")
    await db.e2ee_accounts.create_index("user_id", unique=True)
    await db.e2ee_devices.create_index([("user_id", 1), ("device_id", 1)], unique=True)
    await db.e2ee_devices.create_index([("user_id", 1), ("verified_at", 1), ("revoked_at", 1)])
    await db.e2ee_blob_uploads.create_index("id", unique=True)
    await db.e2ee_blobs.create_index("id", unique=True)
    await db.e2ee_blobs.create_index([("scope_kind", 1), ("scope_id", 1), ("created_at", -1)])
    await db.e2ee_media_keys.create_index([("channel_id", 1), ("created_at", -1)])
    await db.push_subscriptions.create_index([("user_id", 1), ("subscription.endpoint", 1)], unique=True)
    await db.status_history.create_index([("user_id", 1), ("created_at", -1)])
    # ── Phase-2 indexes (read_states, revisions, overrides, groups, keys) ──
    await db.read_states.create_index([("user_id", 1), ("channel_id", 1)], unique=True)
    await db.message_revisions.create_index("message_id")
    await db.channel_overrides.create_index([("channel_id", 1), ("target_type", 1), ("target_id", 1)])
    await db.channel_access.create_index("channel_id")
    await db.group_conversations.create_index("id", unique=True)
    await db.group_messages.create_index([("group_id", 1), ("created_at", -1)])
    await db.key_bundles.create_index("user_id", unique=True)
    # ── Phase-3 indexes (notifications, emojis, webhooks, bots) ────────────
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.notifications.create_index("id", unique=True)
    await db.server_emojis.create_index([("server_id", 1), ("name", 1)], unique=True)
    await db.server_emojis.create_index("id", unique=True)
    await db.webhooks.create_index("id", unique=True)
    await db.webhooks.create_index("token", unique=True)
    await db.webhook_logs.create_index([("webhook_id", 1), ("created_at", -1)])
    await db.bot_tokens.create_index("id", unique=True)
    await db.bot_tokens.create_index("token", unique=True)
    # ── Files index (local-filesystem storage) ─────────────────────────────
    await db.files.create_index("id", unique=True)
    await db.files.create_index([("uploaded_by", 1), ("created_at", -1)])
    await ensure_bucket()

    await migrate_legacy_instance_state()
    await migrate_default_roles()
    await migrate_email_verification_state()

    Path("/app/memory").mkdir(exist_ok=True)
    with open("/app/memory/test_credentials.md", "w") as f:
        f.write("# Singra Vox Setup\n\n")
        f.write("- Open `/setup` on the instance after the first start.\n")
        f.write("- The first admin is created through the setup wizard.\n\n")
        f.write("## Auth Endpoints\n- POST /api/setup/bootstrap\n- POST /api/auth/register\n- POST /api/auth/verify-email\n- POST /api/auth/resend-verification\n- POST /api/auth/forgot-password\n- POST /api/auth/reset-password\n- POST /api/auth/login\n- POST /api/auth/logout\n- POST /api/auth/logout-all\n- GET /api/auth/me\n- GET /api/auth/sessions\n- DELETE /api/auth/sessions/{id}\n- POST /api/auth/refresh\n")

    logger.info("Singra Vox backend started")

@app.on_event("shutdown")
async def shutdown():
    client.close()
