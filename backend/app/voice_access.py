from __future__ import annotations


VOICE_SOURCE_MICROPHONE = "microphone"
VOICE_SOURCE_CAMERA = "camera"
VOICE_SOURCE_SCREEN_SHARE = "screen_share"
VOICE_SOURCE_SCREEN_SHARE_AUDIO = "screen_share_audio"


def build_publish_sources(*, can_speak: bool, can_stream: bool) -> list[str]:
    sources: list[str] = []
    if can_speak:
        sources.append(VOICE_SOURCE_MICROPHONE)
    if can_stream:
        sources.extend(
            [
                VOICE_SOURCE_CAMERA,
                VOICE_SOURCE_SCREEN_SHARE,
                VOICE_SOURCE_SCREEN_SHARE_AUDIO,
            ]
        )
    return sources


def build_voice_capabilities(*, can_join: bool, can_speak: bool, can_stream: bool) -> dict:
    publish_sources = build_publish_sources(can_speak=can_speak, can_stream=can_stream)
    return {
        "room_join": bool(can_join),
        "can_subscribe": bool(can_join),
        "can_publish": bool(publish_sources),
        "can_publish_data": False,
        "can_publish_sources": publish_sources or None,
    }
