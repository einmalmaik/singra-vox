"""
Singra Vox – Search routes
=============================
Full-text search across messages the current user is allowed to read.
Encrypted (E2EE) messages are intentionally excluded – decryption happens
client-side and the server has no access to plaintext.

Routes
------
    GET /api/search
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.auth_service import load_current_user
from app.core.database import db
from app.pagination import clamp_page_limit
from app.permissions import (
    assert_channel_access,
    has_channel_permission,
    get_message_history_cutoff,
)

router = APIRouter(prefix="/api", tags=["search"])


async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


async def _visible_text_channels(user_id: str, server_id: str) -> list[dict]:
    """Return text channels in *server_id* that *user_id* may read."""
    channels = await db.channels.find(
        {"server_id": server_id, "type": "text"}, {"_id": 0}
    ).to_list(200)

    visible = []
    for ch in channels:
        if ch.get("is_private"):
            continue  # never expose private-channel content in server-wide search
        if await has_channel_permission(db, user_id, ch, "read_messages"):
            visible.append(ch)
    return visible


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/search")
async def search_messages(
    request: Request,
    q: str = "",
    server_id: str | None = None,
    channel_id: str | None = None,
    limit: int = 25,
) -> list:
    """Search for messages matching *q*.

    E2EE / private-channel messages are always excluded because the server
    stores only encrypted ciphertext.
    """
    user = await _current_user(request)

    if len(q.strip()) < 2:
        return []

    limit = clamp_page_limit(limit, default=25)
    query: dict = {
        "content": {"$regex": q.strip(), "$options": "i"},
        "is_deleted": {"$ne": True},
        "is_e2ee": {"$ne": True},
    }

    if channel_id:
        channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
        if not channel:
            raise HTTPException(404, "Channel not found")
        if channel.get("is_private"):
            raise HTTPException(400, "Server-side search is unavailable in encrypted channels")
        if not await has_channel_permission(db, user["id"], channel, "read_messages"):
            raise HTTPException(403, "No permission to search this channel")
        await assert_channel_access(db, user["id"], channel)

        query["channel_id"] = channel_id
        cutoff = await get_message_history_cutoff(
            db, user["id"], channel["server_id"], channel=channel
        )
        if cutoff:
            query["created_at"] = {"$gte": cutoff}

    elif server_id:
        channels = await _visible_text_channels(user["id"], server_id)
        if not channels:
            return []
        query["channel_id"] = {"$in": [c["id"] for c in channels]}
        cutoff = await get_message_history_cutoff(db, user["id"], server_id)
        if cutoff:
            query["created_at"] = {"$gte": cutoff}

    results = await db.messages.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    for msg in results:
        msg["author"] = await db.users.find_one(
            {"id": msg["author_id"]}, {"_id": 0, "password_hash": 0}
        )
        msg["channel"] = await db.channels.find_one(
            {"id": msg.get("channel_id")}, {"_id": 0, "name": 1, "server_id": 1}
        )
    return results
