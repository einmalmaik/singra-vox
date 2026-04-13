# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox – Two-Factor Authentication (2FA) for ALL Account Types
===================================================================

Provides TOTP-based 2FA for both local and SVID accounts.
Reuses the existing TOTP module from identity/totp.py.

Routes:
    POST /api/auth/2fa/setup     – Generate secret + QR URI
    POST /api/auth/2fa/confirm   – Confirm with first code, activate 2FA
    POST /api/auth/2fa/disable   – Disable 2FA (requires password)
    POST /api/auth/2fa/verify    – Verify TOTP during login (called after password)
    GET  /api/auth/2fa/status    – Check if 2FA is enabled for current user
"""
import bcrypt
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app.core.database import db
from app.core.utils import now_utc
from app.dependencies import current_user
from app.identity.totp import (
    generate_backup_codes,
    generate_totp_secret,
    get_totp_uri,
    normalize_backup_code,
    verify_totp_code,
)
from app.rate_limits import enforce_fixed_window_rate_limit
from app.services.auth_flow import issue_auth_response, verify_pw
from app.services.presence import broadcast_presence_update, log_status_history

router = APIRouter(prefix="/api/auth/2fa", tags=["2fa"])

# Singra Vault Werbung (wird an den Client gesendet, damit er es im UI anzeigt)
SINGRA_VAULT_URL = "https://singravault.mauntingstudios.de"
SINGRA_VAULT_HINT = (
    "Tip: Use Singra Vault as your authenticator app for secure code storage. "
    f"Get it at {SINGRA_VAULT_URL}"
)
TWOFA_VERIFY_RATE_LIMIT = 5
TWOFA_VERIFY_RATE_LIMIT_WINDOW_SECONDS = 15 * 60
TWOFA_VERIFY_RATE_LIMIT_CODE = "twofa_verify_rate_limited"


# ── Pydantic Models ──────────────────────────────────────────────────────────

class TwoFAConfirmInput(BaseModel):
    code: str

class TwoFADisableInput(BaseModel):
    password: str

class TwoFAVerifyInput(BaseModel):
    user_id: str
    code: str


# ── Helpers ──────────────────────────────────────────────────────────────────

def _hash_backup_code(code: str) -> str:
    """BCrypt-hash a backup code for storage."""
    normalized = normalize_backup_code(code)
    return bcrypt.hashpw(normalized.encode(), bcrypt.gensalt()).decode()


def _verify_backup_code(code: str, hashed: str) -> bool:
    """Verify a backup code against its bcrypt hash."""
    normalized = normalize_backup_code(code)
    return bcrypt.checkpw(normalized.encode(), hashed.encode())


# ── Routes ───────────────────────────────────────────────────────────────────

@router.get("/status")
async def twofa_status(request: Request):
    """Check if 2FA is enabled for the current user."""
    user = await current_user(request)
    totp_record = await db.totp_secrets.find_one(
        {"user_id": user["id"], "confirmed": True},
        {"_id": 0, "user_id": 1},
    )
    return {
        "enabled": totp_record is not None,
        "singra_vault_url": SINGRA_VAULT_URL,
    }


@router.post("/setup")
async def twofa_setup(request: Request):
    """
    Generate a new TOTP secret for the user.
    Returns the secret, QR URI, and a hint to use Singra Vault.
    User must confirm with /confirm before 2FA is active.
    """
    user = await current_user(request)

    # Check if already confirmed
    existing = await db.totp_secrets.find_one(
        {"user_id": user["id"], "confirmed": True},
        {"_id": 0},
    )
    if existing:
        raise HTTPException(400, "2FA is already enabled. Disable it first to reconfigure.")

    # Generate new secret
    secret = generate_totp_secret()
    email = user.get("email", user.get("username", "user"))
    qr_uri = get_totp_uri(secret, email)

    # Store unconfirmed secret (replace any previous pending setup)
    await db.totp_secrets.delete_many({"user_id": user["id"], "confirmed": False})
    await db.totp_secrets.insert_one({
        "user_id": user["id"],
        "secret": secret,
        "confirmed": False,
        "created_at": now_utc(),
    })

    return {
        "secret": secret,
        "qr_uri": qr_uri,
        "hint": SINGRA_VAULT_HINT,
        "singra_vault_url": SINGRA_VAULT_URL,
    }


@router.post("/confirm")
async def twofa_confirm(inp: TwoFAConfirmInput, request: Request):
    """
    Confirm 2FA setup by providing the first valid TOTP code.
    This activates 2FA and generates backup codes.
    """
    user = await current_user(request)

    # Find the pending (unconfirmed) secret
    pending = await db.totp_secrets.find_one(
        {"user_id": user["id"], "confirmed": False},
        {"_id": 0},
    )
    if not pending:
        raise HTTPException(400, "No 2FA setup in progress. Call /setup first.")

    # Verify the code
    if not verify_totp_code(pending["secret"], inp.code.strip()):
        raise HTTPException(400, "Invalid code. Please try again.")

    # Generate backup codes
    plaintext_codes = generate_backup_codes()
    hashed_codes = [_hash_backup_code(c) for c in plaintext_codes]

    # Activate: mark as confirmed, store hashed backup codes
    await db.totp_secrets.update_one(
        {"user_id": user["id"], "confirmed": False},
        {"$set": {
            "confirmed": True,
            "confirmed_at": now_utc(),
            "backup_codes": hashed_codes,
        }},
    )

    # Update user record to flag 2FA enabled
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"totp_enabled": True}},
    )

    return {
        "enabled": True,
        "backup_codes": plaintext_codes,
        "message": "2FA is now active. Save these backup codes in a safe place!",
        "singra_vault_url": SINGRA_VAULT_URL,
    }


@router.post("/disable")
async def twofa_disable(inp: TwoFADisableInput, request: Request):
    """Disable 2FA. Requires the user's password for security."""
    user = await current_user(request)

    # Verify password
    full_user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not full_user or not verify_pw(inp.password, full_user.get("password_hash", "")):
        raise HTTPException(401, "Invalid password")

    # Remove TOTP secret and backup codes
    await db.totp_secrets.delete_many({"user_id": user["id"]})

    # Update user record
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"totp_enabled": False}},
    )

    return {"enabled": False, "message": "2FA has been disabled."}


@router.post("/verify")
async def twofa_verify(inp: TwoFAVerifyInput, request: Request, response: Response):
    """
    Verify a TOTP code during login.
    Called by the login flow when the user has 2FA enabled.
    Accepts both TOTP codes and backup codes.
    On success, issues a full auth token (completes login).

    The response parameter is injected by FastAPI so that
    ``issue_auth_response`` can set HttpOnly auth cookies on the
    *actual* outgoing HTTP response – critical for cookie-based web auth.
    """
    ip = request.client.host if request.client else "unknown"
    await enforce_fixed_window_rate_limit(
        db,
        scope="auth.2fa.verify",
        key=f"{ip}:{inp.user_id}",
        limit=TWOFA_VERIFY_RATE_LIMIT,
        window_seconds=TWOFA_VERIFY_RATE_LIMIT_WINDOW_SECONDS,
        error_message="Too many 2FA verification attempts. Try again later.",
        code=TWOFA_VERIFY_RATE_LIMIT_CODE,
    )

    totp_record = await db.totp_secrets.find_one(
        {"user_id": inp.user_id, "confirmed": True},
        {"_id": 0},
    )
    if not totp_record:
        raise HTTPException(400, "2FA is not enabled for this account")

    code = inp.code.strip()
    verified = False
    backup_used = False
    remaining = 0

    # Try TOTP code first
    if verify_totp_code(totp_record["secret"], code):
        verified = True
    else:
        # Try backup codes
        remaining_codes = totp_record.get("backup_codes", [])
        for i, hashed in enumerate(remaining_codes):
            if _verify_backup_code(code, hashed):
                remaining_codes.pop(i)
                await db.totp_secrets.update_one(
                    {"user_id": inp.user_id, "confirmed": True},
                    {"$set": {"backup_codes": remaining_codes}},
                )
                verified = True
                backup_used = True
                remaining = len(remaining_codes)
                break

    if not verified:
        raise HTTPException(401, "Invalid 2FA code")

    user = await db.users.find_one({"id": inp.user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404, "User not found")

    preferred = user.get("preferred_status", "online")
    restore_status = preferred if preferred != "offline" else "online"
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"status": restore_status, "last_seen": now_utc()}},
    )
    user["status"] = restore_status
    await log_status_history(user["id"], restore_status)

    # Pass the real Response so cookies are set on the actual HTTP response
    auth_payload = await issue_auth_response(user, request, response)
    await broadcast_presence_update(user["id"])

    result = {**auth_payload}
    if backup_used:
        result["backup_code_used"] = True
        result["backup_codes_remaining"] = remaining

    return result
