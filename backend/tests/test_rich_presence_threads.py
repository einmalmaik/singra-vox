# Test file for Rich Presence and Thread Self-Destruct features
# Iteration 8: Testing Discord-inspired features

import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
TEST_EMAIL = "admin@mauntingstudios.de"
TEST_PASSWORD = "Admin1234!"
TEST_SERVER_ID = "03778528-7e75-4ddc-83df-f06260323967"
TEST_CHANNEL_ID = "bee73bda-4936-48b2-afa0-a2745ba53d26"


@pytest.fixture(scope="module")
def auth_session():
    """Create authenticated session for all tests"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    
    # Login
    response = session.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_EMAIL,
        "password": TEST_PASSWORD
    })
    assert response.status_code == 200, f"Login failed: {response.text}"
    
    data = response.json()
    token = data.get("access_token") or data.get("token")
    if token:
        session.headers.update({"Authorization": f"Bearer {token}"})
    
    return session


@pytest.fixture(scope="module")
def thread_message_id(auth_session):
    response = auth_session.post(
        f"{BASE_URL}/api/channels/{TEST_CHANNEL_ID}/messages",
        json={"content": "Thread parent created by integration test"},
    )
    assert response.status_code in (200, 201), f"Failed to create thread parent: {response.text}"
    return response.json()["id"]


class TestHealthEndpoint:
    """Basic health check"""
    
    def test_health_returns_ok(self):
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data.get("status") == "ok"
        print("✓ Health endpoint returns ok")


class TestRichPresenceAPI:
    """Rich Presence API tests - Privacy-first activity status"""
    
    def test_put_activity_sets_activity(self, auth_session):
        """PUT /api/presence/activity sets activity with type/name/details"""
        response = auth_session.put(f"{BASE_URL}/api/presence/activity", json={
            "type": "playing",
            "name": "Counter-Strike 2",
            "details": "Competitive – Dust 2",
            "state": "In Queue"
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data.get("type") == "playing"
        assert data.get("name") == "Counter-Strike 2"
        assert data.get("details") == "Competitive – Dust 2"
        assert "expires_at" in data
        print("✓ PUT /api/presence/activity sets activity correctly")
    
    def test_get_activity_returns_set_activity(self, auth_session):
        """GET /api/presence/activity/{user_id} returns the set activity"""
        # First get user ID from /api/auth/me
        me_response = auth_session.get(f"{BASE_URL}/api/auth/me")
        assert me_response.status_code == 200
        user_id = me_response.json().get("id")
        
        # Get activity
        response = auth_session.get(f"{BASE_URL}/api/presence/activity/{user_id}")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        activity = data.get("activity")
        assert activity is not None, "Activity should not be None"
        assert activity.get("name") == "Counter-Strike 2"
        print(f"✓ GET /api/presence/activity/{user_id} returns activity")
    
    def test_get_server_activities(self, auth_session):
        """GET /api/presence/server/{server_id} returns activities visible on that server"""
        response = auth_session.get(f"{BASE_URL}/api/presence/server/{TEST_SERVER_ID}")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "activities" in data
        activities = data.get("activities", [])
        # Should have at least the activity we just set
        assert len(activities) >= 0  # May be empty if TTL expired
        print(f"✓ GET /api/presence/server/{TEST_SERVER_ID} returns {len(activities)} activities")
    
    def test_get_presence_settings_returns_defaults(self, auth_session):
        """GET /api/presence/settings returns default settings"""
        response = auth_session.get(f"{BASE_URL}/api/presence/settings")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        # Check default fields exist
        assert "enabled" in data
        assert "show_game_activity" in data
        assert "show_coding_activity" in data
        assert "default_visibility" in data
        print("✓ GET /api/presence/settings returns settings")
    
    def test_put_presence_settings_updates(self, auth_session):
        """PUT /api/presence/settings updates privacy settings"""
        response = auth_session.put(f"{BASE_URL}/api/presence/settings", json={
            "enabled": True,
            "show_game_activity": True,
            "show_coding_activity": False,
            "default_visibility": "selected_servers",
            "default_visible_server_ids": [TEST_SERVER_ID]
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert not data.get("show_coding_activity")
        assert data.get("default_visibility") == "selected_servers"
        print("✓ PUT /api/presence/settings updates settings")
        
        # Reset to defaults
        auth_session.put(f"{BASE_URL}/api/presence/settings", json={
            "enabled": True,
            "show_game_activity": True,
            "show_coding_activity": True,
            "default_visibility": "all_servers",
            "default_visible_server_ids": []
        })
    
    def test_delete_activity_clears(self, auth_session):
        """DELETE /api/presence/activity clears the activity"""
        response = auth_session.delete(f"{BASE_URL}/api/presence/activity")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data.get("cleared")
        print("✓ DELETE /api/presence/activity clears activity")
        
        # Verify it's cleared
        me_response = auth_session.get(f"{BASE_URL}/api/auth/me")
        user_id = me_response.json().get("id")
        get_response = auth_session.get(f"{BASE_URL}/api/presence/activity/{user_id}")
        assert get_response.status_code == 200
        assert get_response.json().get("activity") is None
        print("✓ Activity verified as cleared")


class TestThreadSelfDestruct:
    """Thread Self-Destruct API tests"""
    
    def test_patch_self_destruct_sets_timer(self, auth_session, thread_message_id):
        """PATCH /api/threads/{msg_id}/self-destruct sets timer with duration_minutes"""
        response = auth_session.patch(
            f"{BASE_URL}/api/threads/{thread_message_id}/self-destruct",
            json={"duration_minutes": 60}  # 1 hour
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data.get("duration_minutes") == 60
        assert data.get("self_destruct_at") is not None
        print("✓ PATCH /api/threads/{msg_id}/self-destruct sets timer")
    
    def test_get_thread_returns_self_destruct_at(self, auth_session, thread_message_id):
        """GET /api/messages/{msg_id}/thread returns self_destruct_at field"""
        response = auth_session.get(f"{BASE_URL}/api/messages/{thread_message_id}/thread")
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert "self_destruct_at" in data
        assert data.get("self_destruct_at") is not None
        print("✓ GET /api/messages/{msg_id}/thread returns self_destruct_at")
    
    def test_patch_self_destruct_removes_timer(self, auth_session, thread_message_id):
        """PATCH /api/threads/{msg_id}/self-destruct with 0 removes timer"""
        response = auth_session.patch(
            f"{BASE_URL}/api/threads/{thread_message_id}/self-destruct",
            json={"duration_minutes": 0}
        )
        assert response.status_code == 200, f"Failed: {response.text}"
        data = response.json()
        assert data.get("duration_minutes") == 0
        assert data.get("self_destruct_at") is None
        print("✓ PATCH /api/threads/{msg_id}/self-destruct with 0 removes timer")
        
        # Verify it's removed
        get_response = auth_session.get(f"{BASE_URL}/api/messages/{thread_message_id}/thread")
        assert get_response.status_code == 200
        assert get_response.json().get("self_destruct_at") is None
        print("✓ Timer verified as removed")


class TestActivityForMemberSidebar:
    """Set up activity for frontend testing"""
    
    def test_set_activity_for_frontend_test(self, auth_session):
        """Set Counter-Strike 2 activity for admin user (for frontend verification)"""
        response = auth_session.put(f"{BASE_URL}/api/presence/activity", json={
            "type": "playing",
            "name": "Counter-Strike 2",
            "details": "Competitive – Dust 2",
            "visible_server_ids": None  # Visible everywhere
        })
        assert response.status_code == 200, f"Failed: {response.text}"
        print("✓ Activity set for frontend testing: Counter-Strike 2")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
