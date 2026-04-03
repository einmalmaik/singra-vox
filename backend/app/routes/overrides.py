"""
Singra Vox – Channel-access & permission-override routes
==========================================================
Manages per-channel permission overrides (allow/deny layers) and the
access control list for private channels.  Also handles temporary rooms.

Routes
------
    GET    /api/channels/{channel_id}/overrides
    PUT    /api/channels/{channel_id}/overrides
    DELETE /api/channels/{channel_id}/overrides/{target_type}/{target_id}
    GET    /api/channels/{channel_id}/access
    PUT    /api/channels/{channel_id}/access
    POST   /api/servers/{server_id}/channels/temp
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth_service import load_current_user
from app.core.database import db
from app.core.utils import now_utc, new_id
from app.permissions import (
    assert_channel_permission,
    assert_server_permission,
    has_server_permission,
)

router = APIRouter(prefix="/api", tags=["overrides"])


async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


# ── Input models ──────────────────────────────────────────────────────────────

class OverrideInput(BaseModel):
    """Permission override for a single role, user, or @everyone."""
    target_type: str   # "everyone" | "role" | "user"
    target_id: str
    permissions: dict  # {permission_name: bool}


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/channels/{channel_id}/overrides")
async def list_overrides(channel_id: str, request: Request) -> list:
    """List all permission overrides for a channel (requires manage_channels)."""
    user = await _current_user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    await assert_server_permission(
        db, user["id"], channel["server_id"], "manage_channels",
        "Keine Berechtigung, Kanal-Einstellungen zu lesen"
    )
    return await db.channel_overrides.find(
        {"channel_id": channel_id}, {"_id": 0}
    ).to_list(50)


@router.put("/channels/{channel_id}/overrides")
async def set_override(channel_id: str, inp: OverrideInput, request: Request) -> dict:
    """Create or update a permission override entry."""
    user = await _current_user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not await has_server_permission(db, user["id"], channel["server_id"], "manage_channels"):
        raise HTTPException(403, "Insufficient permissions")

    await db.channel_overrides.update_one(
        {
            "channel_id": channel_id,
            "target_type": inp.target_type,
            "target_id": inp.target_id,
        },
        {"$set": {"permissions": inp.permissions, "updated_at": now_utc()}},
        upsert=True,
    )
    return {"ok": True}


@router.delete("/channels/{channel_id}/overrides/{target_type}/{target_id}")
async def delete_override(
    channel_id: str, target_type: str, target_id: str, request: Request
) -> dict:
    """Remove a permission override entry."""
    user = await _current_user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if channel and not await has_server_permission(
        db, user["id"], channel["server_id"], "manage_channels"
    ):
        raise HTTPException(403, "Insufficient permissions")

    await db.channel_overrides.delete_one(
        {"channel_id": channel_id, "target_type": target_type, "target_id": target_id}
    )
    return {"ok": True}


@router.get("/channels/{channel_id}/access")
async def get_access_list(channel_id: str, request: Request) -> list:
    """Return the access-control list for a private channel (requires manage_channels)."""
    user = await _current_user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    await assert_server_permission(
        db, user["id"], channel["server_id"], "manage_channels",
        "Keine Berechtigung, Kanal-Zugriffsliste zu lesen"
    )
    return await db.channel_access.find(
        {"channel_id": channel_id}, {"_id": 0}
    ).to_list(200)


@router.put("/channels/{channel_id}/access")
async def set_access_list(channel_id: str, request: Request) -> dict:
    """Replace the access-control list for a private channel."""
    user = await _current_user(request)
    body = await request.json()
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if channel and not await has_server_permission(
        db, user["id"], channel["server_id"], "manage_channels"
    ):
        raise HTTPException(403, "Insufficient permissions")

    await db.channel_access.delete_many({"channel_id": channel_id})
    docs = [
        {"channel_id": channel_id, "type": "user", "target_id": uid}
        for uid in body.get("user_ids", [])
    ] + [
        {"channel_id": channel_id, "type": "role", "target_id": rid}
        for rid in body.get("role_ids", [])
    ]
    if docs:
        await db.channel_access.insert_many(docs)
    return {"ok": True}


@router.post("/servers/{server_id}/channels/temp")
async def create_temporary_channel(server_id: str, request: Request) -> dict:
    """Create a short-lived temporary channel (requires manage_channels)."""
    user = await _current_user(request)
    body = await request.json()

    await assert_server_permission(
        db, user["id"], server_id, "manage_channels",
        "Keine Berechtigung, Kanäle zu erstellen"
    )

    position = await db.channels.count_documents({"server_id": server_id})
    channel = {
        "id": new_id(),
        "server_id": server_id,
        "name": body.get("name", f"temp-{new_id()[:8]}"),
        "type": body.get("type", "text"),
        "topic": body.get("topic", "Temporary channel"),
        "parent_id": body.get("parent_id"),
        "position": position,
        "is_private": body.get("is_private", False),
        "is_temporary": True,
        "created_by": user["id"],
        "slowmode_seconds": 0,
        "created_at": now_utc(),
    }
    await db.channels.insert_one(channel)
    channel.pop("_id", None)
    if channel["type"] == "voice":
        channel["voice_states"] = []
    return channel
