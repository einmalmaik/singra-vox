from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
import uuid
from typing import Optional

import bcrypt
import jwt as pyjwt
from argon2 import PasswordHasher
from argon2.exceptions import Argon2Error, VerifyMismatchError
from fastapi import HTTPException, Request, Response


JWT_ALG = "HS256"
ACCESS_TOKEN_TTL = timedelta(hours=1)
REFRESH_TOKEN_TTL = timedelta(days=14)
CLIENT_PLATFORM_HEADER = "X-Singra-Client-Platform"

password_hasher = PasswordHasher(
    time_cost=3,
    memory_cost=65536,
    parallelism=4,
    hash_len=32,
    salt_len=16,
)


@dataclass
class AuthConfig:
    jwt_secret: str
    cookie_secure: bool = False

    def __post_init__(self):
        self.jwt_secret = normalize_jwt_secret(self.jwt_secret)


def new_id() -> str:
    return str(uuid.uuid4())


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def now_utc_iso() -> str:
    return now_utc().isoformat()


def normalize_jwt_secret(secret: str) -> str:
    normalized = (secret or "").strip()
    if not normalized:
        raise ValueError("JWT secret must not be empty")
    if len(normalized.encode("utf-8")) >= 32:
        return normalized
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def _looks_like_bcrypt(value: str) -> bool:
    return value.startswith("$2a$") or value.startswith("$2b$") or value.startswith("$2y$")


def verify_password(plain: str, hashed: str) -> tuple[bool, bool]:
    try:
        if _looks_like_bcrypt(hashed):
            return (
                bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8")),
                True,
            )
        password_hasher.verify(hashed, plain)
        return True, password_hasher.check_needs_rehash(hashed)
    except VerifyMismatchError:
        return False, False
    except (Argon2Error, ValueError):
        return False, False


def mask_user_agent(user_agent: str) -> str:
    return (user_agent or "").strip()[:512]


def normalize_client_platform(request: Request) -> str:
    explicit = (request.headers.get(CLIENT_PLATFORM_HEADER) or "").strip().lower()
    if explicit in {"desktop", "web"}:
        return explicit
    origin = (request.headers.get("origin") or "").lower()
    user_agent = (request.headers.get("user-agent") or "").lower()
    if "tauri" in origin or "tauri" in user_agent:
        return "desktop"
    return "web"


def get_request_token(request: Request, *, prefer_refresh: bool = False) -> Optional[str]:
    cookie_name = "refresh_token" if prefer_refresh else "access_token"
    token = request.cookies.get(cookie_name)
    if token:
        return token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return None


def set_auth_cookies(response: Response, *, access_token: str, refresh_token: str, cookie_secure: bool) -> None:
    response.set_cookie(
        "access_token",
        access_token,
        httponly=True,
        secure=cookie_secure,
        samesite="lax",
        max_age=int(ACCESS_TOKEN_TTL.total_seconds()),
        path="/",
    )
    response.set_cookie(
        "refresh_token",
        refresh_token,
        httponly=True,
        secure=cookie_secure,
        samesite="lax",
        max_age=int(REFRESH_TOKEN_TTL.total_seconds()),
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")


def build_access_token(*, user_id: str, email: str, session_id: str, jwt_secret: str) -> str:
    issued_at = now_utc()
    return pyjwt.encode(
        {
            "sub": user_id,
            "email": email,
            "sid": session_id,
            "iat": issued_at,
            "exp": issued_at + ACCESS_TOKEN_TTL,
            "type": "access",
        },
        jwt_secret,
        algorithm=JWT_ALG,
    )


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_refresh_token(token: str, jwt_secret: str) -> str:
    return hashlib.sha256(f"{jwt_secret}:{token}".encode("utf-8")).hexdigest()


def hash_client_ip(ip_address: str, jwt_secret: str) -> str:
    if not ip_address:
        return ""
    return hashlib.sha256(f"{jwt_secret}:ip:{ip_address}".encode("utf-8")).hexdigest()


async def create_auth_session(
    db,
    *,
    user: dict,
    request: Request,
    auth_config: AuthConfig,
    device_id: Optional[str] = None,
    session_family_id: Optional[str] = None,
    replaced_session_id: Optional[str] = None,
):
    session_id = new_id()
    refresh_token = generate_refresh_token()
    refresh_hash = hash_refresh_token(refresh_token, auth_config.jwt_secret)
    created_at = now_utc()
    expires_at = created_at + REFRESH_TOKEN_TTL
    user_agent = mask_user_agent(request.headers.get("user-agent", ""))
    platform = normalize_client_platform(request)
    ip_address = request.client.host if request.client else ""
    family_id = session_family_id or session_id

    session_doc = {
        "session_id": session_id,
        "session_family_id": family_id,
        "user_id": user["id"],
        "device_id": device_id or None,
        "platform": platform,
        "refresh_token_hash": refresh_hash,
        "issued_at": created_at.isoformat(),
        "expires_at": expires_at.isoformat(),
        "revoked_at": None,
        "replaced_by": None,
        "last_seen_at": created_at.isoformat(),
        "ip_hash": hash_client_ip(ip_address, auth_config.jwt_secret),
        "user_agent": user_agent,
    }
    if replaced_session_id:
        session_doc["replaced_from"] = replaced_session_id

    await db.auth_sessions.insert_one(session_doc)
    access_token = build_access_token(
        user_id=user["id"],
        email=user.get("email", ""),
        session_id=session_id,
        jwt_secret=auth_config.jwt_secret,
    )

    return session_doc, access_token, refresh_token


async def mark_session_seen(db, session_id: str):
    await db.auth_sessions.update_one(
        {"session_id": session_id},
        {"$set": {"last_seen_at": now_utc_iso()}},
    )


async def revoke_session(db, session_id: str):
    await db.auth_sessions.update_one(
        {"session_id": session_id, "revoked_at": None},
        {"$set": {"revoked_at": now_utc_iso()}},
    )


async def revoke_user_sessions(db, user_id: str):
    await db.auth_sessions.update_many(
        {"user_id": user_id, "revoked_at": None},
        {"$set": {"revoked_at": now_utc_iso()}},
    )


async def revoke_all_family_sessions(db, session_family_id: str):
    await db.auth_sessions.update_many(
        {"session_family_id": session_family_id, "revoked_at": None},
        {"$set": {"revoked_at": now_utc_iso()}},
    )


async def load_active_session(db, *, session_id: str) -> Optional[dict]:
    session = await db.auth_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not session:
        return None
    if session.get("revoked_at"):
        return None
    expires_at = session.get("expires_at")
    if expires_at and datetime.fromisoformat(expires_at) <= now_utc():
        return None
    return session


async def load_current_user(db, request: Request) -> tuple[dict, dict]:
    token = get_request_token(request)
    if not token:
        raise HTTPException(401, {"code": "not_authenticated", "message": "Not authenticated"})

    try:
        payload = pyjwt.decode(token, options={"verify_signature": False}, algorithms=[JWT_ALG])
        session_id = payload.get("sid")
    except pyjwt.InvalidTokenError as exc:
        raise HTTPException(401, {"code": "invalid_token", "message": "Invalid token"}) from exc

    try:
        payload = pyjwt.decode(token, request.app.state.auth_config.jwt_secret, algorithms=[JWT_ALG])
    except pyjwt.ExpiredSignatureError as exc:
        raise HTTPException(401, {"code": "token_expired", "message": "Token expired"}) from exc
    except pyjwt.InvalidTokenError as exc:
        raise HTTPException(401, {"code": "invalid_token", "message": "Invalid token"}) from exc

    if payload.get("type") != "access" or not session_id:
        raise HTTPException(401, {"code": "invalid_token", "message": "Invalid token"})

    session = await load_active_session(db, session_id=session_id)
    if not session:
        raise HTTPException(401, {"code": "session_revoked", "message": "Session expired or revoked"})

    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0})
    if not user:
        raise HTTPException(401, {"code": "user_not_found", "message": "User not found"})

    await mark_session_seen(db, session_id)
    return user, session


async def refresh_auth_session(
    db,
    *,
    refresh_token: str,
    request: Request,
    auth_config: AuthConfig,
    requested_device_id: Optional[str] = None,
):
    refresh_hash = hash_refresh_token(refresh_token, auth_config.jwt_secret)
    session = await db.auth_sessions.find_one({"refresh_token_hash": refresh_hash}, {"_id": 0})
    if not session:
        raise HTTPException(401, {"code": "invalid_refresh_token", "message": "Invalid refresh token"})

    if session.get("revoked_at"):
        await revoke_all_family_sessions(db, session.get("session_family_id") or session["session_id"])
        raise HTTPException(401, {"code": "refresh_token_reused", "message": "Refresh token has already been used"})

    expires_at = session.get("expires_at")
    if expires_at and datetime.fromisoformat(expires_at) <= now_utc():
        await revoke_session(db, session["session_id"])
        raise HTTPException(401, {"code": "refresh_token_expired", "message": "Refresh token expired"})

    user = await db.users.find_one({"id": session["user_id"]}, {"_id": 0})
    if not user:
        await revoke_session(db, session["session_id"])
        raise HTTPException(401, {"code": "user_not_found", "message": "User not found"})

    await db.auth_sessions.update_one(
        {"session_id": session["session_id"]},
        {"$set": {"revoked_at": now_utc_iso()}},
    )

    new_session, access_token, next_refresh_token = await create_auth_session(
        db,
        user=user,
        request=request,
        auth_config=auth_config,
        device_id=requested_device_id or session.get("device_id"),
        session_family_id=session.get("session_family_id") or session["session_id"],
        replaced_session_id=session["session_id"],
    )
    await db.auth_sessions.update_one(
        {"session_id": session["session_id"]},
        {"$set": {"replaced_by": new_session["session_id"]}},
    )
    return user, new_session, access_token, next_refresh_token


async def list_user_sessions(db, user_id: str) -> list[dict]:
    sessions = await db.auth_sessions.find(
        {"user_id": user_id},
        {
            "_id": 0,
            "refresh_token_hash": 0,
            "ip_hash": 0,
        },
    ).sort("issued_at", -1).to_list(100)
    return sessions
