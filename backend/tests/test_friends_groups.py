"""
Singra Vox – Friends & Group DM API Tests
==========================================

Tests for:
- Friends API (requires SVID account)
- Group DM API
- Relay Messages API (requires SVID account)
"""
import os
import pytest
import requests

from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "singravox")

# Test credentials
TEST_EMAIL = "admin@mauntingstudios.de"
TEST_PASSWORD = "Admin1234!"


def clear_rate_limits():
    client = MongoClient(MONGO_URL)
    try:
        client[DB_NAME].rate_limits.delete_many({})
    finally:
        client.close()


@pytest.fixture(scope="module")
def auth_token():
    """Get authentication token for testing."""
    clear_rate_limits()
    response = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
    )
    if response.status_code != 200:
        pytest.skip(f"Login failed: {response.status_code}")
    return response.json().get("access_token")


@pytest.fixture
def api_client(auth_token):
    """Authenticated requests session."""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_token}",
    })
    return session


class TestFriendsAPI:
    """Friends API tests - requires SVID account."""

    def test_get_friends_without_svid_returns_403(self, api_client):
        """GET /api/id/friends returns 403 if no SVID account linked."""
        response = api_client.get(f"{BASE_URL}/api/id/friends")
        # Expected: 403 with clear message about SVID requirement
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data
        assert "Singra-ID" in data["detail"] or "SVID" in data["detail"].upper()
        print(f"✓ GET /api/id/friends returns 403 without SVID: {data['detail']}")

    def test_get_friend_requests_without_svid_returns_403(self, api_client):
        """GET /api/id/friends/requests returns 403 if no SVID account."""
        response = api_client.get(f"{BASE_URL}/api/id/friends/requests")
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data
        print(f"✓ GET /api/id/friends/requests returns 403 without SVID")

    def test_send_friend_request_without_svid_returns_403(self, api_client):
        """POST /api/id/friends/request returns 403 if no SVID account."""
        response = api_client.post(
            f"{BASE_URL}/api/id/friends/request",
            json={"recipient_username": "testuser"},
        )
        assert response.status_code == 403
        print(f"✓ POST /api/id/friends/request returns 403 without SVID")


class TestRelayMessagesAPI:
    """Relay Messages API tests - requires SVID account and friendship."""

    def test_send_relay_message_without_svid_returns_403(self, api_client):
        """POST /api/id/relay/messages returns 403 if no SVID account."""
        response = api_client.post(
            f"{BASE_URL}/api/id/relay/messages",
            json={"to_account_id": "test123", "content": "Hello"},
        )
        assert response.status_code == 403
        data = response.json()
        assert "detail" in data
        print(f"✓ POST /api/id/relay/messages returns 403 without SVID")


class TestGroupDMAPI:
    """Group DM API tests."""

    def test_get_groups_returns_list(self, api_client):
        """GET /api/groups returns a list of group DMs."""
        response = api_client.get(f"{BASE_URL}/api/groups")
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ GET /api/groups returns list with {len(data)} groups")

    def test_create_group_dm(self, api_client):
        """POST /api/groups creates a new group DM."""
        response = api_client.post(
            f"{BASE_URL}/api/groups",
            json={"name": "Test Group API", "member_ids": []},
        )
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert data.get("name") == "Test Group API"
        assert "members" in data
        assert "created_at" in data
        print(f"✓ POST /api/groups creates group: {data['id']}")

    def test_get_group_messages(self, api_client):
        """GET /api/groups/{id}/messages returns messages."""
        # First get groups to find one
        groups_response = api_client.get(f"{BASE_URL}/api/groups")
        groups = groups_response.json()
        
        if not groups:
            pytest.skip("No groups available for testing")
        
        group_id = groups[0]["id"]
        response = api_client.get(f"{BASE_URL}/api/groups/{group_id}/messages")
        assert response.status_code == 200
        data = response.json()
        # Should return messages array or object with messages
        assert isinstance(data, (list, dict))
        print(f"✓ GET /api/groups/{group_id}/messages works")


class TestAuthEndpoints:
    """Basic auth endpoint tests."""

    def test_login_success(self):
        """POST /api/auth/login with valid credentials."""
        clear_rate_limits()
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        )
        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "user" in data
        print(f"✓ Login successful for {TEST_EMAIL}")

    def test_login_invalid_credentials(self):
        """POST /api/auth/login with invalid credentials."""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": "wrong@example.com", "password": "wrongpass"},
        )
        assert response.status_code in [401, 400]
        print(f"✓ Login rejected for invalid credentials")

    def test_get_me_authenticated(self, api_client):
        """GET /api/auth/me returns current user."""
        response = api_client.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 200
        data = response.json()
        assert "id" in data
        assert "email" in data
        print(f"✓ GET /api/auth/me returns user: {data['email']}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
