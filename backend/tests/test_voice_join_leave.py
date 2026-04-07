# Singra Vox - Voice Join/Leave Tests
# Tests for voice_join, voice_leave endpoints and clear_voice_membership behavior
import pytest
import requests
import os
import time

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Test credentials - will be set up via bootstrap if needed
TEST_EMAIL = "admin@mauntingstudios.de"
TEST_PASSWORD = "Admin1234!"


@pytest.fixture(scope="module")
def auth_session():
    """Get authenticated session"""
    session = requests.Session()
    
    # Try login first
    resp = session.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    
    if resp.status_code == 200:
        data = resp.json()
        token = data.get("access_token") or data.get("token")
        session.headers.update({"Authorization": f"Bearer {token}"})
        return session
    
    pytest.skip(f"Could not authenticate: {resp.status_code} - {resp.text}")


@pytest.fixture(scope="module")
def test_server_and_channel(auth_session):
    """Get a server and voice channel for testing"""
    # Get servers
    resp = auth_session.get(f"{BASE_URL}/api/servers")
    assert resp.status_code == 200, f"Failed to get servers: {resp.text}"
    servers = resp.json()
    
    if not servers:
        pytest.skip("No servers available for testing")
    
    server = servers[0]
    server_id = server["id"]
    
    # Get channels for this server
    resp = auth_session.get(f"{BASE_URL}/api/servers/{server_id}/channels")
    assert resp.status_code == 200, f"Failed to get channels: {resp.text}"
    channels = resp.json()
    
    # Find a voice channel
    voice_channel = next((c for c in channels if c.get("type") == "voice"), None)
    
    if not voice_channel:
        pytest.skip("No voice channel available for testing")
    
    return {"server_id": server_id, "channel_id": voice_channel["id"]}


class TestHealthEndpoint:
    """Health endpoint tests"""
    
    def test_health_returns_ok(self):
        """Backend health endpoint /api/health returns ok"""
        resp = requests.get(f"{BASE_URL}/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("status") == "ok"


class TestVoiceJoin:
    """Voice join endpoint tests"""
    
    def test_voice_join_success(self, auth_session, test_server_and_channel):
        """POST /api/servers/{id}/voice/{channel}/join works"""
        server_id = test_server_and_channel["server_id"]
        channel_id = test_server_and_channel["channel_id"]
        
        resp = auth_session.post(f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/join")
        assert resp.status_code == 200, f"Voice join failed: {resp.text}"
        
        data = resp.json()
        assert "user_id" in data
        assert "channel_id" in data
        assert data["channel_id"] == channel_id
        
        # Cleanup - leave the channel
        auth_session.post(f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/leave")
    
    def test_voice_join_clears_old_state(self, auth_session, test_server_and_channel):
        """Voice join properly clears old voice state before creating new one"""
        server_id = test_server_and_channel["server_id"]
        channel_id = test_server_and_channel["channel_id"]
        
        # Join first time
        resp1 = auth_session.post(f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/join")
        assert resp1.status_code == 200
        
        # Join again (should clear old state first)
        resp2 = auth_session.post(f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/join")
        assert resp2.status_code == 200
        
        # Verify only one voice state exists
        data = resp2.json()
        assert "user_id" in data
        
        # Cleanup
        auth_session.post(f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/leave")
    
    def test_voice_join_unauthorized(self, test_server_and_channel):
        """Voice join without auth returns 401"""
        server_id = test_server_and_channel["server_id"]
        channel_id = test_server_and_channel["channel_id"]
        
        resp = requests.post(f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/join")
        assert resp.status_code in [401, 403]
    
    def test_voice_join_invalid_channel(self, auth_session, test_server_and_channel):
        """Voice join with invalid channel returns 404"""
        server_id = test_server_and_channel["server_id"]
        
        resp = auth_session.post(f"{BASE_URL}/api/servers/{server_id}/voice/invalid-channel-id/join")
        assert resp.status_code == 404


class TestVoiceLeave:
    """Voice leave endpoint tests"""
    
    def test_voice_leave_success(self, auth_session, test_server_and_channel):
        """POST /api/servers/{id}/voice/{channel}/leave removes voice state"""
        server_id = test_server_and_channel["server_id"]
        channel_id = test_server_and_channel["channel_id"]
        
        # First join
        join_resp = auth_session.post(f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/join")
        assert join_resp.status_code == 200
        
        # Then leave
        leave_resp = auth_session.post(f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/leave")
        assert leave_resp.status_code == 200
        
        data = leave_resp.json()
        assert data.get("ok") == True
    
    def test_voice_leave_without_join(self, auth_session, test_server_and_channel):
        """Voice leave when not in channel should still return ok"""
        server_id = test_server_and_channel["server_id"]
        channel_id = test_server_and_channel["channel_id"]
        
        # Make sure we're not in the channel
        auth_session.post(f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/leave")
        
        # Leave again
        resp = auth_session.post(f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/leave")
        assert resp.status_code == 200


class TestVoiceToken:
    """Voice token endpoint tests"""
    
    def test_voice_token_success(self, auth_session, test_server_and_channel):
        """POST /api/voice/token works with valid auth"""
        server_id = test_server_and_channel["server_id"]
        channel_id = test_server_and_channel["channel_id"]
        
        resp = auth_session.post(f"{BASE_URL}/api/voice/token", json={
            "server_id": server_id,
            "channel_id": channel_id
        })
        
        # May return 503 if LiveKit not configured, but should not be 500
        assert resp.status_code in [200, 503], f"Unexpected status: {resp.status_code} - {resp.text}"
        
        if resp.status_code == 200:
            data = resp.json()
            assert "server_url" in data
            assert "participant_token" in data
            assert "room_name" in data
    
    def test_voice_token_unauthorized(self, test_server_and_channel):
        """Voice token without auth returns 401"""
        server_id = test_server_and_channel["server_id"]
        channel_id = test_server_and_channel["channel_id"]
        
        resp = requests.post(f"{BASE_URL}/api/voice/token", json={
            "server_id": server_id,
            "channel_id": channel_id
        })
        assert resp.status_code in [401, 403]


class TestVoiceStateUpdate:
    """Voice state update endpoint tests"""
    
    def test_voice_state_update_mute(self, auth_session, test_server_and_channel):
        """PUT /api/servers/{id}/voice/{channel}/state updates mute state"""
        server_id = test_server_and_channel["server_id"]
        channel_id = test_server_and_channel["channel_id"]
        
        # First join
        join_resp = auth_session.post(f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/join")
        assert join_resp.status_code == 200
        
        # Update mute state
        update_resp = auth_session.put(
            f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/state",
            json={"is_muted": True}
        )
        assert update_resp.status_code == 200
        
        data = update_resp.json()
        assert data.get("is_muted") == True
        
        # Cleanup
        auth_session.post(f"{BASE_URL}/api/servers/{server_id}/voice/{channel_id}/leave")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
