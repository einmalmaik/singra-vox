# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox - Iteration 9 Backend Tests
Tests for refactored routes: files, pins, notifications, search, unread, e2ee, setup
"""
import pytest
import requests
import os

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

ADMIN_EMAIL = "admin@singravox.local"
ADMIN_PASSWORD = "Admin1234!"


@pytest.fixture(scope="module")
def token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
    })
    if resp.status_code == 429:
        pytest.skip("Rate limited - try again later")
    assert resp.status_code == 200, f"Login failed: {resp.status_code} {resp.text}"
    data = resp.json()
    return data.get("access_token") or data.get("token") or resp.cookies.get("session")


@pytest.fixture(scope="module")
def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def session(token):
    s = requests.Session()
    s.cookies.set("access_token", token)
    return s


@pytest.fixture(scope="module")
def server_id(session):
    resp = session.get(f"{BASE_URL}/api/servers")
    assert resp.status_code == 200
    servers = resp.json()
    assert len(servers) >= 1
    return servers[0]["id"]


@pytest.fixture(scope="module")
def channel_id(session, server_id):
    resp = session.get(f"{BASE_URL}/api/servers/{server_id}/channels")
    assert resp.status_code == 200
    channels = resp.json()
    text_channels = [c for c in channels if c.get("type") == "text"]
    assert len(text_channels) >= 1
    return text_channels[0]["id"]


@pytest.fixture(scope="module")
def message_id(session, channel_id):
    resp = session.get(f"{BASE_URL}/api/channels/{channel_id}/messages?limit=5")
    if resp.status_code == 200:
        data = resp.json()
        msgs = data if isinstance(data, list) else data.get("messages", [])
        if msgs:
            return msgs[0]["id"]
    return None


# ── Setup status ──────────────────────────────────────────────────────────────

class TestSetup:
    def test_setup_status_initialized(self):
        resp = requests.get(f"{BASE_URL}/api/setup/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("initialized") is True, f"Expected initialized:true, got {data}"

    def test_auth_login_success(self):
        resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL, "password": ADMIN_PASSWORD
        })
        if resp.status_code == 429:
            pytest.skip("Rate limited")
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data or "token" in data or resp.cookies.get("session")


# ── Servers (13+) ─────────────────────────────────────────────────────────────

class TestServers:
    def test_servers_13_plus(self, session):
        resp = session.get(f"{BASE_URL}/api/servers")
        assert resp.status_code == 200
        servers = resp.json()
        assert len(servers) >= 13, f"Expected 13+ servers, got {len(servers)}"

    def test_e2ee_state(self, session):
        resp = session.get(f"{BASE_URL}/api/e2ee/state")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("enabled") is True, f"Expected enabled:true, got {data}"


# ── File upload / retrieval ───────────────────────────────────────────────────

class TestFiles:
    @pytest.fixture(scope="class")
    def uploaded_file_id(self, session):
        png_1x1 = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAD"
            "hgGAWjR9awAAAABJRU5ErkJggg=="
        )
        resp = session.post(f"{BASE_URL}/api/upload", json={
            "data": png_1x1,
            "name": "test_pixel.png",
            "type": "image/png",
        })
        assert resp.status_code == 200, f"Upload failed: {resp.status_code} {resp.text}"
        data = resp.json()
        assert "id" in data
        assert "url" in data
        assert "content_type" in data
        return data["id"]

    def test_upload_returns_id_url_content_type(self, session):
        png_1x1 = (
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwAD"
            "hgGAWjR9awAAAABJRU5ErkJggg=="
        )
        resp = session.post(f"{BASE_URL}/api/upload", json={
            "data": png_1x1,
            "name": "pixel2.png",
            "type": "image/png",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert "url" in data
        assert data["url"].startswith("/api/files/")
        assert "content_type" in data
        assert data["content_type"] == "image/png"

    def test_get_file(self, session, uploaded_file_id):
        resp = session.get(f"{BASE_URL}/api/files/{uploaded_file_id}")
        assert resp.status_code == 200

    def test_get_nonexistent_file_404(self, session):
        resp = session.get(f"{BASE_URL}/api/files/nonexistent_id_xyz")
        assert resp.status_code == 404

    def test_upload_requires_auth(self):
        resp = requests.post(f"{BASE_URL}/api/upload", json={
            "data": "dGVzdA==", "name": "t.txt", "type": "text/plain"
        })
        assert resp.status_code == 401


# ── Search ────────────────────────────────────────────────────────────────────

class TestSearch:
    def test_search_returns_list(self, session, server_id):
        resp = session.get(f"{BASE_URL}/api/search?q=test&server_id={server_id}")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_search_short_query_returns_empty(self, session, server_id):
        resp = session.get(f"{BASE_URL}/api/search?q=a&server_id={server_id}")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_search_requires_auth(self, server_id):
        resp = requests.get(f"{BASE_URL}/api/search?q=test&server_id={server_id}")
        assert resp.status_code == 401


# ── Unread ────────────────────────────────────────────────────────────────────

class TestUnread:
    def test_unread_returns_structure(self, session):
        resp = session.get(f"{BASE_URL}/api/unread")
        assert resp.status_code == 200
        data = resp.json()
        assert "channels" in data
        assert "servers" in data
        assert "dm_total" in data

    def test_unread_requires_auth(self):
        resp = requests.get(f"{BASE_URL}/api/unread")
        assert resp.status_code == 401


# ── Pins ──────────────────────────────────────────────────────────────────────

class TestPins:
    def test_get_channel_pins(self, session, channel_id):
        resp = session.get(f"{BASE_URL}/api/channels/{channel_id}/pins")
        assert resp.status_code in [200, 403, 404]
        if resp.status_code == 200:
            assert isinstance(resp.json(), list)

    def test_pin_nonexistent_message(self, session):
        resp = session.post(f"{BASE_URL}/api/messages/nonexistent_xyz/pin")
        assert resp.status_code == 404

    def test_pin_message_if_available(self, session, message_id):
        if not message_id:
            pytest.skip("No messages available")
        resp = session.post(f"{BASE_URL}/api/messages/{message_id}/pin")
        assert resp.status_code in [200, 403]
        if resp.status_code == 200:
            assert resp.json().get("ok") is True


# ── Notifications ─────────────────────────────────────────────────────────────

class TestNotifications:
    def test_get_notifications(self, session):
        resp = session.get(f"{BASE_URL}/api/notifications")
        assert resp.status_code == 200
        data = resp.json()
        assert "notifications" in data
        assert "unread_count" in data
        assert isinstance(data["notifications"], list)

    def test_notifications_requires_auth(self):
        resp = requests.get(f"{BASE_URL}/api/notifications")
        assert resp.status_code == 401

    def test_mark_all_read(self, session):
        resp = session.post(f"{BASE_URL}/api/notifications/read-all")
        assert resp.status_code == 200
        assert resp.json().get("ok") is True


# ── Threads & Overrides ───────────────────────────────────────────────────────

class TestThreadsAndOverrides:
    def test_thread_nonexistent_message(self, session):
        resp = session.get(f"{BASE_URL}/api/messages/nonexistent_xyz/thread")
        assert resp.status_code in [200, 204, 404]

    def test_thread_for_real_message(self, session, message_id):
        if not message_id:
            pytest.skip("No messages available")
        resp = session.get(f"{BASE_URL}/api/messages/{message_id}/thread")
        assert resp.status_code in [200, 204, 404]

    def test_channel_overrides(self, session, channel_id):
        resp = session.get(f"{BASE_URL}/api/channels/{channel_id}/overrides")
        assert resp.status_code in [200, 403, 404]
        if resp.status_code == 200:
            assert isinstance(resp.json(), list)
