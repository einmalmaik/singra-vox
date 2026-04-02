from backend.app.voice_access import build_publish_sources, build_voice_capabilities


def test_publish_sources_allow_microphone_only_for_speak():
    assert build_publish_sources(can_speak=True, can_stream=False) == ["microphone"]


def test_publish_sources_allow_camera_and_screen_share_for_stream():
    assert build_publish_sources(can_speak=False, can_stream=True) == [
        "camera",
        "screen_share",
        "screen_share_audio",
    ]


def test_voice_capabilities_disable_publish_without_speak_or_stream():
    capabilities = build_voice_capabilities(can_join=True, can_speak=False, can_stream=False)
    assert capabilities["room_join"] is True
    assert capabilities["can_subscribe"] is True
    assert capabilities["can_publish"] is False
    assert capabilities["can_publish_data"] is False
    assert capabilities["can_publish_sources"] is None
