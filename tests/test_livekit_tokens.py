from pathlib import Path
import sys


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from livekit import api as livekit_api

from app.services.livekit_tokens import (
    SCREEN_SHARE_PROXY_ROLE,
    build_livekit_join_response,
    build_screen_share_proxy_attributes,
    build_screen_share_proxy_identity,
    build_voice_room_name,
    create_voice_participant_token,
)


def test_screen_share_proxy_identity_is_stable_per_user_and_channel():
    first = build_screen_share_proxy_identity("user-123", "channel-abc")
    second = build_screen_share_proxy_identity("user-123", "channel-abc")
    other_channel = build_screen_share_proxy_identity("user-123", "channel-def")

    assert first == second
    assert first != other_channel
    assert first.startswith("screen-share:channel-abc:")


def test_screen_share_proxy_attributes_expose_owner_mapping():
    attributes = build_screen_share_proxy_attributes("user-123")

    assert attributes == {
        "owner_user_id": "user-123",
        "participant_role": SCREEN_SHARE_PROXY_ROLE,
    }


def test_livekit_token_embeds_proxy_attributes_and_publish_scope():
    token = create_voice_participant_token(
        room_name=build_voice_room_name("server-1", "channel-1"),
        participant_identity="screen-share:channel-1:user-123",
        participant_name="User Screen Share",
        can_join=True,
        can_speak=False,
        can_stream=True,
        participant_attributes=build_screen_share_proxy_attributes("user-123"),
        api_key="test-api-key-12345678901234567890",
        api_secret="test-api-secret-1234567890123456",
    )

    claims = livekit_api.TokenVerifier("test-api-key", "test-api-secret").verify(
        token,
        verify_signature=False,
    )

    assert claims.identity == "screen-share:channel-1:user-123"
    assert claims.attributes["owner_user_id"] == "user-123"
    assert claims.attributes["participant_role"] == SCREEN_SHARE_PROXY_ROLE
    assert claims.video.room == "server-server-1-channel-channel-1"
    assert claims.video.can_publish is True
    assert claims.video.can_publish_sources == ["camera", "screen_share", "screen_share_audio"]


def test_livekit_join_response_keeps_e2ee_contract_fields_for_private_channels():
    payload = build_livekit_join_response(
        room_name="room-1",
        participant_token="jwt-token",
        participant_identity="participant-1",
        participant_attributes={"owner_user_id": "user-1"},
        channel={"id": "channel-1", "is_private": True},
    )

    assert payload["room_name"] == "room-1"
    assert payload["participant_token"] == "jwt-token"
    assert payload["participant_identity"] == "participant-1"
    assert payload["participant_attributes"] == {"owner_user_id": "user-1"}
    assert payload["e2ee_required"] is True
    assert payload["media_key_endpoint"] == "/api/e2ee/media/channels/channel-1/current"
    assert payload["media_rotate_endpoint"] == "/api/e2ee/media/channels/channel-1/rotate"
