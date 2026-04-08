from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from livekit import api as livekit_api

from app.core.config import livekit_api_key, livekit_api_secret, livekit_public_url, livekit_url
from app.core.database import db
from app.dependencies import current_user
from app.schemas import VoiceTokenInput
from app.services.e2ee import ensure_private_channel_member_access
from app.services.server_ops import check_permission
from app.voice_access import build_voice_capabilities


router = APIRouter(prefix="/api/voice", tags=["Voice"])


@router.post("/token")
async def create_voice_token(request: Request, inp: VoiceTokenInput):
    user = await current_user(request)
    channel = await db.channels.find_one(
        {"id": inp.channel_id, "server_id": inp.server_id, "type": "voice"},
        {"_id": 0},
    )
    if not channel:
        raise HTTPException(404, "Voice channel not found")

    can_join = await check_permission(user["id"], inp.server_id, "join_voice", channel=channel)
    can_speak = await check_permission(user["id"], inp.server_id, "speak", channel=channel)
    can_stream = await check_permission(user["id"], inp.server_id, "stream", channel=channel)
    if not can_join:
        raise HTTPException(403, "No permission")
    await ensure_private_channel_member_access(user["id"], channel)
    if not livekit_url or not livekit_api_key or not livekit_api_secret:
        raise HTTPException(503, "Voice service is not configured")

    room_name = f"server-{inp.server_id}-channel-{inp.channel_id}"
    access_token = (
        livekit_api.AccessToken(livekit_api_key, livekit_api_secret)
        .with_identity(user["id"])
        .with_name(user.get("display_name") or user.get("username") or user["id"])
        .with_grants(
            livekit_api.VideoGrants(
                room=room_name,
                **build_voice_capabilities(
                    can_join=can_join,
                    can_speak=can_speak,
                    can_stream=can_stream,
                ),
            )
        )
        .to_jwt()
    )
    return {
        "server_url": livekit_public_url,
        "participant_token": access_token,
        "room_name": room_name,
        "e2ee_required": bool(channel.get("is_private")),
        "media_key_endpoint": f"/api/e2ee/media/channels/{inp.channel_id}/current" if channel.get("is_private") else None,
        "media_rotate_endpoint": f"/api/e2ee/media/channels/{inp.channel_id}/rotate" if channel.get("is_private") else None,
    }
