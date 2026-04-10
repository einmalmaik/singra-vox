from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.database import db
from app.permissions import (
    assert_channel_permission,
    get_message_history_cutoff,
    has_channel_permission,
)
from app.core.utils import new_id, now_utc, sanitize_user
from app.dependencies import current_user
from app.services.e2ee import ensure_private_channel_member_access
from app.services.message_mentions import hydrate_message_mentions, resolve_message_mentions
from app.ws import ws_mgr


router = APIRouter(prefix="/api/messages", tags=["Messages"])


@router.put("/{message_id}")
async def edit_message(message_id: str, request: Request):
    user = await current_user(request)
    body = await request.json()
    message = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not message:
        raise HTTPException(404, "Message not found")
    if message["author_id"] != user["id"]:
        raise HTTPException(403, "Not your message")
    if message.get("is_e2ee"):
        raise HTTPException(400, "Editing encrypted messages is not supported yet")

    old_content = message["content"]
    new_content = body.get("content", old_content)
    channel = await db.channels.find_one({"id": message["channel_id"]}, {"_id": 0}) if message.get("channel_id") else None
    mention_data = (
        await resolve_message_mentions(
            server_id=channel["server_id"],
            actor_id=user["id"],
            channel=channel,
            content=new_content,
            mentioned_user_ids=[],
            mentioned_role_ids=[],
            mentions_everyone=False,
        )
        if channel
        else {
            "mentioned_user_ids": [],
            "mentioned_role_ids": [],
            "mentions_everyone": False,
            "notify_user_ids": [],
        }
    )
    await db.messages.update_one(
        {"id": message_id},
        {
            "$set": {
                "content": new_content,
                "edited_at": now_utc(),
                "mention_ids": mention_data["mentioned_user_ids"],
                "mentioned_user_ids": mention_data["mentioned_user_ids"],
                "mentioned_role_ids": mention_data["mentioned_role_ids"],
                "mentions_everyone": mention_data["mentions_everyone"],
            }
        },
    )
    await db.message_revisions.insert_one(
        {
            "id": new_id(),
            "message_id": message_id,
            "content": old_content,
            "editor_id": user["id"],
            "edited_at": now_utc(),
        }
    )
    updated_message = await db.messages.find_one({"id": message_id}, {"_id": 0})
    updated_message["author"] = user
    await hydrate_message_mentions(updated_message)
    if channel:
        await ws_mgr.broadcast_server(channel["server_id"], {"type": "message_edit", "message": updated_message})
    return updated_message


@router.delete("/{message_id}")
async def delete_message(message_id: str, request: Request):
    user = await current_user(request)
    message = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not message:
        raise HTTPException(404, "Message not found")
    channel = await db.channels.find_one({"id": message["channel_id"]}, {"_id": 0})
    is_author = message["author_id"] == user["id"]
    can_manage = channel and await has_channel_permission(db, user["id"], channel, "manage_messages")
    if not is_author and not can_manage:
        raise HTTPException(403, "No permission")

    await db.messages.update_one(
        {"id": message_id},
        {"$set": {"is_deleted": True, "content": "[deleted]"}},
    )
    if channel:
        await ws_mgr.broadcast_server(
            channel["server_id"],
            {"type": "message_delete", "message_id": message_id, "channel_id": message["channel_id"]},
        )
    return {"ok": True}


@router.get("/{message_id}")
async def get_message(message_id: str, request: Request):
    user = await current_user(request)
    message = await db.messages.find_one({"id": message_id, "is_deleted": {"$ne": True}}, {"_id": 0})
    if not message:
        raise HTTPException(404, "Message not found")

    channel = await db.channels.find_one({"id": message["channel_id"]}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    await assert_channel_permission(db, user["id"], channel, "read_messages", "No permission")
    await ensure_private_channel_member_access(user["id"], channel)

    history_cutoff = await get_message_history_cutoff(db, user["id"], channel["server_id"], channel=channel)
    if history_cutoff and message.get("created_at") and message["created_at"] < history_cutoff:
        raise HTTPException(403, "No permission to read message history")

    author = await db.users.find_one({"id": message["author_id"]}, {"_id": 0, "password_hash": 0})
    message["author"] = sanitize_user(author) if author else None
    await hydrate_message_mentions(message)
    return message


@router.post("/{message_id}/reactions/{emoji}")
async def toggle_reaction(message_id: str, emoji: str, request: Request):
    user = await current_user(request)
    message = await db.messages.find_one({"id": message_id}, {"_id": 0})
    if not message:
        raise HTTPException(404)
    reactions = message.get("reactions", {})
    if emoji not in reactions:
        reactions[emoji] = []
    if user["id"] in reactions[emoji]:
        reactions[emoji].remove(user["id"])
        if not reactions[emoji]:
            del reactions[emoji]
    else:
        reactions[emoji].append(user["id"])
    await db.messages.update_one({"id": message_id}, {"$set": {"reactions": reactions}})
    return {"reactions": reactions}
