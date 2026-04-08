from __future__ import annotations

import json

from livekit import api as livekit_api

from app.core.config import livekit_api_key, livekit_api_secret, livekit_public_url
from app.voice_access import build_voice_capabilities


SCREEN_SHARE_PROXY_ROLE = "screen_share_proxy"
SCREEN_SHARE_PROXY_IDENTITY_PREFIX = "screen-share"


def build_voice_room_name(server_id: str, channel_id: str) -> str:
    return f"server-{server_id}-channel-{channel_id}"


def build_voice_participant_name(user: dict) -> str:
    return user.get("display_name") or user.get("username") or user["id"]


def build_screen_share_proxy_identity(user_id: str, channel_id: str) -> str:
    # One stable proxy identity per user and voice channel keeps duplicate
    # screen-share publishers from lingering after a reconnect.
    return f"{SCREEN_SHARE_PROXY_IDENTITY_PREFIX}:{channel_id}:{user_id}"


def build_screen_share_proxy_attributes(user_id: str) -> dict[str, str]:
    return {
        "owner_user_id": user_id,
        "participant_role": SCREEN_SHARE_PROXY_ROLE,
    }


def build_livekit_join_response(
    *,
    room_name: str,
    participant_token: str,
    channel: dict,
    participant_identity: str,
    participant_attributes: dict[str, str] | None = None,
) -> dict:
    is_private = bool(channel.get("is_private"))
    return {
        "server_url": livekit_public_url,
        "participant_token": participant_token,
        "room_name": room_name,
        "participant_identity": participant_identity,
        "participant_attributes": participant_attributes or {},
        "e2ee_required": is_private,
        "media_key_endpoint": (
            f"/api/e2ee/media/channels/{channel['id']}/current" if is_private else None
        ),
        "media_rotate_endpoint": (
            f"/api/e2ee/media/channels/{channel['id']}/rotate" if is_private else None
        ),
    }


def create_voice_participant_token(
    *,
    room_name: str,
    participant_identity: str,
    participant_name: str,
    can_join: bool,
    can_speak: bool,
    can_stream: bool,
    participant_attributes: dict[str, str] | None = None,
    participant_metadata: dict | None = None,
    api_key: str | None = None,
    api_secret: str | None = None,
) -> str:
    access_token = (
        livekit_api.AccessToken(api_key or livekit_api_key, api_secret or livekit_api_secret)
        .with_identity(participant_identity)
        .with_name(participant_name)
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
    )

    if participant_attributes:
        access_token = access_token.with_attributes(participant_attributes)

    if participant_metadata:
        access_token = access_token.with_metadata(json.dumps(participant_metadata))

    return access_token.to_jwt()
