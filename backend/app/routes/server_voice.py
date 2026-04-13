from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from app.core.database import db
from app.core.utils import now_utc, sanitize_user
from app.dependencies import current_user
from app.permissions import assert_channel_permission
from app.services.e2ee import ensure_private_channel_member_access
from app.services.server_ops import clear_voice_membership
from app.ws import ws_mgr


router = APIRouter(prefix="/api/servers", tags=["Servers"])
logger = logging.getLogger(__name__)


@router.post("/{server_id}/voice/{channel_id}/join")
async def voice_join(server_id: str, channel_id: str, request: Request):
    user = await current_user(request)
    platform = request.headers.get("X-Singra-Client-Platform", "unknown")
    channel = await db.channels.find_one(
        {"id": channel_id, "server_id": server_id, "type": "voice"},
        {"_id": 0},
    )
    if not channel:
        raise HTTPException(404, "Voice channel not found")
    await assert_channel_permission(db, user["id"], channel, "join_voice", "No permission")
    await ensure_private_channel_member_access(user["id"], channel)
    await clear_voice_membership(user["id"])

    state = {
        "user_id": user["id"],
        "channel_id": channel_id,
        "server_id": server_id,
        "is_muted": False,
        "is_deafened": False,
        "joined_at": now_utc(),
    }
    await db.voice_states.insert_one(state)
    state.pop("_id", None)
    voice_user = await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})
    state["user"] = sanitize_user(voice_user) if voice_user else sanitize_user(user)
    await ws_mgr.broadcast_server(server_id, {"type": "voice_join", "channel_id": channel_id, "state": state})
    logger.info(
        "voice join server_id=%s channel_id=%s user_id=%s platform=%s event=voice_join result=ok",
        server_id,
        channel_id,
        user["id"],
        platform,
    )
    return state


@router.post("/{server_id}/voice/{channel_id}/leave")
async def voice_leave(server_id: str, channel_id: str, request: Request):
    user = await current_user(request)
    platform = request.headers.get("X-Singra-Client-Platform", "unknown")
    await clear_voice_membership(user["id"], server_id=server_id, channel_id=channel_id)
    logger.info(
        "voice leave server_id=%s channel_id=%s user_id=%s platform=%s event=voice_leave result=ok",
        server_id,
        channel_id,
        user["id"],
        platform,
    )
    return {"ok": True}


@router.put("/{server_id}/voice/{channel_id}/state")
async def voice_update_state(server_id: str, channel_id: str, request: Request):
    user = await current_user(request)
    platform = request.headers.get("X-Singra-Client-Platform", "unknown")
    body = await request.json()
    updates = {key: value for key, value in body.items() if key in {"is_muted", "is_deafened"}}
    if updates:
        await db.voice_states.update_one(
            {"user_id": user["id"], "channel_id": channel_id},
            {"$set": updates},
        )
    state = await db.voice_states.find_one({"user_id": user["id"], "channel_id": channel_id}, {"_id": 0})
    if state:
        await ws_mgr.broadcast_server(
            server_id,
            {
                "type": "voice_state_update",
                "channel_id": channel_id,
                "user_id": user["id"],
                "state": state,
            },
        )
    logger.info(
        "voice state update server_id=%s channel_id=%s user_id=%s platform=%s muted=%s deafened=%s event=voice_state_update result=ok",
        server_id,
        channel_id,
        user["id"],
        platform,
        updates.get("is_muted"),
        updates.get("is_deafened"),
    )
    return state or {"ok": True}
