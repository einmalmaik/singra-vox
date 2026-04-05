"""
Singra Vox – Account Deletion (GDPR) Tests
==========================================

Tests for DELETE /api/users/me endpoint:
- Atomic account deletion with all related data cleanup
- Verifies cleanup of: users, auth_sessions, totp_secrets, email_verifications,
  status_history, notifications, push_subscriptions, e2ee collections, rate_limits
"""
import os
import pytest
import requests
import pyotp
import uuid
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://voice-rebo-config.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "singravox")


@pytest.fixture(scope="module")
def mongo_client():
    """Synchronous MongoDB client for test setup/cleanup."""
    client = MongoClient(MONGO_URL)
    yield client
    client.close()


@pytest.fixture(scope="module")
def db(mongo_client):
    """Database instance."""
    return mongo_client[DB_NAME]


@pytest.fixture
def api_client():
    """Shared requests session."""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


def generate_test_email():
    """Generate unique test email."""
    return f"test_gdpr_{uuid.uuid4().hex[:8]}@example.com"


def generate_test_username():
    """Generate unique test username."""
    return f"testgdpr{uuid.uuid4().hex[:8]}"


def create_and_verify_user(api_client, db, email=None, username=None, password="TestPass123!"):
    """Create a user and auto-verify via direct DB update."""
    email = (email or generate_test_email()).lower().strip()
    username = username or generate_test_username()
    
    # Register user
    response = api_client.post(f"{BASE_URL}/api/auth/register", json={
        "email": email,
        "username": username,
        "password": password,
        "display_name": f"Test User {username}"
    })
    
    if response.status_code != 200:
        print(f"Registration failed: {response.status_code} - {response.text}")
        return None
    
    data = response.json()
    
    # If verification_required is False, user is auto-verified
    if not data.get("verification_required", True):
        login_resp = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": email,
            "password": password
        })
        if login_resp.status_code == 200:
            login_data = login_resp.json()
            return {
                "email": email,
                "username": username,
                "password": password,
                "user_id": login_data.get("user", {}).get("id"),
                "token": login_data.get("access_token")
            }
    
    # Auto-verify via DB
    import time
    time.sleep(0.5)
    
    result = db.users.update_one(
        {"email": email},
        {"$set": {"email_verified": True, "email_verified_at": "2024-01-01T00:00:00Z"}}
    )
    
    if result.modified_count == 0:
        print(f"Failed to auto-verify user {email}")
        return None
    
    # Login to get token
    login_resp = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": email,
        "password": password
    })
    
    if login_resp.status_code != 200:
        print(f"Login failed: {login_resp.status_code} - {login_resp.text}")
        return None
    
    login_data = login_resp.json()
    
    if login_data.get("requires_2fa"):
        print(f"Unexpected 2FA requirement for new user {email}")
        return None
    
    return {
        "email": email,
        "username": username,
        "password": password,
        "user_id": login_data.get("user", {}).get("id"),
        "token": login_data.get("access_token")
    }


class TestAccountDeletion:
    """Tests for DELETE /api/users/me endpoint."""
    
    def test_delete_requires_auth(self, api_client):
        """Account deletion requires authentication."""
        response = api_client.delete(f"{BASE_URL}/api/users/me")
        assert response.status_code == 401
        print("✓ Account deletion requires authentication")
    
    def test_delete_removes_user_record(self, api_client, db):
        """Account deletion should remove the user record."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        user_id = user_data["user_id"]
        email = user_data["email"]
        
        # Verify user exists before deletion
        user_before = db.users.find_one({"id": user_id})
        assert user_before is not None, "User should exist before deletion"
        
        # Delete account
        response = api_client.delete(
            f"{BASE_URL}/api/users/me",
            headers={"Authorization": f"Bearer {user_data['token']}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert data["ok"] == True
        assert data["deleted"]["profile"] == True
        
        # Verify user is deleted
        user_after = db.users.find_one({"id": user_id})
        assert user_after is None, "User should be deleted"
        
        print("✓ Account deletion removes user record")
    
    def test_delete_removes_auth_sessions(self, api_client, db):
        """Account deletion should remove all auth sessions."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        user_id = user_data["user_id"]
        
        # Verify session exists before deletion
        sessions_before = list(db.auth_sessions.find({"user_id": user_id}))
        assert len(sessions_before) > 0, "Should have at least one session"
        
        # Delete account
        response = api_client.delete(
            f"{BASE_URL}/api/users/me",
            headers={"Authorization": f"Bearer {user_data['token']}"}
        )
        assert response.status_code == 200
        assert response.json()["deleted"]["sessions"] == "deleted"
        
        # Verify sessions are deleted
        sessions_after = list(db.auth_sessions.find({"user_id": user_id}))
        assert len(sessions_after) == 0, "All sessions should be deleted"
        
        print("✓ Account deletion removes auth sessions")
    
    def test_delete_removes_totp_secrets(self, api_client, db):
        """Account deletion should remove TOTP secrets (2FA)."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        user_id = user_data["user_id"]
        
        # Enable 2FA first
        setup_resp = api_client.post(
            f"{BASE_URL}/api/auth/2fa/setup",
            headers={"Authorization": f"Bearer {user_data['token']}"}
        )
        assert setup_resp.status_code == 200
        secret = setup_resp.json()["secret"]
        
        totp = pyotp.TOTP(secret)
        confirm_resp = api_client.post(
            f"{BASE_URL}/api/auth/2fa/confirm",
            headers={"Authorization": f"Bearer {user_data['token']}"},
            json={"code": totp.now()}
        )
        assert confirm_resp.status_code == 200
        
        # Verify TOTP secret exists
        totp_before = db.totp_secrets.find_one({"user_id": user_id})
        assert totp_before is not None, "TOTP secret should exist"
        
        # Delete account
        response = api_client.delete(
            f"{BASE_URL}/api/users/me",
            headers={"Authorization": f"Bearer {user_data['token']}"}
        )
        assert response.status_code == 200
        assert response.json()["deleted"]["totp_2fa"] == "deleted"
        
        # Verify TOTP secret is deleted
        totp_after = db.totp_secrets.find_one({"user_id": user_id})
        assert totp_after is None, "TOTP secret should be deleted"
        
        print("✓ Account deletion removes TOTP secrets")
    
    def test_delete_removes_email_verifications(self, api_client, db):
        """Account deletion should remove email verification records."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        user_id = user_data["user_id"]
        
        # Insert a test email verification record
        db.email_verifications.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "email": user_data["email"],
            "purpose": "test",
            "code_hash": "test_hash",
            "expires_at": "2099-01-01T00:00:00Z",
            "created_at": "2024-01-01T00:00:00Z"
        })
        
        # Verify record exists
        verif_before = db.email_verifications.find_one({"user_id": user_id})
        assert verif_before is not None, "Email verification should exist"
        
        # Delete account
        response = api_client.delete(
            f"{BASE_URL}/api/users/me",
            headers={"Authorization": f"Bearer {user_data['token']}"}
        )
        assert response.status_code == 200
        
        # Verify record is deleted
        verif_after = db.email_verifications.find_one({"user_id": user_id})
        assert verif_after is None, "Email verification should be deleted"
        
        print("✓ Account deletion removes email verifications")
    
    def test_delete_removes_status_history(self, api_client, db):
        """Account deletion should remove status history."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        user_id = user_data["user_id"]
        
        # Status history is created on login, verify it exists
        import time
        time.sleep(0.5)
        status_before = list(db.status_history.find({"user_id": user_id}))
        # May or may not have status history depending on implementation
        
        # Delete account
        response = api_client.delete(
            f"{BASE_URL}/api/users/me",
            headers={"Authorization": f"Bearer {user_data['token']}"}
        )
        assert response.status_code == 200
        assert response.json()["deleted"]["status_history"] == "deleted"
        
        # Verify status history is deleted
        status_after = list(db.status_history.find({"user_id": user_id}))
        assert len(status_after) == 0, "Status history should be deleted"
        
        print("✓ Account deletion removes status history")
    
    def test_delete_removes_notifications(self, api_client, db):
        """Account deletion should remove notifications."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        user_id = user_data["user_id"]
        
        # Insert a test notification
        db.notifications.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "type": "test",
            "content": "Test notification",
            "read": False,
            "created_at": "2024-01-01T00:00:00Z"
        })
        
        # Verify notification exists
        notif_before = db.notifications.find_one({"user_id": user_id})
        assert notif_before is not None, "Notification should exist"
        
        # Delete account
        response = api_client.delete(
            f"{BASE_URL}/api/users/me",
            headers={"Authorization": f"Bearer {user_data['token']}"}
        )
        assert response.status_code == 200
        assert response.json()["deleted"]["notifications"] == "deleted"
        
        # Verify notification is deleted
        notif_after = db.notifications.find_one({"user_id": user_id})
        assert notif_after is None, "Notification should be deleted"
        
        print("✓ Account deletion removes notifications")
    
    def test_delete_removes_push_subscriptions(self, api_client, db):
        """Account deletion should remove push subscriptions."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        user_id = user_data["user_id"]
        
        # Insert a test push subscription
        db.push_subscriptions.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "endpoint": "https://test.push.endpoint",
            "keys": {"p256dh": "test", "auth": "test"},
            "created_at": "2024-01-01T00:00:00Z"
        })
        
        # Verify subscription exists
        sub_before = db.push_subscriptions.find_one({"user_id": user_id})
        assert sub_before is not None, "Push subscription should exist"
        
        # Delete account
        response = api_client.delete(
            f"{BASE_URL}/api/users/me",
            headers={"Authorization": f"Bearer {user_data['token']}"}
        )
        assert response.status_code == 200
        assert response.json()["deleted"]["push_subscriptions"] == "deleted"
        
        # Verify subscription is deleted
        sub_after = db.push_subscriptions.find_one({"user_id": user_id})
        assert sub_after is None, "Push subscription should be deleted"
        
        print("✓ Account deletion removes push subscriptions")
    
    def test_delete_removes_e2ee_data(self, api_client, db):
        """Account deletion should remove E2EE data."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        user_id = user_data["user_id"]
        
        # Insert test E2EE data
        db.e2ee_accounts.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "recovery_public_key": "test_key",
            "created_at": "2024-01-01T00:00:00Z"
        })
        db.e2ee_devices.insert_one({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "device_id": "test_device",
            "device_name": "Test Device",
            "public_key": "test_key",
            "created_at": "2024-01-01T00:00:00Z"
        })
        
        # Verify E2EE data exists
        e2ee_account_before = db.e2ee_accounts.find_one({"user_id": user_id})
        e2ee_device_before = db.e2ee_devices.find_one({"user_id": user_id})
        assert e2ee_account_before is not None, "E2EE account should exist"
        assert e2ee_device_before is not None, "E2EE device should exist"
        
        # Delete account
        response = api_client.delete(
            f"{BASE_URL}/api/users/me",
            headers={"Authorization": f"Bearer {user_data['token']}"}
        )
        assert response.status_code == 200
        assert response.json()["deleted"]["e2ee_keys"] == "deleted"
        
        # Verify E2EE data is deleted
        e2ee_account_after = db.e2ee_accounts.find_one({"user_id": user_id})
        e2ee_device_after = db.e2ee_devices.find_one({"user_id": user_id})
        assert e2ee_account_after is None, "E2EE account should be deleted"
        assert e2ee_device_after is None, "E2EE device should be deleted"
        
        print("✓ Account deletion removes E2EE data")
    
    def test_delete_removes_rate_limits(self, api_client, db):
        """Account deletion should remove rate limit records."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        email = user_data["email"]
        
        # Insert a test rate limit record
        db.rate_limits.insert_one({
            "id": str(uuid.uuid4()),
            "scope": "test",
            "key": f"test:{email}",
            "count": 1,
            "window_start": "2024-01-01T00:00:00Z"
        })
        
        # Verify rate limit exists
        rate_before = db.rate_limits.find_one({"key": {"$regex": email}})
        assert rate_before is not None, "Rate limit should exist"
        
        # Delete account
        response = api_client.delete(
            f"{BASE_URL}/api/users/me",
            headers={"Authorization": f"Bearer {user_data['token']}"}
        )
        assert response.status_code == 200
        assert response.json()["deleted"]["rate_limits"] == "deleted"
        
        # Verify rate limit is deleted
        rate_after = db.rate_limits.find_one({"key": {"$regex": email}})
        assert rate_after is None, "Rate limit should be deleted"
        
        print("✓ Account deletion removes rate limits")
    
    def test_delete_response_structure(self, api_client, db):
        """Account deletion should return proper response structure."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        # Delete account
        response = api_client.delete(
            f"{BASE_URL}/api/users/me",
            headers={"Authorization": f"Bearer {user_data['token']}"}
        )
        assert response.status_code == 200
        data = response.json()
        
        # Verify response structure
        assert data["ok"] == True
        assert "deleted" in data
        
        deleted = data["deleted"]
        expected_keys = [
            "profile", "messages", "direct_messages", "memberships",
            "voice_states", "e2ee_keys", "files", "totp_2fa", "sessions",
            "push_subscriptions", "notifications", "svid_links",
            "status_history", "rate_limits", "audit_log"
        ]
        
        for key in expected_keys:
            assert key in deleted, f"Missing key in deleted: {key}"
        
        print("✓ Account deletion returns proper response structure")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
