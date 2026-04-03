"""
Singra Vox – Thread routes
============================
Manages threaded replies within channels.

Routes
------
    GET    /api/messages/{message_id}/thread
    POST   /api/channels/{channel_id}/messages/{message_id}/reply
    GET    /api/messages/{message_id}/revisions
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.auth_service import load_current_user
from app.core.database import db
from app.core.utils import now_utc, new_id
from app.core.constants import E2EE_DEVICE_HEADER
from app.pagination import clamp_page_limit
from app.permissions import (
    assert_channel_access,
    assert_channel_permission,
    has_channel_permission,
    get_message_history_cutoff,
)

router = APIRouter(prefix="/api", tags=["threads"])


async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


async def _require_verified_device(request: Request, user: dict) -> dict:
    device_id = (request.headers.get(E2EE_DEVICE_HEADER) or "").strip() or None
    if not device_id:
        raise HTTPException(400, "E2EE device header required")
    device = await db.e2ee_devices.find_one(
        {"user_id": user["id"], "device_id": device_id}, {"_id": 0}
    )
    if not device or device.get("revoked_at") or not device.get("verified_at"):
        raise HTTPException(403, "E2EE device is not trusted")
    return device


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/messages/{message_id}/thread")
async def get_thread(message_id: str, request: Request) -> dict:
    """Return the parent message and all its replies."""
    user = await _current_user(request)

    parent = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not parent:
        raise HTTPException(404, "Message not found")

    channel = await db.channels.find_one({"id": parent["channel_id"]}, {"_id": 0})
    if not channel or not await has_channel_permission(
        db, user["id"], channel, "read_messages"
    ):
        raise HTTPException(403, "No permission")

    await assert_channel_access(db, user["id"], channel)

    cutoff = await get_message_history_cutoff(
        db, user["id"], channel["server_id"], channel=channel
    )
    if cutoff and parent.get("created_at") and parent["created_at"] < cutoff:
        raise HTTPException(403, "No permission to read message history")

    author = await db.users.find_one(
        {"id": parent["author_id"]}, {"_id": 0, "password_hash": 0}
    )
    parent["author"] = author

    reply_query: dict = {"thread_id": message_id, "is_deleted": {"$ne": True}}
    if cutoff:
        reply_query["created_at"] = {"$gte": cutoff}

    replies = await db.messages.find(reply_query, {"_id": 0}).sort("created_at", 1).to_list(200)
    for r in replies:
        a = await db.users.find_one({"id": r["author_id"]}, {"_id": 0, "password_hash": 0})
        r["author"] = a

    return {"parent": parent, "replies": replies, "reply_count": len(replies)}


@router.post("/channels/{channel_id}/messages/{message_id}/reply")
async def reply_in_thread(channel_id: str, message_id: str, request: Request) -> dict:
    """Post a reply in a message thread."""
    user = await _current_user(request)
    body = await request.json()

    parent = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not parent:
        raise HTTPException(404, "Parent message not found")

    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")

    await assert_channel_access(db, user["id"], channel)
    await assert_channel_permission(
        db, user["id"], channel, "send_messages",
        "Keine Berechtigung, Nachrichten in diesem Kanal zu senden"
    )
    if body.get("attachments"):
        await assert_channel_permission(
            db, user["id"], channel, "attach_files",
            "Keine Berechtigung, Dateien in diesem Kanal hochzuladen"
        )

    is_e2ee = bool(channel.get("is_private"))
    content = body.get("content", "").strip()
    mention_ids: list[str] = []

    if not is_e2ee:
        if not content:
            raise HTTPException(400, "Message content is required")
        import re
        for name in re.findall(r"@(\w+)", content):
            u = await db.users.find_one({"username": name.lower()}, {"_id": 0})
            if u:
                mention_ids.append(u["id"])
    else:
        device = await _require_verified_device(request, user)
        if not all([body.get("is_e2ee"), body.get("ciphertext"), body.get("nonce"), body.get("sender_device_id")]):
            raise HTTPException(400, "Encrypted threads require a full E2EE payload")
        if body.get("sender_device_id") != device["device_id"]:
            raise HTTPException(400, "Encrypted messages must originate from the active E2EE device")
        content = "[encrypted]"

    reply = {
        "id": new_id(),
        "channel_id": channel_id,
        "author_id": user["id"],
        "content": content,
        "type": "text",
        "thread_id": message_id,
        "attachments": body.get("attachments", []),
        "edited_at": None,
        "is_deleted": False,
        "reactions": {},
        "reply_to_id": message_id,
        "mention_ids": mention_ids,
        "thread_count": 0,
        "created_at": now_utc(),
        "is_e2ee": is_e2ee,
        "ciphertext": body.get("ciphertext", ""),
        "encrypted_content": body.get("encrypted_content") or body.get("ciphertext", ""),
        "nonce": body.get("nonce", ""),
        "sender_device_id": body.get("sender_device_id"),
        "protocol_version": body.get("protocol_version", "sv-e2ee-v1"),
        "message_type": body.get("message_type", "thread_reply"),
        "key_envelopes": body.get("key_envelopes", []),
    }
    await db.messages.insert_one(reply)
    reply.pop("_id", None)
    reply["author"] = user

    tc = await db.messages.count_documents(
        {"thread_id": message_id, "is_deleted": {"$ne": True}}
    )
    await db.messages.update_one({"id": message_id}, {"$set": {"thread_count": tc}})
    return reply


@router.get("/messages/{message_id}/revisions")
async def get_revisions(message_id: str, request: Request) -> list:
    """Return edit history for a message."""
    user = await _current_user(request)

    parent = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not parent:
        raise HTTPException(404, "Message not found")

    channel = await db.channels.find_one({"id": parent.get("channel_id", "")}, {"_id": 0})
    if channel:
        await assert_channel_permission(
            db, user["id"], channel, "read_messages",
            "Keine Leseberechtigung für diesen Kanal"
        )

    return await db.message_revisions.find(
        {"message_id": message_id}, {"_id": 0}
    ).sort("edited_at", -1).to_list(50)
