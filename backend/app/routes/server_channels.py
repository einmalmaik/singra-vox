from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.database import db
from app.core.utils import new_id, now_utc, sanitize_user
from app.dependencies import current_user
from app.schemas import ChannelCreateInput, ChannelReorderInput
from app.services.server_ops import check_permission, log_audit
from app.ws import ws_mgr


router = APIRouter(prefix="/api/servers", tags=["Servers"])


@router.get("/{server_id}/channels")
async def list_channels(server_id: str, request: Request):
    user = await current_user(request)
    member = await db.server_members.find_one(
        {"server_id": server_id, "user_id": user["id"]},
        {"_id": 0},
    )
    if not member or member.get("is_banned"):
        raise HTTPException(403, "Not a member")

    channels = await db.channels.find({"server_id": server_id}, {"_id": 0}).sort("position", 1).to_list(100)
    visible_channels = []
    for channel in channels:
        visible_permission = "join_voice" if channel.get("type") == "voice" else "read_messages"
        if not await check_permission(user["id"], server_id, visible_permission, channel=channel):
            continue
        if channel["type"] == "voice":
            states = await db.voice_states.find({"channel_id": channel["id"]}, {"_id": 0}).to_list(50)
            for state in states:
                voice_user = await db.users.find_one(
                    {"id": state["user_id"]},
                    {"_id": 0, "password_hash": 0},
                )
                state["user"] = sanitize_user(voice_user) if voice_user else None
            channel["voice_states"] = states
        visible_channels.append(channel)
    return visible_channels


@router.post("/{server_id}/channels")
async def create_channel(server_id: str, inp: ChannelCreateInput, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_channels"):
        raise HTTPException(403, "No permission")

    channel_type = (inp.type or "text").strip().lower()
    if channel_type not in {"text", "voice", "category"}:
        raise HTTPException(400, "Unsupported channel type")

    parent_id = inp.parent_id
    if channel_type == "category":
        parent_id = None
    elif parent_id:
        parent = await db.channels.find_one({"id": parent_id, "server_id": server_id}, {"_id": 0})
        if not parent or parent.get("type") != "category":
            raise HTTPException(400, "Parent must be a category in the same server")

    display_name = inp.name.strip()
    if not display_name:
        raise HTTPException(400, "Channel name is required")

    channel = {
        "id": new_id(),
        "server_id": server_id,
        "name": display_name if channel_type == "category" else display_name.lower().replace(" ", "-"),
        "type": channel_type,
        "topic": "" if channel_type == "category" else (inp.topic or ""),
        "parent_id": parent_id,
        "position": await db.channels.count_documents({"server_id": server_id, "parent_id": parent_id}),
        "is_private": False if channel_type == "category" else inp.is_private,
        "slowmode_seconds": 0,
        "created_at": now_utc(),
    }
    await db.channels.insert_one(channel)
    channel.pop("_id", None)
    if channel["type"] == "voice":
        channel["voice_states"] = []
    await log_audit(server_id, user["id"], "channel_create", "channel", channel["id"], {"name": channel["name"]})
    await ws_mgr.broadcast_server(server_id, {"type": "channel_create", "channel": channel})
    return channel


@router.put("/{server_id}/channels/reorder")
async def reorder_channels(server_id: str, inp: ChannelReorderInput, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_channels"):
        raise HTTPException(403, "No permission")
    if not inp.items:
        return {"ok": True, "channels": []}

    channel_ids = [item.id for item in inp.items]
    existing_channels = await db.channels.find(
        {"server_id": server_id, "id": {"$in": channel_ids}},
        {"_id": 0},
    ).to_list(len(channel_ids))
    existing_map = {channel["id"]: channel for channel in existing_channels}
    if len(existing_map) != len(channel_ids):
        raise HTTPException(400, "One or more channels do not belong to this server")

    parent_ids = {item.parent_id for item in inp.items if item.parent_id}
    if parent_ids:
        parent_channels = await db.channels.find(
            {"server_id": server_id, "id": {"$in": list(parent_ids)}},
            {"_id": 0},
        ).to_list(len(parent_ids))
        parent_map = {channel["id"]: channel for channel in parent_channels}
        for parent_id in parent_ids:
            parent = parent_map.get(parent_id)
            if not parent or parent.get("type") != "category":
                raise HTTPException(400, "Parent must be a category in the same server")

    updated_channels = []
    for item in inp.items:
        channel = existing_map[item.id]
        next_parent = None if channel.get("type") == "category" else item.parent_id
        await db.channels.update_one(
            {"id": item.id, "server_id": server_id},
            {"$set": {"parent_id": next_parent, "position": item.position}},
        )
        updated = await db.channels.find_one({"id": item.id, "server_id": server_id}, {"_id": 0})
        if not updated:
            continue
        if updated["type"] == "voice":
            updated["voice_states"] = await db.voice_states.find(
                {"channel_id": updated["id"]},
                {"_id": 0},
            ).to_list(50)
        updated_channels.append(updated)
        await ws_mgr.broadcast_server(server_id, {"type": "channel_updated", "channel": updated})

    await log_audit(
        server_id,
        user["id"],
        "channel_reorder",
        "server",
        server_id,
        {"channel_ids": channel_ids},
    )
    return {"ok": True, "channels": updated_channels}
