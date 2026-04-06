# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
import pytest

from backend.app.ws import WSManager


class FakeWebSocket:
    def __init__(self):
        self.accepted = False
        self.closed = False
        self.close_code = None
        self.sent_payloads = []

    async def accept(self):
        self.accepted = True

    async def send_json(self, payload):
        self.sent_payloads.append(payload)

    async def close(self, code=1000):
        self.closed = True
        self.close_code = code


@pytest.mark.asyncio
async def test_close_session_only_closes_matching_session():
    manager = WSManager()
    ws_a = FakeWebSocket()
    ws_b = FakeWebSocket()

    connection_a = await manager.connect(ws_a, "user-1", "desktop", "session-a")
    connection_b = await manager.connect(ws_b, "user-1", "desktop", "session-b")

    await manager.close_session("session-a", {"type": "session_revoked"}, code=4001)

    assert ws_a.closed is True
    assert ws_a.close_code == 4001
    assert ws_a.sent_payloads == [{"type": "session_revoked"}]
    assert ws_b.closed is False
    assert connection_a not in (manager.conns.get("user-1") or {})
    assert connection_b in (manager.conns.get("user-1") or {})


@pytest.mark.asyncio
async def test_close_user_sessions_honors_exclusion():
    manager = WSManager()
    ws_keep = FakeWebSocket()
    ws_close = FakeWebSocket()

    connection_keep = await manager.connect(ws_keep, "user-1", "desktop", "session-keep")
    connection_close = await manager.connect(ws_close, "user-1", "web", "session-close")

    await manager.close_user_sessions(
        "user-1",
        {"type": "session_revoked"},
        exclude_session_id="session-keep",
        code=4002,
    )

    assert ws_keep.closed is False
    assert ws_close.closed is True
    assert ws_close.close_code == 4002
    assert connection_keep in (manager.conns.get("user-1") or {})
    assert connection_close not in (manager.conns.get("user-1") or {})
