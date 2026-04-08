from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, Response

from app.auth_service import (
    clear_auth_cookies,
    get_request_token,
    list_user_sessions,
    load_current_user,
    normalize_client_platform,
    refresh_auth_session,
    revoke_session,
    revoke_user_sessions,
    set_auth_cookies,
    verify_password,
)
from app.core.config import (
    APP_NAME,
    EMAIL_VERIFICATION_PURPOSE,
    INSTANCE_SETTINGS_ID,
    PASSWORD_RESET_PURPOSE,
    USER_ROLE,
    default_frontend_url,
)
from app.core.database import db
from app.core.utils import now_utc, sanitize_user
from app.dependencies import request_device_id, require_instance_initialized
from app.emailing import render_welcome_email, send_email
from app.rate_limits import enforce_fixed_window_rate_limit
from app.schemas import (
    ForgotPasswordInput,
    LoginInput,
    PasswordResetLookupInput,
    RefreshInput,
    RegisterInput,
    ResendVerificationInput,
    ResetPasswordInput,
    SvidLoginToInstanceInput,
    VerifyEmailInput,
)
from app.services.auth_flow import (
    email_verification_required_detail,
    ensure_unique_identity,
    hash_pw,
    hash_verification_code,
    issue_auth_response,
    issue_email_verification,
    issue_ephemeral_access_token,
    issue_password_reset,
    normalize_username,
    session_closed_payload,
)
from app.services.presence import broadcast_presence_update, log_status_history
from app.services.server_ops import clear_voice_membership
from app.ws import ws_mgr


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["Auth"])


@router.post("/register")
async def register(inp: RegisterInput, response: Response):
    settings = await require_instance_initialized()
    if not settings.get("allow_open_signup", True):
        raise HTTPException(403, "Open signup is disabled")
    email = inp.email.lower().strip()
    username = normalize_username(inp.username)
    await ensure_unique_identity(email, username)
    uid = str(uuid4())
    user = {
        "id": uid,
        "email": email,
        "username": username,
        "display_name": inp.display_name or inp.username,
        "password_hash": hash_pw(inp.password),
        "avatar_url": "",
        "status": "offline",
        "public_key": "",
        "role": USER_ROLE,
        "instance_role": USER_ROLE,
        "email_verified": False,
        "email_verified_at": None,
        "created_at": now_utc(),
        "last_seen": now_utc(),
    }
    await db.users.insert_one(user)
    try:
        verification_state = await issue_email_verification(user)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Verification email konnte nicht gesendet werden (%s) – User wird auto-verifiziert", exc)
        await db.users.update_one(
            {"id": uid},
            {"$set": {"email_verified": True, "email_verified_at": now_utc()}},
        )
        response.delete_cookie("access_token", path="/")
        response.delete_cookie("refresh_token", path="/")
        return {
            "ok": True,
            "verification_required": False,
            "email": email,
            "expires_at": None,
        }
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {
        "ok": True,
        "verification_required": True,
        "email": verification_state["email"],
        "expires_at": verification_state["expires_at"],
    }


@router.post("/login")
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

    preferred = user.get("preferred_status", "online")
    restore_status = preferred if preferred != "offline" else "online"

    if user.get("totp_enabled"):
        return {
            "requires_2fa": True,
            "user_id": user["id"],
            "message": "Two-factor authentication required.",
        }

    await db.users.update_one({"id": user["id"]}, {"$set": {"status": restore_status, "last_seen": now_utc()}})
    user["status"] = restore_status
    await log_status_history(user["id"], restore_status)
    auth_payload = await issue_auth_response(user, request, response)
    await broadcast_presence_update(user["id"])
    return auth_payload


@router.post("/verify-email")
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

    try:
        instance_settings = await db.instance_settings.find_one({"id": INSTANCE_SETTINGS_ID}, {"_id": 0})
        instance_name = (instance_settings or {}).get("instance_name", APP_NAME)
        subject, text_body, html_body = render_welcome_email(
            app_name=APP_NAME,
            instance_name=instance_name,
            username=verified_user.get("username", ""),
            login_url=default_frontend_url,
        )
        await send_email(to_email=email, subject=subject, text_body=text_body, html_body=html_body)
    except Exception:
        pass

    return auth_payload


@router.post("/resend-verification")
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


@router.post("/password-reset-lookup")
async def password_reset_lookup(inp: PasswordResetLookupInput):
    email = inp.email.lower().strip()
    accounts = []

    local_user = await db.users.find_one({"email": email}, {"_id": 0, "id": 1, "email_verified": 1})
    if local_user and local_user.get("email_verified", True):
        accounts.append("local")

    svid_account = await db.svid_accounts.find_one({"email": email}, {"_id": 0, "id": 1, "email_verified": 1})
    if svid_account and svid_account.get("email_verified"):
        accounts.append("svid")

    return {"accounts": accounts}


@router.post("/forgot-password")
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


@router.post("/reset-password")
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


@router.post("/logout")
async def logout(request: Request, response: Response):
    try:
        user, session = await load_current_user(db, request)
        await revoke_session(db, session["session_id"])
        await ws_mgr.close_session(session["session_id"], session_closed_payload("logout"))
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"status": "offline", "preferred_status": "online", "last_seen": now_utc()}},
        )
        await log_status_history(user["id"], "offline")
        await clear_voice_membership(user["id"])
        await broadcast_presence_update(user["id"])
    except Exception:
        pass
    clear_auth_cookies(response)
    return {"ok": True}


@router.post("/logout-all")
async def logout_all(request: Request, response: Response):
    user, _session = await load_current_user(db, request)
    await revoke_user_sessions(db, user["id"])
    await ws_mgr.close_user_sessions(user["id"], session_closed_payload("logout_all"))
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"status": "offline", "preferred_status": "online", "last_seen": now_utc()}},
    )
    await log_status_history(user["id"], "offline")
    await clear_voice_membership(user["id"])
    await broadcast_presence_update(user["id"])
    clear_auth_cookies(response)
    return {"ok": True}


@router.get("/sessions")
async def auth_sessions(request: Request):
    user, current_session = await load_current_user(db, request)
    sessions = await list_user_sessions(db, user["id"])
    for session in sessions:
        session["current"] = session["session_id"] == current_session["session_id"]
    return {"sessions": sessions}


@router.delete("/sessions/{session_id}")
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


@router.get("/me")
async def me(request: Request):
    user, session = await load_current_user(db, request)
    access_token = issue_ephemeral_access_token(
        user,
        session_id=session["session_id"],
        jwt_secret_value=request.app.state.auth_config.jwt_secret,
    )
    return {**sanitize_user(user), "access_token": access_token, "session_id": session["session_id"]}


@router.post("/refresh")
async def refresh(inp: RefreshInput, request: Request, response: Response):
    refresh_token = inp.refresh_token or get_request_token(request, prefer_refresh=True)
    if not refresh_token:
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
    user, session, access_token, next_refresh_token = await refresh_auth_session(
        db,
        refresh_token=refresh_token,
        request=request,
        auth_config=request.app.state.auth_config,
        requested_device_id=request_device_id(request),
    )
    previous_session_id = session.get("replaced_from")
    if previous_session_id:
        await ws_mgr.close_session(previous_session_id, session_closed_payload("session_rotated"))
    set_auth_cookies(
        response=response,
        access_token=access_token,
        refresh_token=next_refresh_token,
        cookie_secure=request.app.state.auth_config.cookie_secure,
    )
    return {
        "ok": True,
        "user": sanitize_user(user),
        "access_token": access_token,
        "refresh_token": next_refresh_token,
        "session_id": session["session_id"],
    }


@router.post("/login-with-svid")
async def login_with_svid(inp: SvidLoginToInstanceInput, request: Request, response: Response):
    from app.identity.oauth2 import decode_svid_token

    await require_instance_initialized()

    try:
        payload = decode_svid_token(inp.svid_access_token)
    except Exception:
        raise HTTPException(401, "Invalid Singra Vox ID token")

    svid_account_id = payload.get("sub")
    svid_email = payload.get("email", "")
    if not svid_account_id:
        raise HTTPException(401, "Invalid token payload")

    svid_account = await db.svid_accounts.find_one({"id": svid_account_id}, {"_id": 0})
    if not svid_account:
        raise HTTPException(404, "Singra Vox ID account not found")

    local_user = await db.users.find_one({"svid_account_id": svid_account_id}, {"_id": 0})
    if not local_user:
        local_user = await db.users.find_one({"email": svid_email.lower().strip()}, {"_id": 0})
        if local_user:
            await db.users.update_one(
                {"id": local_user["id"]},
                {"$set": {"svid_account_id": svid_account_id, "svid_server": payload.get("iss", "")}},
            )
        else:
            uid = str(uuid4())
            username = svid_account.get("username", "")
            if await db.users.find_one({"username": username}, {"_id": 0}):
                username = f"{username}_{uid[:4]}"
            local_user = {
                "id": uid,
                "email": svid_account["email"],
                "username": username,
                "display_name": svid_account.get("display_name", username),
                "password_hash": "",
                "avatar_url": svid_account.get("avatar_url", ""),
                "status": "offline",
                "public_key": "",
                "role": USER_ROLE,
                "instance_role": USER_ROLE,
                "email_verified": True,
                "email_verified_at": now_utc(),
                "svid_account_id": svid_account_id,
                "svid_server": payload.get("iss", ""),
                "created_at": now_utc(),
                "last_seen": now_utc(),
            }
            await db.users.insert_one(local_user)

    await db.users.update_one(
        {"id": local_user["id"]},
        {"$set": {"status": "online", "last_seen": now_utc()}},
    )
    await log_status_history(local_user["id"], "online")
    auth_payload = await issue_auth_response(local_user, request, response)
    await broadcast_presence_update(local_user["id"])
    return auth_payload
