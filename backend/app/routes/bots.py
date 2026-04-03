"""
Singra Vox – Bot-token routes
================================
Allows server administrators to create long-lived API tokens for
automated bots that post messages or read channel content.

Security notes
--------------
* Tokens begin with ``svbot_`` to distinguish them from user JWTs.
* Listing bot tokens masks all but the first 12 characters of the token
  string so that the secret is not leaked in the admin UI.
* Only users with ``manage_server`` permission may create or delete tokens.

Routes
------
    POST   /api/servers/{server_id}/bot-tokens
    GET    /api/servers/{server_id}/bot-tokens
    DELETE /api/servers/{server_id}/bot-tokens/{token_id}
"""
from __future__ import annotations

import secrets

from fastapi import APIRouter, HTTPException, Request

from app.auth_service import load_current_user
from app.core.database import db
from app.core.utils import now_utc, new_id
from app.permissions import has_server_permission

router = APIRouter(prefix="/api", tags=["bots"])


async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/servers/{server_id}/bot-tokens")
async def create_bot_token(server_id: str, request: Request) -> dict:
    """Create a new bot token for programmatic API access."""
    user = await _current_user(request)
    if not await has_server_permission(db, user["id"], server_id, "manage_server"):
        raise HTTPException(403, "manage_server permission required")

    body = await request.json()
    token = f"svbot_{secrets.token_urlsafe(48)}"
    bot_token = {
        "id": new_id(),
        "server_id": server_id,
        "name": body.get("name", "Bot"),
        "token": token,
        "permissions": body.get("permissions", {"send_messages": True, "read_messages": True}),
        "created_by": user["id"],
        "created_at": now_utc(),
    }
    await db.bot_tokens.insert_one(bot_token)
    bot_token.pop("_id", None)
    return bot_token  # full token is returned once on creation – store it safely!


@router.get("/servers/{server_id}/bot-tokens")
async def list_bot_tokens(server_id: str, request: Request) -> list:
    """List bot tokens (token value masked after the first 12 characters)."""
    user = await _current_user(request)
    if not await has_server_permission(db, user["id"], server_id, "manage_server"):
        raise HTTPException(403, "manage_server permission required")

    tokens = await db.bot_tokens.find({"server_id": server_id}, {"_id": 0}).to_list(20)
    for t in tokens:
        # Mask the secret part – only show the prefix so admins can identify tokens
        t["token"] = t["token"][:12] + "…"
    return tokens


@router.delete("/servers/{server_id}/bot-tokens/{token_id}")
async def delete_bot_token(server_id: str, token_id: str, request: Request) -> dict:
    """Revoke a bot token."""
    user = await _current_user(request)
    if not await has_server_permission(db, user["id"], server_id, "manage_server"):
        raise HTTPException(403, "manage_server permission required")
    await db.bot_tokens.delete_one({"id": token_id, "server_id": server_id})
    return {"ok": True}
