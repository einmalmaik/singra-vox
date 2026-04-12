# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox ID – API Routes
============================

All REST endpoints for the central identity service.
Mounted under /api/id/ in the main FastAPI application.

Endpoints:
    Registration & Email:
        POST /api/id/register          – Create account
        POST /api/id/verify-email      – Verify email code
        POST /api/id/resend-verification

    Authentication:
        POST /api/id/login             – Login (returns token or 2FA challenge)
        POST /api/id/login/2fa         – Complete login with TOTP code
        POST /api/id/logout

    Profile:
        GET  /api/id/me                – Get own profile
        PUT  /api/id/me                – Update profile

    Password:
        POST /api/id/password/check    – Check strength (no auth required)
        POST /api/id/password/generate – Generate secure password
        POST /api/id/password/change   – Change password (authenticated)
        POST /api/id/password/forgot   – Request password reset
        POST /api/id/password/reset    – Reset with code

    Two-Factor:
        POST /api/id/2fa/setup         – Start 2FA enrollment
        POST /api/id/2fa/confirm       – Confirm with first TOTP code
        POST /api/id/2fa/disable       – Disable 2FA

    OAuth2 / OpenID Connect:
        POST /api/id/oauth/clients     – Register instance as client
        POST /api/id/oauth/authorize   – Authorization endpoint
        POST /api/id/oauth/token       – Token exchange
        GET  /api/id/oauth/userinfo    – User profile for instances
        GET  /api/id/.well-known/openid-configuration

    Instances:
        GET  /api/id/instances         – List user's connected instances
"""
import hashlib
import logging
import re
import secrets
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Request
import jwt as pyjwt
from pydantic import BaseModel

from app.identity.config import (
    SVID_JWT_SECRET,
    SVID_JWT_ALG,
    SVID_ISSUER,
    SVID_EMAIL_VERIFICATION_TTL_MINUTES,
    SVID_PASSWORD_RESET_TTL_MINUTES,
    SVID_ACCESS_TOKEN_TTL_MINUTES,
    SVID_REFRESH_TOKEN_TTL_DAYS,
)
from app.identity.models import (
    SvidRegisterInput,
    SvidVerifyEmailInput,
    SvidResendVerificationInput,
    SvidLoginInput,
    SvidLogin2FAInput,
    SvidProfileUpdateInput,
    SvidEnable2FAInput,
    SvidDisable2FAInput,
    SvidPasswordCheckInput,
    SvidPasswordChangeInput,
    SvidForgotPasswordInput,
    SvidResetPasswordInput,
    SvidOAuthAuthorizeInput,
    SvidOAuthTokenInput,
    SvidOAuthClientRegisterInput,
)
from app.identity.password import (
    check_password_strength,
    generate_secure_password,
    validate_password_policy,
)
from app.identity.totp import (
    generate_backup_codes,
    generate_totp_secret,
    get_totp_uri,
    normalize_backup_code,
    verify_totp_code,
)
from app.identity.oauth2 import (
    build_id_token,
    build_oauth_code_record,
    build_svid_access_token,
    decode_svid_token,
    generate_authorization_code,
    generate_client_credentials,
    hash_authorization_code,
)
from app.auth_service import hash_password, verify_password
from app.emailing import render_verification_email, render_password_reset_email, send_email

logger = logging.getLogger(__name__)

# ── Router ───────────────────────────────────────────────────────────────────
router = APIRouter(prefix="/api/id", tags=["Singra Vox ID"])

# Database reference – set by mount_identity_routes()
_db = None

USERNAME_PATTERN = re.compile(r"^[a-z0-9_]{3,32}$")


def mount_identity_routes(app, db):
    """Register identity routes and inject database dependency."""
    global _db
    _db = db
    app.include_router(router)
    logger.info("Singra Vox ID routes mounted at /api/id")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


def _sanitize_account(account: dict) -> dict:
    """Remove sensitive fields before sending to client."""
    safe = dict(account)
    safe.pop("_id", None)
    safe.pop("password_hash", None)
    return safe


def _hash_code(*, email: str, purpose: str, code: str) -> str:
    payload = f"{SVID_JWT_SECRET}:{email.lower().strip()}:{purpose}:{code}".encode()
    return hashlib.sha256(payload).hexdigest()


def _generate_numeric_code(length: int = 6) -> str:
    return "".join(secrets.choice("0123456789") for _ in range(length))


async def _get_current_account(request: Request) -> dict:
    """Extract and validate the Singra Vox ID access token from request."""
    auth_header = request.headers.get("Authorization", "")
    token = ""
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
    if not token:
        token = request.cookies.get("svid_access_token", "")
    if not token:
        raise HTTPException(401, "Authentication required")

    try:
        payload = decode_svid_token(token)
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except pyjwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

    account = await _db.svid_accounts.find_one({"id": payload["sub"]}, {"_id": 0})
    if not account:
        raise HTTPException(401, "Account not found")
    return account


async def _issue_auth_code_email(*, account: dict, purpose: str, ttl_minutes: int, renderer):
    """Send a verification/reset code via email."""
    code = _generate_numeric_code()
    email = account["email"].lower().strip()
    expires_at = (datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)).isoformat()

    await _db.svid_email_codes.delete_many({"account_id": account["id"], "purpose": purpose})
    await _db.svid_email_codes.insert_one({
        "id": _new_id(),
        "account_id": account["id"],
        "email": email,
        "purpose": purpose,
        "code_hash": _hash_code(email=email, purpose=purpose, code=code),
        "expires_at": expires_at,
        "created_at": _now(),
    })

    subject, text_body, html_body = renderer(
        app_name="Singra Vox ID",
        instance_name="Singra Vox ID",
        code=code,
        expires_minutes=ttl_minutes,
    )
    await send_email(to_email=email, subject=subject, text_body=text_body, html_body=html_body)
    return {"email": email, "expires_at": expires_at}


# ═════════════════════════════════════════════════════════════════════════════
# REGISTRATION & EMAIL VERIFICATION
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/register")
async def svid_register(inp: SvidRegisterInput):
    """
    Create a new Singra Vox ID account.

    The account is created with email_verified=False.  A 6-digit
    verification code is sent to the provided email address.
    """
    email = inp.email.lower().strip()
    username = inp.username.lower().strip()

    if not USERNAME_PATTERN.fullmatch(username):
        raise HTTPException(400, "Username must be 3-32 chars: lowercase letters, numbers, underscores")

    # Password policy
    policy_errors = validate_password_policy(inp.password)
    if policy_errors:
        raise HTTPException(400, {"code": "weak_password", "errors": policy_errors})

    # Uniqueness – unverifizierte Accounts dürfen überschrieben werden
    existing_email = await _db.svid_accounts.find_one({"email": email}, {"_id": 0})
    if existing_email:
        if existing_email.get("email_verified"):
            raise HTTPException(400, "Email already registered")
        # Unverifiziert → Account-Daten aktualisieren und neuen Code senden
        await _db.svid_accounts.update_one(
            {"email": email},
            {"$set": {
                "username": username,
                "display_name": inp.display_name or username,
                "password_hash": hash_password(inp.password),
                "last_seen": _now(),
            }},
        )
        account = {**existing_email, "username": username, "display_name": inp.display_name or username}
        try:
            verify_state = await _issue_auth_code_email(
                account=account,
                purpose="verify_email",
                ttl_minutes=SVID_EMAIL_VERIFICATION_TTL_MINUTES,
                renderer=render_verification_email,
            )
            return {
                "ok": True,
                "verification_required": True,
                "email": verify_state["email"],
                "expires_at": verify_state["expires_at"],
            }
        except Exception as exc:
            logger.warning("SVID verification email failed (%s) – auto-verifying", exc)
            raise HTTPException(503, "Verification email could not be sent")

    existing_username = await _db.svid_accounts.find_one({"username": username}, {"_id": 0})
    if existing_username:
        if existing_username.get("email_verified"):
            raise HTTPException(400, "Username already taken")
        # Unverifizierter Username-Conflict: anderer unverifizierter Account hat den Namen
        # → Der aktuelle User darf den Namen trotzdem verwenden (alter wird überschrieben)
        await _db.svid_accounts.delete_one({"username": username, "email_verified": False})

    account_id = _new_id()
    account = {
        "id": account_id,
        "email": email,
        "username": username,
        "display_name": inp.display_name or username,
        "avatar_url": "",
        "password_hash": hash_password(inp.password),
        "email_verified": False,
        "email_verified_at": None,
        "totp_enabled": False,
        "created_at": _now(),
        "last_seen": _now(),
    }
    await _db.svid_accounts.insert_one(account)

    # Send verification email
    try:
        verify_state = await _issue_auth_code_email(
            account=account,
            purpose="verify_email",
            ttl_minutes=SVID_EMAIL_VERIFICATION_TTL_MINUTES,
            renderer=render_verification_email,
        )
        return {
            "ok": True,
            "verification_required": True,
            "email": verify_state["email"],
            "expires_at": verify_state["expires_at"],
        }
    except Exception as exc:
        logger.warning("SVID verification email failed (%s) – auto-verifying", exc)
        raise HTTPException(503, "Verification email could not be sent")


@router.post("/verify-email")
async def svid_verify_email(inp: SvidVerifyEmailInput):
    """Verify email address with the 6-digit code."""
    email = inp.email.lower().strip()
    account = await _db.svid_accounts.find_one({"email": email}, {"_id": 0})
    if not account:
        raise HTTPException(404, "Account not found")
    if account.get("email_verified"):
        return {"ok": True, "already_verified": True}

    record = await _db.svid_email_codes.find_one(
        {"account_id": account["id"], "purpose": "verify_email"}, {"_id": 0}
    )
    if not record:
        raise HTTPException(400, "No verification code available")
    if datetime.fromisoformat(record["expires_at"]) <= datetime.now(timezone.utc):
        await _db.svid_email_codes.delete_one({"id": record["id"]})
        raise HTTPException(410, "Verification code expired")

    expected = _hash_code(email=email, purpose="verify_email", code=inp.code.strip())
    if expected != record.get("code_hash"):
        raise HTTPException(400, "Invalid verification code")

    await _db.svid_accounts.update_one(
        {"id": account["id"]},
        {"$set": {"email_verified": True, "email_verified_at": _now()}},
    )
    await _db.svid_email_codes.delete_many({"account_id": account["id"], "purpose": "verify_email"})

    # Auto-login after verification
    session_id = _new_id()
    refresh_token = secrets.token_urlsafe(48)
    await _db.svid_sessions.insert_one({
        "id": _new_id(),
        "session_id": session_id,
        "account_id": account["id"],
        "refresh_token_hash": hashlib.sha256(refresh_token.encode()).hexdigest(),
        "created_at": _now(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=SVID_REFRESH_TOKEN_TTL_DAYS)).isoformat(),
    })
    access_token = build_svid_access_token(account["id"], email, session_id)

    return {
        "ok": True,
        "account": _sanitize_account(account),
        "access_token": access_token,
        "refresh_token": refresh_token,
        "session_id": session_id,
    }


@router.post("/resend-verification")
async def svid_resend_verification(inp: SvidResendVerificationInput):
    email = inp.email.lower().strip()
    account = await _db.svid_accounts.find_one({"email": email}, {"_id": 0})
    if not account:
        return {"ok": True}
    if account.get("email_verified"):
        return {"ok": True, "already_verified": True}
    try:
        state = await _issue_auth_code_email(
            account=account, purpose="verify_email",
            ttl_minutes=SVID_EMAIL_VERIFICATION_TTL_MINUTES,
            renderer=render_verification_email,
        )
        return {"ok": True, "email": state["email"], "expires_at": state["expires_at"]}
    except Exception:
        raise HTTPException(503, "Could not send verification email")


# ═════════════════════════════════════════════════════════════════════════════
# LOGIN
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/login")
async def svid_login(inp: SvidLoginInput):
    """
    Login to Singra Vox ID.

    If 2FA is enabled, returns {"requires_2fa": True, "pending_token": "..."}
    and the user must call POST /api/id/login/2fa with the TOTP code.
    """
    email = inp.email.lower().strip()
    account = await _db.svid_accounts.find_one({"email": email}, {"_id": 0})

    valid = False
    if account:
        valid, _ = verify_password(inp.password, account["password_hash"])
    if not account or not valid:
        raise HTTPException(401, "Invalid credentials")

    if not account.get("email_verified", False):
        raise HTTPException(403, {
            "code": "email_verification_required",
            "message": "Please verify your email first",
            "email": email,
        })

    # Check 2FA
    if account.get("totp_enabled"):
        pending_token = pyjwt.encode(
            {
                "sub": account["id"],
                "purpose": "2fa_pending",
                "iat": datetime.now(timezone.utc),
                "exp": datetime.now(timezone.utc) + timedelta(minutes=5),
            },
            SVID_JWT_SECRET,
            algorithm=SVID_JWT_ALG,
        )
        return {"requires_2fa": True, "pending_token": pending_token}

    # No 2FA → issue session directly
    return await _issue_svid_session(account)


@router.post("/login/2fa")
async def svid_login_2fa(inp: SvidLogin2FAInput):
    """Complete login with TOTP code after the initial password step."""
    try:
        payload = pyjwt.decode(inp.pending_token, SVID_JWT_SECRET, algorithms=[SVID_JWT_ALG])
        if payload.get("purpose") != "2fa_pending":
            raise HTTPException(400, "Invalid pending token")
    except pyjwt.InvalidTokenError:
        raise HTTPException(401, "Invalid or expired pending token")

    account = await _db.svid_accounts.find_one({"id": payload["sub"]}, {"_id": 0})
    if not account:
        raise HTTPException(404, "Account not found")

    totp_record = await _db.svid_totp.find_one({"account_id": account["id"]}, {"_id": 0})
    if not totp_record:
        raise HTTPException(400, "2FA is not configured")

    # Try TOTP code
    if verify_totp_code(totp_record["secret"], inp.code):
        return await _issue_svid_session(account)

    # Try backup code
    normalized = normalize_backup_code(inp.code)
    backup_codes = totp_record.get("backup_codes", [])
    for i, stored_hash in enumerate(backup_codes):
        if hashlib.sha256(normalized.encode()).hexdigest() == stored_hash:
            # Remove used backup code
            backup_codes.pop(i)
            await _db.svid_totp.update_one(
                {"account_id": account["id"]},
                {"$set": {"backup_codes": backup_codes}},
            )
            return await _issue_svid_session(account)

    raise HTTPException(401, "Invalid 2FA code")


async def _issue_svid_session(account: dict) -> dict:
    """Create a session and return tokens."""
    session_id = _new_id()
    refresh_token = secrets.token_urlsafe(48)

    await _db.svid_sessions.insert_one({
        "id": _new_id(),
        "session_id": session_id,
        "account_id": account["id"],
        "refresh_token_hash": hashlib.sha256(refresh_token.encode()).hexdigest(),
        "created_at": _now(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=SVID_REFRESH_TOKEN_TTL_DAYS)).isoformat(),
    })
    await _db.svid_accounts.update_one(
        {"id": account["id"]},
        {"$set": {"last_seen": _now()}},
    )

    access_token = build_svid_access_token(account["id"], account["email"], session_id)
    return {
        "ok": True,
        "account": _sanitize_account(account),
        "access_token": access_token,
        "refresh_token": refresh_token,
        "session_id": session_id,
    }


@router.post("/logout")
async def svid_logout(request: Request):
    try:
        account = await _get_current_account(request)
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:].strip()
            payload = decode_svid_token(token)
            sid = payload.get("sid")
            if sid:
                await _db.svid_sessions.delete_one({"session_id": sid, "account_id": account["id"]})
    except Exception:
        pass
    return {"ok": True}


# ═════════════════════════════════════════════════════════════════════════════
# PROFILE
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/me")
async def svid_me(request: Request):
    """Get the authenticated user's Singra Vox ID profile."""
    account = await _get_current_account(request)
    return _sanitize_account(account)


@router.put("/me")
async def svid_update_profile(inp: SvidProfileUpdateInput, request: Request):
    """Update profile fields (display_name, avatar_url)."""
    account = await _get_current_account(request)
    updates = {}
    if inp.display_name is not None:
        updates["display_name"] = inp.display_name
    if inp.avatar_url is not None:
        updates["avatar_url"] = inp.avatar_url
    if updates:
        await _db.svid_accounts.update_one({"id": account["id"]}, {"$set": updates})
    updated = await _db.svid_accounts.find_one({"id": account["id"]}, {"_id": 0})
    return _sanitize_account(updated)


# ═════════════════════════════════════════════════════════════════════════════
# PASSWORD
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/password/check")
async def svid_password_check(inp: SvidPasswordCheckInput):
    """Check password strength – no authentication required."""
    return check_password_strength(inp.password)


@router.post("/password/generate")
async def svid_password_generate(length: int = 16):
    """Generate a cryptographically secure password."""
    pw = generate_secure_password(length)
    return {"password": pw, "strength": check_password_strength(pw)}


@router.post("/password/change")
async def svid_password_change(inp: SvidPasswordChangeInput, request: Request):
    """Change password for the authenticated user."""
    account = await _get_current_account(request)
    full = await _db.svid_accounts.find_one({"id": account["id"]}, {"_id": 0})

    valid, _ = verify_password(inp.current_password, full["password_hash"])
    if not valid:
        raise HTTPException(401, "Current password is incorrect")

    policy_errors = validate_password_policy(inp.new_password)
    if policy_errors:
        raise HTTPException(400, {"code": "weak_password", "errors": policy_errors})

    same, _ = verify_password(inp.new_password, full["password_hash"])
    if same:
        raise HTTPException(400, "New password must be different from current")

    await _db.svid_accounts.update_one(
        {"id": account["id"]},
        {"$set": {"password_hash": hash_password(inp.new_password)}},
    )
    return {"ok": True}


@router.post("/password/forgot")
async def svid_forgot_password(inp: SvidForgotPasswordInput):
    """Request a password reset code via email."""
    email = inp.email.lower().strip()
    account = await _db.svid_accounts.find_one({"email": email}, {"_id": 0})
    if not account or not account.get("email_verified"):
        return {"ok": True}  # Don't reveal account existence
    try:
        await _issue_auth_code_email(
            account=account, purpose="password_reset",
            ttl_minutes=SVID_PASSWORD_RESET_TTL_MINUTES,
            renderer=render_password_reset_email,
        )
    except Exception:
        logger.exception("Failed to send SVID password reset for %s", email)
    return {"ok": True}


@router.post("/password/reset")
async def svid_reset_password(inp: SvidResetPasswordInput):
    """Reset password with the emailed code."""
    email = inp.email.lower().strip()
    account = await _db.svid_accounts.find_one({"email": email}, {"_id": 0})
    if not account:
        raise HTTPException(400, "Invalid reset code")

    record = await _db.svid_email_codes.find_one(
        {"account_id": account["id"], "purpose": "password_reset"}, {"_id": 0}
    )
    if not record:
        raise HTTPException(400, "No reset code available")
    if datetime.fromisoformat(record["expires_at"]) <= datetime.now(timezone.utc):
        raise HTTPException(410, "Reset code expired")

    expected = _hash_code(email=email, purpose="password_reset", code=inp.code.strip())
    if expected != record.get("code_hash"):
        raise HTTPException(400, "Invalid reset code")

    policy_errors = validate_password_policy(inp.new_password)
    if policy_errors:
        raise HTTPException(400, {"code": "weak_password", "errors": policy_errors})

    await _db.svid_accounts.update_one(
        {"id": account["id"]},
        {"$set": {"password_hash": hash_password(inp.new_password)}},
    )
    await _db.svid_email_codes.delete_many({"account_id": account["id"], "purpose": "password_reset"})
    # Revoke all sessions for security
    await _db.svid_sessions.delete_many({"account_id": account["id"]})
    return {"ok": True}


# ═════════════════════════════════════════════════════════════════════════════
# TWO-FACTOR AUTHENTICATION
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/2fa/setup")
async def svid_2fa_setup(request: Request):
    """
    Start 2FA enrollment.

    Returns the TOTP secret and a QR code URI for scanning.
    The user must confirm with POST /api/id/2fa/confirm before 2FA is active.
    """
    account = await _get_current_account(request)
    if account.get("totp_enabled"):
        raise HTTPException(409, "2FA is already enabled")

    secret = generate_totp_secret()
    uri = get_totp_uri(secret, account["email"])

    # Store pending (not yet confirmed)
    await _db.svid_totp.update_one(
        {"account_id": account["id"]},
        {"$set": {
            "account_id": account["id"],
            "secret": secret,
            "confirmed": False,
            "created_at": _now(),
        }},
        upsert=True,
    )

    return {"secret": secret, "qr_uri": uri}


@router.post("/2fa/confirm")
async def svid_2fa_confirm(inp: SvidEnable2FAInput, request: Request):
    """
    Confirm 2FA setup by verifying the first TOTP code.

    Returns a set of single-use backup codes that the user MUST save.
    """
    account = await _get_current_account(request)
    totp_record = await _db.svid_totp.find_one({"account_id": account["id"]}, {"_id": 0})
    if not totp_record:
        raise HTTPException(400, "Start 2FA setup first with POST /api/id/2fa/setup")
    if totp_record.get("confirmed"):
        raise HTTPException(409, "2FA is already confirmed")

    if not verify_totp_code(totp_record["secret"], inp.code):
        raise HTTPException(400, "Invalid TOTP code – check your authenticator app")

    # Generate backup codes
    backup_codes_plain = generate_backup_codes()
    backup_codes_hashed = [
        hashlib.sha256(normalize_backup_code(c).encode()).hexdigest()
        for c in backup_codes_plain
    ]

    await _db.svid_totp.update_one(
        {"account_id": account["id"]},
        {"$set": {"confirmed": True, "backup_codes": backup_codes_hashed, "confirmed_at": _now()}},
    )
    await _db.svid_accounts.update_one(
        {"id": account["id"]},
        {"$set": {"totp_enabled": True}},
    )

    return {
        "ok": True,
        "backup_codes": backup_codes_plain,
        "message": "Save these backup codes! Each can only be used once.",
    }


@router.post("/2fa/disable")
async def svid_2fa_disable(inp: SvidDisable2FAInput, request: Request):
    """Disable 2FA – requires current password + TOTP code for security."""
    account = await _get_current_account(request)
    full = await _db.svid_accounts.find_one({"id": account["id"]}, {"_id": 0})

    valid, _ = verify_password(inp.password, full["password_hash"])
    if not valid:
        raise HTTPException(401, "Invalid password")

    totp_record = await _db.svid_totp.find_one({"account_id": account["id"]}, {"_id": 0})
    if not totp_record:
        raise HTTPException(400, "2FA is not enabled")

    if not verify_totp_code(totp_record["secret"], inp.code):
        raise HTTPException(400, "Invalid TOTP code")

    await _db.svid_totp.delete_one({"account_id": account["id"]})
    await _db.svid_accounts.update_one(
        {"id": account["id"]},
        {"$set": {"totp_enabled": False}},
    )
    return {"ok": True}


# ═════════════════════════════════════════════════════════════════════════════
# OAUTH2 / OPENID CONNECT
# ═════════════════════════════════════════════════════════════════════════════

@router.post("/oauth/clients")
async def svid_register_oauth_client(inp: SvidOAuthClientRegisterInput, request: Request):
    """
    Register a Singra Vox instance as an OAuth2 client.

    Only authenticated users can register clients (instance admins).
    Returns client_id + client_secret – the secret is shown ONCE.
    """
    account = await _get_current_account(request)
    creds = generate_client_credentials()

    client_doc = {
        "id": _new_id(),
        "client_id": creds["client_id"],
        "client_secret_hash": hashlib.sha256(creds["client_secret"].encode()).hexdigest(),
        "instance_name": inp.instance_name,
        "instance_url": inp.instance_url.rstrip("/"),
        "redirect_uris": inp.redirect_uris,
        "registered_by": account["id"],
        "created_at": _now(),
    }
    await _db.svid_oauth_clients.insert_one(client_doc)

    return {
        "client_id": creds["client_id"],
        "client_secret": creds["client_secret"],
        "instance_name": inp.instance_name,
        "message": "Save the client_secret – it will not be shown again.",
    }


@router.post("/oauth/authorize")
async def svid_oauth_authorize(inp: SvidOAuthAuthorizeInput, request: Request):
    """
    OAuth2 Authorization endpoint.

    The authenticated user grants the instance access to their profile.
    Returns an authorization code that the instance exchanges for tokens.
    """
    account = await _get_current_account(request)

    # Validate client
    client = await _db.svid_oauth_clients.find_one({"client_id": inp.client_id}, {"_id": 0})
    if not client:
        raise HTTPException(400, "Unknown OAuth2 client")
    if inp.redirect_uri not in client.get("redirect_uris", []):
        raise HTTPException(400, "Invalid redirect_uri")

    # Generate authorization code
    code = generate_authorization_code()
    code_record = build_oauth_code_record(
        user_id=account["id"],
        client_id=inp.client_id,
        redirect_uri=inp.redirect_uri,
        scope=inp.scope,
        state=inp.state,
        code=code,
    )
    await _db.svid_oauth_codes.insert_one(code_record)

    # Track instance connection
    await _db.svid_user_instances.update_one(
        {"account_id": account["id"], "instance_url": client["instance_url"]},
        {"$set": {
            "account_id": account["id"],
            "instance_url": client["instance_url"],
            "instance_name": client["instance_name"],
            "client_id": inp.client_id,
            "last_connected": _now(),
        }, "$setOnInsert": {"first_connected": _now()}},
        upsert=True,
    )

    return {
        "code": code,
        "state": inp.state,
        "redirect_uri": inp.redirect_uri,
    }


@router.post("/oauth/token")
async def svid_oauth_token(inp: SvidOAuthTokenInput):
    """
    OAuth2 Token endpoint.

    Exchanges an authorization code for an access_token + id_token.
    Called by the instance backend (server-to-server, not by browsers).
    """
    if inp.grant_type != "authorization_code":
        raise HTTPException(400, "Unsupported grant_type")

    # Validate client credentials
    client = await _db.svid_oauth_clients.find_one({"client_id": inp.client_id}, {"_id": 0})
    if not client:
        raise HTTPException(401, "Invalid client_id")
    expected_hash = hashlib.sha256(inp.client_secret.encode()).hexdigest()
    if expected_hash != client.get("client_secret_hash"):
        raise HTTPException(401, "Invalid client_secret")

    # Find and validate code
    code_hash = hash_authorization_code(inp.code)
    code_record = await _db.svid_oauth_codes.find_one(
        {"code_hash": code_hash, "client_id": inp.client_id},
        {"_id": 0},
    )
    if not code_record:
        raise HTTPException(400, "Invalid authorization code")
    if code_record.get("used"):
        raise HTTPException(400, "Authorization code already used")
    if datetime.fromisoformat(code_record["expires_at"]) <= datetime.now(timezone.utc):
        raise HTTPException(400, "Authorization code expired")
    if code_record["redirect_uri"] != inp.redirect_uri:
        raise HTTPException(400, "redirect_uri mismatch")

    # Mark code as used
    await _db.svid_oauth_codes.update_one(
        {"id": code_record["id"]},
        {"$set": {"used": True}},
    )

    # Fetch user
    account = await _db.svid_accounts.find_one({"id": code_record["user_id"]}, {"_id": 0})
    if not account:
        raise HTTPException(400, "Account not found")

    # Build tokens
    access_token = build_svid_access_token(account["id"], account["email"], _new_id())
    id_token = build_id_token(account, audience=inp.client_id)

    return {
        "access_token": access_token,
        "token_type": "Bearer",
        "id_token": id_token,
        "expires_in": SVID_ACCESS_TOKEN_TTL_MINUTES * 60,
    }


@router.get("/oauth/userinfo")
async def svid_oauth_userinfo(request: Request):
    """
    OpenID Connect UserInfo endpoint.

    Returns the authenticated user's profile using the access token.
    """
    account = await _get_current_account(request)
    return {
        "sub": account["id"],
        "email": account["email"],
        "preferred_username": account["username"],
        "name": account.get("display_name", ""),
        "avatar_url": account.get("avatar_url", ""),
    }


@router.get("/.well-known/openid-configuration")
async def svid_openid_configuration(request: Request):
    """
    OpenID Connect Discovery document.

    Allows instances to auto-discover the ID server's endpoints
    by querying  https://<id-server>/.well-known/openid-configuration
    """
    base = SVID_ISSUER or str(request.base_url).rstrip("/")
    return {
        "issuer": base,
        "authorization_endpoint": f"{base}/api/id/oauth/authorize",
        "token_endpoint": f"{base}/api/id/oauth/token",
        "userinfo_endpoint": f"{base}/api/id/oauth/userinfo",
        "registration_endpoint": f"{base}/api/id/oauth/clients",
        "scopes_supported": ["openid", "profile", "email"],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["HS256"],
    }


# ═════════════════════════════════════════════════════════════════════════════
# INSTANCES
# ═════════════════════════════════════════════════════════════════════════════

@router.get("/instances")
async def svid_list_instances(request: Request):
    """List all instances the user has connected to."""
    account = await _get_current_account(request)
    instances = await _db.svid_user_instances.find(
        {"account_id": account["id"]},
        {"_id": 0, "account_id": 0},
    ).sort("last_connected", -1).to_list(100)
    return {"instances": instances}


# ═════════════════════════════════════════════════════════════════════════════
# CROSS-INSTANCE INVITES
# ═════════════════════════════════════════════════════════════════════════════

class SvidInviteInput(BaseModel):
    """Send a cross-instance invite to a Singra Vox ID user."""
    recipient_username: str
    instance_url: str
    instance_name: str = ""
    server_name: str = ""
    invite_code: str
    message: str = ""


class SvidInviteRespondInput(BaseModel):
    accepted: bool


@router.post("/invites/send")
async def svid_send_invite(inp: SvidInviteInput, request: Request):
    """
    Send a cross-instance invite to another Singra Vox ID user.

    The invite is stored on the ID server and delivered to the recipient
    the next time they check their notifications.  The recipient can accept
    or decline from any instance or the ID dashboard.

    Security:
        - Sender must be authenticated with a valid Singra Vox ID
        - Recipient must exist on THIS ID server (same trust domain)
        - Spam protection: max 10 pending invites per sender
    """
    sender = await _get_current_account(request)

    # Find recipient by username on this ID server
    recipient = await _db.svid_accounts.find_one(
        {"username": inp.recipient_username.lower().strip()},
        {"_id": 0, "id": 1, "username": 1, "display_name": 1},
    )
    if not recipient:
        raise HTTPException(404, "User not found on this Singra Vox ID server")
    if recipient["id"] == sender["id"]:
        raise HTTPException(400, "Cannot invite yourself")

    # Spam protection: max 10 pending invites per sender
    pending_count = await _db.svid_invites.count_documents({
        "sender_id": sender["id"], "status": "pending",
    })
    if pending_count >= 10:
        raise HTTPException(429, "Too many pending invites. Wait for responses.")

    # Prevent duplicate invites to same user for same instance+server
    existing = await _db.svid_invites.find_one({
        "sender_id": sender["id"],
        "recipient_id": recipient["id"],
        "invite_code": inp.invite_code,
        "status": "pending",
    }, {"_id": 0})
    if existing:
        return {"ok": True, "invite_id": existing["id"], "already_sent": True}

    invite_id = _new_id()
    await _db.svid_invites.insert_one({
        "id": invite_id,
        "sender_id": sender["id"],
        "sender_username": sender.get("username", ""),
        "sender_display_name": sender.get("display_name", ""),
        "recipient_id": recipient["id"],
        "recipient_username": recipient["username"],
        "instance_url": inp.instance_url.rstrip("/"),
        "instance_name": inp.instance_name,
        "server_name": inp.server_name,
        "invite_code": inp.invite_code,
        "message": (inp.message or "")[:500],
        "status": "pending",
        "created_at": _now(),
    })
    return {"ok": True, "invite_id": invite_id}


@router.get("/invites")
async def svid_list_invites(request: Request, status: str = "pending"):
    """List invites for the current user (received + sent)."""
    account = await _get_current_account(request)
    received = await _db.svid_invites.find(
        {"recipient_id": account["id"], "status": status},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    sent = await _db.svid_invites.find(
        {"sender_id": account["id"], "status": status},
        {"_id": 0},
    ).sort("created_at", -1).to_list(50)
    return {"received": received, "sent": sent}


@router.post("/invites/{invite_id}/respond")
async def svid_respond_invite(invite_id: str, inp: SvidInviteRespondInput, request: Request):
    """Accept or decline a cross-instance invite."""
    account = await _get_current_account(request)
    invite = await _db.svid_invites.find_one(
        {"id": invite_id, "recipient_id": account["id"], "status": "pending"},
        {"_id": 0},
    )
    if not invite:
        raise HTTPException(404, "Invite not found or already responded")

    new_status = "accepted" if inp.accepted else "declined"
    await _db.svid_invites.update_one(
        {"id": invite_id},
        {"$set": {"status": new_status, "responded_at": _now()}},
    )
    return {
        "ok": True,
        "status": new_status,
        "instance_url": invite["instance_url"],
        "invite_code": invite["invite_code"] if inp.accepted else None,
    }


# ═════════════════════════════════════════════════════════════════════════════
# UNREAD COUNTS (for Instance Switcher)
# ═════════════════════════════════════════════════════════════════════════════

class SvidUnreadReportInput(BaseModel):
    """Report unread counts from an instance to the ID server."""
    instance_url: str
    total_unread: int = 0
    mention_count: int = 0


@router.post("/instances/unread")
async def svid_report_unread(inp: SvidUnreadReportInput, request: Request):
    """
    Instance clients report their unread counts to the ID server.

    This is called by the frontend periodically so the Instance Switcher
    can show "3 unread messages on gaming.xyz" without server-to-server
    communication.  The data is per-user and ephemeral.
    """
    account = await _get_current_account(request)
    await _db.svid_user_instances.update_one(
        {"account_id": account["id"], "instance_url": inp.instance_url.rstrip("/")},
        {"$set": {
            "account_id": account["id"],
            "instance_url": inp.instance_url.rstrip("/"),
            "total_unread": max(0, inp.total_unread),
            "mention_count": max(0, inp.mention_count),
            "unread_updated_at": _now(),
        }, "$setOnInsert": {"first_connected": _now(), "instance_name": "", "client_id": ""}},
        upsert=True,
    )
    return {"ok": True}

