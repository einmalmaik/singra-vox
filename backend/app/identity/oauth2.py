"""
Singra Vox ID – OAuth2 / OpenID Connect Provider
==================================================

Implements the server-side of OAuth2 Authorization Code flow so that
Singra Vox instances can authenticate users via "Login with Singra Vox ID".

Flow overview:
    1. Instance redirects user to  GET /api/id/oauth/authorize
    2. User authenticates (or is already logged in)
    3. ID server redirects back with ?code=...&state=...
    4. Instance exchanges code via POST /api/id/oauth/token
    5. Instance gets {access_token, id_token} → calls GET /api/id/oauth/userinfo
    6. Instance creates/links local user

Client registration:
    Each instance must register once to get a client_id + client_secret.
    This can happen manually (admin panel) or automatically (install.sh).
"""
import hashlib
import secrets
import uuid
from datetime import datetime, timezone, timedelta

import jwt as pyjwt

from app.identity.config import (
    SVID_JWT_ALG,
    SVID_JWT_SECRET,
    SVID_OAUTH_CODE_TTL_SECONDS,
    SVID_ACCESS_TOKEN_TTL_MINUTES,
    SVID_ISSUER,
)


def generate_client_credentials() -> dict:
    """Generate a new OAuth2 client_id + client_secret pair."""
    return {
        "client_id": f"svid_{uuid.uuid4().hex[:16]}",
        "client_secret": secrets.token_urlsafe(48),
    }


def generate_authorization_code() -> str:
    """Generate a single-use, short-lived authorization code."""
    return secrets.token_urlsafe(48)


def hash_authorization_code(code: str) -> str:
    """Hash an authorization code for safe storage."""
    return hashlib.sha256(code.encode()).hexdigest()


def build_id_token(user: dict, *, audience: str, nonce: str = "") -> str:
    """
    Build an OpenID Connect ID token (JWT).

    Claims:
        sub   – Singra Vox ID account ID (stable, unique)
        email – User's email address
        name  – Display name
        preferred_username – Username
        iss   – Issuer URL
        aud   – Client ID of the requesting instance
        iat   – Issued at
        exp   – Expiry
    """
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "name": user.get("display_name", user.get("username", "")),
        "preferred_username": user.get("username", ""),
        "avatar_url": user.get("avatar_url", ""),
        "iss": SVID_ISSUER,
        "aud": audience,
        "iat": now,
        "exp": now + timedelta(minutes=SVID_ACCESS_TOKEN_TTL_MINUTES),
        "type": "id_token",
    }
    if nonce:
        payload["nonce"] = nonce
    return pyjwt.encode(payload, SVID_JWT_SECRET, algorithm=SVID_JWT_ALG)


def build_svid_access_token(user_id: str, email: str, session_id: str) -> str:
    """Build an access token for the Singra Vox ID API itself."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "sid": session_id,
        "iss": SVID_ISSUER,
        "iat": now,
        "exp": now + timedelta(minutes=SVID_ACCESS_TOKEN_TTL_MINUTES),
        "type": "svid_access",
    }
    return pyjwt.encode(payload, SVID_JWT_SECRET, algorithm=SVID_JWT_ALG)


def decode_svid_token(token: str) -> dict:
    """Decode and validate a Singra Vox ID token."""
    return pyjwt.decode(
        token,
        SVID_JWT_SECRET,
        algorithms=[SVID_JWT_ALG],
        options={"require": ["sub", "exp", "iat"]},
    )


def build_oauth_code_record(
    *,
    user_id: str,
    client_id: str,
    redirect_uri: str,
    scope: str,
    state: str,
    code: str,
) -> dict:
    """Build a database record for an OAuth2 authorization code."""
    now = datetime.now(timezone.utc)
    return {
        "id": str(uuid.uuid4()),
        "code_hash": hash_authorization_code(code),
        "user_id": user_id,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(seconds=SVID_OAUTH_CODE_TTL_SECONDS)).isoformat(),
        "used": False,
    }
