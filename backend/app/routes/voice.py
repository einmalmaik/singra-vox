from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Request

from app.core.config import livekit_api_key, livekit_api_secret, livekit_url
from app.core.database import db
from app.dependencies import current_user
from app.schemas import NativeScreenShareTokenInput, VoiceTokenInput
from app.services.e2ee import ensure_private_channel_member_access
from app.services.livekit_tokens import (
    build_livekit_join_response,
    build_screen_share_proxy_attributes,
    build_screen_share_proxy_identity,
    build_voice_participant_name,
    build_voice_room_name,
    create_voice_participant_token,
)
from app.services.server_ops import check_permission


router = APIRouter(prefix="/api/voice", tags=["Voice"])
logger = logging.getLogger(__name__)


async def _resolve_voice_channel_context(request: Request, server_id: str, channel_id: str):
    user = await current_user(request)
    platform = request.headers.get("X-Singra-Client-Platform", "unknown")
    channel = await db.channels.find_one(
        {"id": channel_id, "server_id": server_id, "type": "voice"},
        {"_id": 0},
    )
    if not channel:
        raise HTTPException(404, "Voice channel not found")

    can_join = await check_permission(user["id"], server_id, "join_voice", channel=channel)
    can_speak = await check_permission(user["id"], server_id, "speak", channel=channel)
    can_stream = await check_permission(user["id"], server_id, "stream", channel=channel)
    if not can_join:
        raise HTTPException(403, "No permission")

    await ensure_private_channel_member_access(user["id"], channel)

    if not livekit_url or not livekit_api_key or not livekit_api_secret:
        raise HTTPException(503, "Voice service is not configured")

    return {
        "user": user,
        "channel": channel,
        "can_join": can_join,
        "can_speak": can_speak,
        "can_stream": can_stream,
        "room_name": build_voice_room_name(server_id, channel_id),
        "platform": platform,
    }


@router.post("/token")
async def create_voice_token(request: Request, inp: VoiceTokenInput):
    context = await _resolve_voice_channel_context(request, inp.server_id, inp.channel_id)

    participant_identity = context["user"]["id"]
    participant_token = create_voice_participant_token(
        room_name=context["room_name"],
        participant_identity=participant_identity,
        participant_name=build_voice_participant_name(context["user"]),
        can_join=context["can_join"],
        can_speak=context["can_speak"],
        can_stream=context["can_stream"],
    )

    response = build_livekit_join_response(
        room_name=context["room_name"],
        participant_token=participant_token,
        channel=context["channel"],
        participant_identity=participant_identity,
    )
    logger.info(
        "voice token issued server_id=%s channel_id=%s user_id=%s participant_identity=%s room_name=%s platform=%s event=voice_token result=ok",
        inp.server_id,
        inp.channel_id,
        context["user"]["id"],
        participant_identity,
        context["room_name"],
        context["platform"],
    )
    return response


@router.post("/native-screen-share-token")
async def create_native_screen_share_token(request: Request, inp: NativeScreenShareTokenInput):
    context = await _resolve_voice_channel_context(request, inp.server_id, inp.channel_id)
    if not context["can_stream"]:
        raise HTTPException(403, "No permission")

    participant_identity = build_screen_share_proxy_identity(
        context["user"]["id"],
        inp.channel_id,
    )
    participant_attributes = build_screen_share_proxy_attributes(context["user"]["id"])
    participant_token = create_voice_participant_token(
        room_name=context["room_name"],
        participant_identity=participant_identity,
        participant_name=f"{build_voice_participant_name(context['user'])} Screen Share",
        can_join=context["can_join"],
        can_speak=False,
        can_stream=True,
        participant_attributes=participant_attributes,
        participant_metadata={
            "owner_user_id": context["user"]["id"],
            "participant_role": participant_attributes["participant_role"],
        },
    )

    response = build_livekit_join_response(
        room_name=context["room_name"],
        participant_token=participant_token,
        channel=context["channel"],
        participant_identity=participant_identity,
        participant_attributes=participant_attributes,
    )
    logger.info(
        "native screen share token issued server_id=%s channel_id=%s user_id=%s participant_identity=%s room_name=%s platform=%s event=native_screen_share_token result=ok",
        inp.server_id,
        inp.channel_id,
        context["user"]["id"],
        participant_identity,
        context["room_name"],
        context["platform"],
    )
    return response
