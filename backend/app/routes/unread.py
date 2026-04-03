"""
Singra Vox – Unread tracking routes
=======================================
Tracks which messages a user has already read and provides unread counts.

Routes
------
    GET  /api/unread
    POST /api/channels/{channel_id}/read
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.auth_service import load_current_user
from app.core.database import db
from app.core.utils import now_utc
from app.permissions import (
    get_message_history_cutoff,
    assert_channel_permission,
    has_channel_permission,
)

router = APIRouter(prefix="/api", tags=["unread"])


async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


async def _accessible_channels(user_id: str, server_id: str) -> list[dict]:
    """Return all text channels in *server_id* that *user_id* may read."""
    channels = await db.channels.find(
        {"server_id": server_id, "type": "text"}, {"_id": 0}
    ).to_list(200)
    return [
        ch for ch in channels
        if await has_channel_permission(db, user_id, ch, "read_messages")
    ]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/unread")
async def get_unread(request: Request) -> dict:
    """Return per-channel and per-server unread counters for the current user."""
    user = await _current_user(request)

    memberships = await db.server_members.find(
        {"user_id": user["id"], "is_banned": {"$ne": True}},
        {"_id": 0, "server_id": 1, "roles": 1},
    ).to_list(100)

    channel_unread: dict = {}
    server_unread: dict = {}

    for membership in memberships:
        sid = membership["server_id"]
        member_roles = membership.get("roles") or []
        channels = await _accessible_channels(user["id"], sid)

        for ch in channels:
            state = await db.read_states.find_one(
                {"user_id": user["id"], "channel_id": ch["id"]}, {"_id": 0}
            )
            last_read = state["last_read_at"] if state else "1970-01-01T00:00:00"

            cutoff = await get_message_history_cutoff(db, user["id"], sid)
            if cutoff and last_read < cutoff:
                last_read = cutoff

            count = await db.messages.count_documents({
                "channel_id": ch["id"],
                "created_at": {"$gt": last_read},
                "author_id": {"$ne": user["id"]},
                "is_deleted": {"$ne": True},
            })

            mention_conditions: list = [
                {"mention_ids": user["id"]},
                {"mentioned_user_ids": user["id"]},
            ]
            if member_roles:
                mention_conditions.append({"mentioned_role_ids": {"$in": member_roles}})
            mention_conditions.append({"mentions_everyone": True})

            mentions = await db.messages.count_documents({
                "channel_id": ch["id"],
                "created_at": {"$gt": last_read},
                "author_id": {"$ne": user["id"]},
                "is_deleted": {"$ne": True},
                "$or": mention_conditions,
            })

            if count > 0:
                channel_unread[ch["id"]] = {"count": count, "mentions": mentions}
                prev = server_unread.get(sid, {"count": 0, "mentions": 0})
                server_unread[sid] = {
                    "count": prev["count"] + count,
                    "mentions": prev["mentions"] + mentions,
                }

    dm_unread = await db.direct_messages.count_documents(
        {"receiver_id": user["id"], "read": False}
    )
    return {"channels": channel_unread, "servers": server_unread, "dm_total": dm_unread}


@router.post("/channels/{channel_id}/read")
async def mark_channel_read(channel_id: str, request: Request) -> dict:
    """Mark all messages in a channel as read for the current user."""
    user = await _current_user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    await assert_channel_permission(
        db, user["id"], channel, "read_messages",
        "Keine Leseberechtigung für diesen Kanal"
    )
    await db.read_states.update_one(
        {"user_id": user["id"], "channel_id": channel_id},
        {"$set": {"last_read_at": now_utc()}},
        upsert=True,
    )
    return {"ok": True}
