from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from app.core.constants import E2EE_PROTOCOL_VERSION
from app.core.database import db
from app.core.encryption import decrypt_channel_content, encrypt_channel_content, encryption_enabled
from app.core.utils import new_id, now_utc
from app.dependencies import current_user, require_verified_device
from app.pagination import clamp_page_limit
from app.schemas import MessageCreateInput
from app.services.e2ee import ensure_private_channel_member_access
from app.services.message_mentions import hydrate_message_mentions, resolve_message_mentions
from app.services.notifications import send_notification as create_notification
from app.services.server_ops import check_permission
from app.services.server_ops import get_message_history_cutoff as get_server_message_history_cutoff
from app.ws import ws_mgr


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/channels", tags=["Channels"])


@router.put("/{channel_id}")
async def update_channel(channel_id: str, request: Request):
    user = await current_user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not await check_permission(user["id"], channel["server_id"], "manage_channels"):
        raise HTTPException(403, "No permission")

    body = await request.json()
    updates = {
        key: value
        for key, value in body.items()
        if key in {"name", "topic", "is_private", "slowmode_seconds", "position"} and value is not None
    }
    if "name" in updates and isinstance(updates["name"], str):
        display_name = updates["name"].strip()
        if not display_name:
            raise HTTPException(400, "Channel name is required")
        updates["name"] = (
            display_name if channel["type"] == "category" else display_name.lower().replace(" ", "-")
        )
    if "parent_id" in body:
        parent_id = body.get("parent_id")
        if channel["type"] == "category":
            parent_id = None
        elif parent_id:
            parent = await db.channels.find_one({"id": parent_id, "server_id": channel["server_id"]}, {"_id": 0})
            if not parent or parent.get("type") != "category":
                raise HTTPException(400, "Parent must be a category in the same server")
        updates["parent_id"] = parent_id
    if channel["type"] == "category":
        updates.pop("topic", None)
        updates["is_private"] = False
    if updates:
        await db.channels.update_one({"id": channel_id}, {"$set": updates})
    updated_channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if updated_channel:
        if updated_channel["type"] == "voice":
            updated_channel["voice_states"] = await db.voice_states.find({"channel_id": channel_id}, {"_id": 0}).to_list(50)
        await ws_mgr.broadcast_server(updated_channel["server_id"], {"type": "channel_updated", "channel": updated_channel})
    return updated_channel


@router.delete("/{channel_id}")
async def delete_channel(channel_id: str, request: Request):
    user = await current_user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not await check_permission(user["id"], channel["server_id"], "manage_channels"):
        raise HTTPException(403, "No permission")

    if channel.get("type") == "category":
        await db.channels.update_many(
            {"server_id": channel["server_id"], "parent_id": channel_id},
            {"$set": {"parent_id": None}},
        )
        reparented_children = await db.channels.find(
            {"server_id": channel["server_id"], "parent_id": None, "id": {"$ne": channel_id}},
            {"_id": 0},
        ).to_list(200)
        for child in reparented_children:
            await ws_mgr.broadcast_server(channel["server_id"], {"type": "channel_updated", "channel": child})

    await db.channels.delete_one({"id": channel_id})
    await db.messages.delete_many({"channel_id": channel_id})
    await ws_mgr.broadcast_server(channel["server_id"], {"type": "channel_delete", "channel_id": channel_id})
    return {"ok": True}


@router.get("/{channel_id}/messages")
async def get_messages(channel_id: str, request: Request, before: Optional[str] = None, limit: int = 50):
    user = await current_user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    limit = clamp_page_limit(limit)
    if not await check_permission(user["id"], channel["server_id"], "read_messages", channel=channel):
        raise HTTPException(403, "No permission")
    await ensure_private_channel_member_access(user["id"], channel)

    query = {"channel_id": channel_id, "is_deleted": {"$ne": True}}
    history_cutoff = await get_server_message_history_cutoff(user["id"], channel["server_id"], channel=channel)
    created_at_filters: dict[str, str] = {}
    if before:
        created_at_filters["$lt"] = before
    if history_cutoff:
        created_at_filters["$gte"] = history_cutoff
    if created_at_filters:
        query["created_at"] = created_at_filters

    messages = await db.messages.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    messages.reverse()
    for message in messages:
        author = await db.users.find_one({"id": message["author_id"]}, {"_id": 0, "password_hash": 0})
        message["author"] = author
        if message.get("encrypted_at_rest") and not message.get("is_e2ee"):
            message["content"] = decrypt_channel_content(channel_id, message["content"])
        await hydrate_message_mentions(message)

    next_before = messages[0]["created_at"] if messages else None
    return {
        "messages": messages,
        "next_before": next_before,
        "has_more_before": len(messages) == limit,
    }


@router.post("/{channel_id}/messages")
async def send_message(channel_id: str, inp: MessageCreateInput, request: Request):
    user = await current_user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not await check_permission(user["id"], channel["server_id"], "send_messages", channel=channel):
        raise HTTPException(403, "No permission")
    if inp.attachments and not await check_permission(user["id"], channel["server_id"], "attach_files", channel=channel):
        raise HTTPException(403, "No permission to upload files")
    await ensure_private_channel_member_access(user["id"], channel)

    member = await db.server_members.find_one(
        {"server_id": channel["server_id"], "user_id": user["id"]},
        {"_id": 0},
    )
    if member and member.get("muted_until"):
        if datetime.fromisoformat(member["muted_until"]) > datetime.now(timezone.utc):
            raise HTTPException(403, "You are muted")

    is_e2ee_channel = bool(channel.get("is_private"))
    mention_data = await resolve_message_mentions(
        server_id=channel["server_id"],
        actor_id=user["id"],
        channel=channel,
        content=inp.content,
        mentioned_user_ids=inp.mentioned_user_ids,
        mentioned_role_ids=inp.mentioned_role_ids,
        mentions_everyone=inp.mentions_everyone,
    )
    if is_e2ee_channel:
        device = await require_verified_device(request, user)
        if not inp.is_e2ee or not inp.ciphertext or not inp.nonce or not inp.sender_device_id:
            raise HTTPException(400, "Private channels require encrypted desktop messages")
        if inp.sender_device_id != device["device_id"]:
            raise HTTPException(400, "Encrypted messages must originate from the active E2EE device")
        message = {
            "id": new_id(),
            "channel_id": channel_id,
            "author_id": user["id"],
            "content": "[encrypted]",
            "type": inp.message_type or "text",
            "attachments": inp.attachments,
            "edited_at": None,
            "is_deleted": False,
            "reactions": {},
            "reply_to_id": inp.reply_to_id,
            "mention_ids": mention_data["mentioned_user_ids"],
            "mentioned_user_ids": mention_data["mentioned_user_ids"],
            "mentioned_role_ids": mention_data["mentioned_role_ids"],
            "mentions_everyone": mention_data["mentions_everyone"],
            "thread_id": None,
            "thread_count": 0,
            "created_at": now_utc(),
            "is_e2ee": True,
            "ciphertext": inp.ciphertext,
            "nonce": inp.nonce,
            "sender_device_id": inp.sender_device_id,
            "protocol_version": inp.protocol_version or E2EE_PROTOCOL_VERSION,
            "key_envelopes": inp.key_envelopes,
        }
    else:
        stored_content = encrypt_channel_content(channel_id, inp.content)
        message = {
            "id": new_id(),
            "channel_id": channel_id,
            "author_id": user["id"],
            "content": stored_content,
            "type": "text",
            "attachments": inp.attachments,
            "edited_at": None,
            "is_deleted": False,
            "reactions": {},
            "reply_to_id": inp.reply_to_id,
            "mention_ids": mention_data["mentioned_user_ids"],
            "mentioned_user_ids": mention_data["mentioned_user_ids"],
            "mentioned_role_ids": mention_data["mentioned_role_ids"],
            "mentions_everyone": mention_data["mentions_everyone"],
            "thread_id": None,
            "thread_count": 0,
            "created_at": now_utc(),
            "is_e2ee": False,
            "encrypted_at_rest": encryption_enabled(),
        }
    await db.messages.insert_one(message)
    message.pop("_id", None)
    message["author"] = user
    if message.get("encrypted_at_rest") and not message.get("is_e2ee"):
        message["content"] = decrypt_channel_content(channel_id, message["content"])
    await hydrate_message_mentions(message)

    try:
        await ws_mgr.broadcast_server(
            channel["server_id"],
            {"type": "new_message", "message": message, "channel_id": channel_id},
        )
    except Exception as exc:
        logger.error("Failed to broadcast message: %s", exc)

    for mentioned_user_id in mention_data["notify_user_ids"]:
        if mentioned_user_id == user["id"]:
            continue
        try:
            await create_notification(
                mentioned_user_id,
                ntype="mention",
                title=f"@{user['display_name']} mentioned you",
                body="[Encrypted message]" if is_e2ee_channel else inp.content[:100],
                link=f"/channel/{channel_id}",
                from_user_id=user["id"],
            )
        except Exception as exc:
            logger.error("Failed to create notification for %s: %s", mentioned_user_id, exc)

    return message
