"""
Singra Vox – Custom-emoji routes
===================================
Manages per-server custom emoji images.  Images are stored as base-64
in MongoDB (they are small thumbnail-sized assets, typically < 256 KB).

Routes
------
    POST   /api/servers/{server_id}/emojis
    GET    /api/servers/{server_id}/emojis
    GET    /api/emojis/{emoji_id}          (public, cached)
    DELETE /api/servers/{server_id}/emojis/{emoji_id}
"""
from __future__ import annotations

import base64

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from app.auth_service import load_current_user
from app.core.database import db
from app.core.utils import now_utc, new_id
from app.permissions import (
    assert_server_member,
    has_server_permission,
)

router = APIRouter(prefix="/api", tags=["emojis"])

_MAX_EMOJI_BYTES = 350_000   # ~256 KB base-64
_MAX_EMOJI_PER_SERVER = 50


async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


async def _can_manage_emojis(user_id: str, server_id: str) -> bool:
    return await has_server_permission(
        db, user_id, server_id, "manage_emojis"
    ) or await has_server_permission(db, user_id, server_id, "manage_server")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/servers/{server_id}/emojis")
async def upload_emoji(server_id: str, request: Request) -> dict:
    """Upload a new custom emoji to a server."""
    user = await _current_user(request)
    if not await _can_manage_emojis(user["id"], server_id):
        raise HTTPException(403, "No permission to manage emojis")

    body = await request.json()
    name = body.get("name", "").strip().lower().replace(" ", "_")
    data = body.get("data", "")

    if not name:
        raise HTTPException(400, "Emoji name is required")
    if len(name) > 32:
        raise HTTPException(400, "Emoji name must be 32 characters or fewer")
    if not data:
        raise HTTPException(400, "Image data is required")
    if len(data) > _MAX_EMOJI_BYTES:
        raise HTTPException(400, "Image too large (max ~256 KB)")

    count = await db.server_emojis.count_documents({"server_id": server_id})
    if count >= _MAX_EMOJI_PER_SERVER:
        raise HTTPException(400, f"Server has reached the emoji limit ({_MAX_EMOJI_PER_SERVER})")

    if await db.server_emojis.find_one({"server_id": server_id, "name": name}):
        raise HTTPException(400, "An emoji with that name already exists")

    emoji_id = new_id()
    await db.server_emojis.insert_one({
        "id": emoji_id,
        "server_id": server_id,
        "name": name,
        "data": data,
        "uploaded_by": user["id"],
        "created_at": now_utc(),
    })
    return {"id": emoji_id, "name": name, "url": f"/api/emojis/{emoji_id}"}


@router.get("/servers/{server_id}/emojis")
async def list_server_emojis(server_id: str, request: Request) -> list:
    """List all custom emojis for a server. Requires server membership."""
    user = await _current_user(request)
    await assert_server_member(db, user["id"], server_id)
    emojis = await db.server_emojis.find(
        {"server_id": server_id}, {"_id": 0, "data": 0}
    ).to_list(100)
    for e in emojis:
        e["url"] = f"/api/emojis/{e['id']}"
    return emojis


@router.get("/emojis/{emoji_id}")
async def get_emoji_image(emoji_id: str) -> Response:
    """Serve an emoji image.  Long-lived cache since emojis rarely change."""
    emoji = await db.server_emojis.find_one({"id": emoji_id}, {"_id": 0})
    if not emoji:
        raise HTTPException(404, "Emoji not found")
    try:
        raw = base64.b64decode(emoji["data"])
    except Exception:
        raise HTTPException(500, "Corrupted emoji data")

    return Response(
        content=raw,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@router.delete("/servers/{server_id}/emojis/{emoji_id}")
async def delete_emoji(server_id: str, emoji_id: str, request: Request) -> dict:
    user = await _current_user(request)
    if not await _can_manage_emojis(user["id"], server_id):
        raise HTTPException(403, "No permission to manage emojis")
    await db.server_emojis.delete_one({"id": emoji_id, "server_id": server_id})
    return {"ok": True}
