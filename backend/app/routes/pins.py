# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox – Message-pinning routes
=======================================
Allows users with the appropriate permission to pin important messages
to a channel and view the channel's pin board.

Routes
------
    POST   /api/messages/{message_id}/pin
    DELETE /api/messages/{message_id}/pin
    GET    /api/channels/{channel_id}/pins
    PUT    /api/channels/{channel_id}/topic
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.auth_service import load_current_user
from app.core.database import db
from app.core.utils import now_utc
from app.permissions import assert_channel_access, has_channel_permission, get_message_history_cutoff

router = APIRouter(prefix="/api", tags=["pins"])


async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/messages/{message_id}/pin")
async def pin_message(message_id: str, request: Request) -> dict:
    """Pin a message to its channel."""
    user = await _current_user(request)

    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Message not found")

    channel = await db.channels.find_one({"id": msg["channel_id"]}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")

    await assert_channel_access(db, user["id"], channel)

    can_pin = await has_channel_permission(db, user["id"], channel, "pin_messages")
    can_manage = await has_channel_permission(db, user["id"], channel, "manage_messages")
    if not can_pin and not can_manage:
        raise HTTPException(403, "No permission to pin messages")

    await db.messages.update_one(
        {"id": message_id},
        {"$set": {"is_pinned": True, "pinned_by": user["id"], "pinned_at": now_utc()}},
    )
    return {"ok": True}


@router.delete("/messages/{message_id}/pin")
async def unpin_message(message_id: str, request: Request) -> dict:
    """Remove a message from the channel pin board."""
    user = await _current_user(request)

    msg = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not msg:
        raise HTTPException(404, "Message not found")

    channel = await db.channels.find_one({"id": msg["channel_id"]}, {"_id": 0})
    if channel:
        await assert_channel_access(db, user["id"], channel)
        can_pin = await has_channel_permission(db, user["id"], channel, "pin_messages")
        can_manage = await has_channel_permission(db, user["id"], channel, "manage_messages")
        if not can_pin and not can_manage:
            raise HTTPException(403, "No permission to unpin messages")

    await db.messages.update_one(
        {"id": message_id},
        {"$set": {"is_pinned": False, "pinned_by": None, "pinned_at": None}},
    )
    return {"ok": True}


@router.get("/channels/{channel_id}/pins")
async def get_pinned_messages(channel_id: str, request: Request) -> list:
    """Return all pinned messages in a channel."""
    user = await _current_user(request)

    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not await has_channel_permission(db, user["id"], channel, "read_messages"):
        raise HTTPException(403, "No permission")

    await assert_channel_access(db, user["id"], channel)

    cutoff = await get_message_history_cutoff(
        db, user["id"], channel["server_id"], channel=channel
    )
    pin_query: dict = {"channel_id": channel_id, "is_pinned": True, "is_deleted": {"$ne": True}}
    if cutoff:
        pin_query["created_at"] = {"$gte": cutoff}

    pins = await db.messages.find(pin_query, {"_id": 0}).sort("pinned_at", -1).to_list(50)
    for pin in pins:
        pin["author"] = await db.users.find_one(
            {"id": pin["author_id"]}, {"_id": 0, "password_hash": 0}
        )
    return pins


@router.put("/channels/{channel_id}/topic")
async def update_channel_topic(channel_id: str, request: Request) -> dict:
    """Update the visible topic for a channel."""
    user = await _current_user(request)
    body = await request.json()

    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not await has_channel_permission(db, user["id"], channel, "manage_channels"):
        raise HTTPException(403, "No permission to manage channels")

    topic = body.get("topic", "")
    await db.channels.update_one({"id": channel_id}, {"$set": {"topic": topic}})
    return {"ok": True, "topic": topic}
