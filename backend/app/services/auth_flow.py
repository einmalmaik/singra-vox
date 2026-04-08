from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Callable

from fastapi import HTTPException, Request, Response

from app.auth_service import (
    build_access_token,
    create_auth_session,
    hash_password,
    set_auth_cookies,
    verify_password,
)
from app.core.config import (
    APP_NAME,
    EMAIL_VERIFICATION_CODE_LENGTH,
    EMAIL_VERIFICATION_PURPOSE,
    EMAIL_VERIFICATION_TTL_MINUTES,
    PASSWORD_RESET_PURPOSE,
    PASSWORD_RESET_TTL_MINUTES,
    USERNAME_PATTERN,
    jwt_secret,
)
from app.core.database import db
from app.core.utils import new_id, now_utc, sanitize_user
from app.dependencies import get_instance_settings, request_device_id
from app.emailing import render_password_reset_email, render_verification_email, send_email


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


async def ensure_unique_identity(email: str, username: str) -> None:
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


async def issue_auth_code(
    *,
    user: dict,
    purpose: str,
    expires_minutes: int,
    email_renderer: Callable[..., tuple[str, str, str]],
) -> dict:
    code = generate_numeric_code()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)).isoformat()
    email = user["email"].lower().strip()
    await db.email_verifications.delete_many({"user_id": user["id"], "purpose": purpose})
    await db.email_verifications.insert_one(
        {
            "id": new_id(),
            "user_id": user["id"],
            "email": email,
            "purpose": purpose,
            "code_hash": hash_verification_code(email=email, purpose=purpose, code=code),
            "expires_at": expires_at,
            "created_at": now_utc(),
        }
    )

    settings = await get_instance_settings()
    subject, text_body, html_body = email_renderer(
        app_name=APP_NAME,
        instance_name=settings.get("instance_name") or APP_NAME,
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


def auth_response_for_user(
    user: dict,
    *,
    access_token: str,
    refresh_token: str,
    session_id: str,
) -> dict:
    return {
        "user": sanitize_user(user),
        "access_token": access_token,
        "refresh_token": refresh_token,
        "session_id": session_id,
    }


async def issue_auth_response(user: dict, request: Request, response: Response) -> dict:
    auth_config = request.app.state.auth_config
    session, access_token, refresh_token = await create_auth_session(
        db,
        user=user,
        request=request,
        auth_config=auth_config,
        device_id=request_device_id(request),
    )
    set_auth_cookies(
        response=response,
        access_token=access_token,
        refresh_token=refresh_token,
        cookie_secure=auth_config.cookie_secure,
    )
    return auth_response_for_user(
        user,
        access_token=access_token,
        refresh_token=refresh_token,
        session_id=session["session_id"],
    )


def issue_ephemeral_access_token(user: dict, *, session_id: str, jwt_secret_value: str) -> str:
    return build_access_token(
        user_id=user["id"],
        email=user.get("email", ""),
        session_id=session_id,
        jwt_secret=jwt_secret_value,
    )
