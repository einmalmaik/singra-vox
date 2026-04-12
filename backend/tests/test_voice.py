# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""Voice feature tests: voice token API, E2EE state, server list"""
import pytest
import requests
import os

from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "singravox")
ADMIN_EMAIL = "admin@singravox.local"
ADMIN_PASSWORD = "Admin1234!"
SERVER_ID = "03778528-7e75-4ddc-83df-f06260323967"
CHANNEL_ID = "d0f0765a-35e1-4d3e-9acb-9f1ec22c0213"


def clear_rate_limits():
    client = MongoClient(MONGO_URL)
    try:
        client[DB_NAME].rate_limits.delete_many({})
    finally:
        client.close()


@pytest.fixture(scope="module")
def auth_headers():
    clear_rate_limits()
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    token = resp.json().get("access_token") or resp.json().get("token")
    return {"Authorization": f"Bearer {token}"}


class TestVoiceToken:
    """Voice token endpoint tests"""

    def test_voice_token_returns_200(self, auth_headers):
        resp = requests.post(
            f"{BASE_URL}/api/voice/token",
            json={"channel_id": CHANNEL_ID, "server_id": SERVER_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    def test_voice_token_has_server_url(self, auth_headers):
        resp = requests.post(
            f"{BASE_URL}/api/voice/token",
            json={"channel_id": CHANNEL_ID, "server_id": SERVER_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "server_url" in data, "Missing server_url in response"
        assert data["server_url"], "server_url is empty"

    def test_voice_token_has_participant_token(self, auth_headers):
        resp = requests.post(
            f"{BASE_URL}/api/voice/token",
            json={"channel_id": CHANNEL_ID, "server_id": SERVER_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "participant_token" in data, "Missing participant_token in response"
        assert isinstance(data["participant_token"], str) and len(data["participant_token"]) > 20

    def test_voice_token_unauthorized(self):
        resp = requests.post(
            f"{BASE_URL}/api/voice/token",
            json={"channel_id": CHANNEL_ID, "server_id": SERVER_ID},
        )
        assert resp.status_code in [401, 403]

    def test_voice_token_invalid_channel(self, auth_headers):
        resp = requests.post(
            f"{BASE_URL}/api/voice/token",
            json={"channel_id": "nonexistent-id", "server_id": SERVER_ID},
            headers=auth_headers,
        )
        assert resp.status_code == 404


class TestE2EEState:
    """E2EE state endpoint"""

    def test_e2ee_state_enabled(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/e2ee/state", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("enabled") is True, f"E2EE not enabled: {data}"


class TestServerList:
    """Server list has 13+ servers"""

    def test_server_list_count(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/servers", headers=auth_headers)
        assert resp.status_code == 200
        servers = resp.json()
        assert len(servers) >= 13, f"Expected 13+ servers, got {len(servers)}"
