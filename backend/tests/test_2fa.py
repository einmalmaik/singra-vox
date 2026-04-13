# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox – Two-Factor Authentication (2FA) Tests
===================================================

Tests for the 2FA endpoints:
- POST /api/auth/2fa/setup – generates TOTP secret + QR URI
- POST /api/auth/2fa/confirm – confirms 2FA with first TOTP code, returns backup codes
- GET /api/auth/2fa/status – returns 2FA enabled/disabled status
- POST /api/auth/2fa/verify – verifies TOTP during login, returns access_token + sets cookies
- POST /api/auth/2fa/disable – disables 2FA with password verification
- POST /api/auth/login – returns requires_2fa=true when 2FA is enabled

Also tests:
- Full 2FA login flow: login -> requires_2fa -> verify -> access_token
- Backup code login flow: enable 2FA -> use backup code instead of TOTP
- Singra Vault URL presence in responses
"""
import os
import pytest
import requests
import pyotp
import uuid
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://vox-identity.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "singravox")

SINGRA_VAULT_URL = "https://singravault.mauntingstudios.de"


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
    return f"test_2fa_{uuid.uuid4().hex[:8]}@example.com"


def generate_test_username():
    """Generate unique test username."""
    return f"test2fa{uuid.uuid4().hex[:8]}"


def create_and_verify_user(api_client, db, email=None, username=None, password="TestPass123!"):
    """Create a user and auto-verify via direct DB update (no SMTP in preview)."""
    email = email or generate_test_email()
    username = username or generate_test_username()
    
    # Normalize email to lowercase (backend does this)
    email = email.lower().strip()
    
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
    
    # If verification_required is False, user is auto-verified (SMTP not available)
    if not data.get("verification_required", True):
        # User is already verified, login to get token
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
    
    # Auto-verify via DB (verification was required)
    import time
    time.sleep(0.5)  # Small delay to ensure DB write is complete
    
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
        print(f"Login failed after verification: {login_resp.status_code} - {login_resp.text}")
        return None
    
    login_data = login_resp.json()
    
    # Handle case where 2FA might be required (shouldn't happen for new user)
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


def cleanup_test_user(db, email):
    """Clean up test user and related data."""
    user = db.users.find_one({"email": email})
    if user:
        user_id = user.get("id")
        db.totp_secrets.delete_many({"user_id": user_id})
        db.auth_sessions.delete_many({"user_id": user_id})
        db.email_verifications.delete_many({"user_id": user_id})
        db.users.delete_one({"email": email})


class Test2FAStatus:
    """Tests for GET /api/auth/2fa/status endpoint."""
    
    def test_status_requires_auth(self, api_client):
        """2FA status endpoint requires authentication."""
        response = api_client.get(f"{BASE_URL}/api/auth/2fa/status")
        assert response.status_code == 401
        print("✓ 2FA status requires authentication")
    
    def test_status_returns_disabled_for_new_user(self, api_client, db):
        """New user should have 2FA disabled."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        try:
            response = api_client.get(
                f"{BASE_URL}/api/auth/2fa/status",
                headers={"Authorization": f"Bearer {user_data['token']}"}
            )
            assert response.status_code == 200
            data = response.json()
            assert not data["enabled"]
            assert "singra_vault_url" in data
            assert data["singra_vault_url"] == SINGRA_VAULT_URL
            print("✓ New user has 2FA disabled, Singra Vault URL present")
        finally:
            cleanup_test_user(db, user_data["email"])


class Test2FASetup:
    """Tests for POST /api/auth/2fa/setup endpoint."""
    
    def test_setup_requires_auth(self, api_client):
        """2FA setup endpoint requires authentication."""
        response = api_client.post(f"{BASE_URL}/api/auth/2fa/setup")
        assert response.status_code == 401
        print("✓ 2FA setup requires authentication")
    
    def test_setup_returns_secret_and_qr(self, api_client, db):
        """Setup should return TOTP secret, QR URI, and Singra Vault hint."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        try:
            response = api_client.post(
                f"{BASE_URL}/api/auth/2fa/setup",
                headers={"Authorization": f"Bearer {user_data['token']}"}
            )
            assert response.status_code == 200
            data = response.json()
            
            # Verify response structure
            assert "secret" in data
            assert "qr_uri" in data
            assert "hint" in data
            assert "singra_vault_url" in data
            
            # Verify secret is valid base32
            assert len(data["secret"]) >= 16
            
            # Verify QR URI format
            assert data["qr_uri"].startswith("otpauth://totp/")
            # Email is URL-encoded in QR URI, so check for encoded version
            import urllib.parse
            encoded_email = urllib.parse.quote(user_data["email"], safe='')
            assert encoded_email in data["qr_uri"] or user_data["email"].replace("@", "%40") in data["qr_uri"]
            
            # Verify Singra Vault URL
            assert data["singra_vault_url"] == SINGRA_VAULT_URL
            assert SINGRA_VAULT_URL in data["hint"]
            
            print("✓ 2FA setup returns secret, QR URI, and Singra Vault hint")
        finally:
            cleanup_test_user(db, user_data["email"])


class Test2FAConfirm:
    """Tests for POST /api/auth/2fa/confirm endpoint."""
    
    def test_confirm_requires_setup_first(self, api_client, db):
        """Confirm should fail if setup wasn't called first."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        try:
            response = api_client.post(
                f"{BASE_URL}/api/auth/2fa/confirm",
                headers={"Authorization": f"Bearer {user_data['token']}"},
                json={"code": "123456"}
            )
            assert response.status_code == 400
            assert "setup" in response.json().get("detail", "").lower()
            print("✓ Confirm fails without prior setup")
        finally:
            cleanup_test_user(db, user_data["email"])
    
    def test_confirm_with_invalid_code(self, api_client, db):
        """Confirm should fail with invalid TOTP code."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        try:
            # First setup
            setup_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/setup",
                headers={"Authorization": f"Bearer {user_data['token']}"}
            )
            assert setup_resp.status_code == 200
            
            # Try to confirm with wrong code
            response = api_client.post(
                f"{BASE_URL}/api/auth/2fa/confirm",
                headers={"Authorization": f"Bearer {user_data['token']}"},
                json={"code": "000000"}
            )
            assert response.status_code == 400
            assert "invalid" in response.json().get("detail", "").lower()
            print("✓ Confirm fails with invalid code")
        finally:
            cleanup_test_user(db, user_data["email"])
    
    def test_confirm_with_valid_code_returns_backup_codes(self, api_client, db):
        """Confirm with valid TOTP code should activate 2FA and return backup codes."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        try:
            # Setup
            setup_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/setup",
                headers={"Authorization": f"Bearer {user_data['token']}"}
            )
            assert setup_resp.status_code == 200
            secret = setup_resp.json()["secret"]
            
            # Generate valid TOTP code
            totp = pyotp.TOTP(secret)
            valid_code = totp.now()
            
            # Confirm
            response = api_client.post(
                f"{BASE_URL}/api/auth/2fa/confirm",
                headers={"Authorization": f"Bearer {user_data['token']}"},
                json={"code": valid_code}
            )
            assert response.status_code == 200
            data = response.json()
            
            # Verify response
            assert data["enabled"]
            assert "backup_codes" in data
            assert len(data["backup_codes"]) >= 8  # Should have at least 8 backup codes
            assert "singra_vault_url" in data
            assert data["singra_vault_url"] == SINGRA_VAULT_URL
            
            # Verify each backup code format
            for code in data["backup_codes"]:
                assert len(code) >= 8  # Backup codes should be at least 8 chars
            
            print(f"✓ 2FA confirmed, received {len(data['backup_codes'])} backup codes")
        finally:
            cleanup_test_user(db, user_data["email"])


class Test2FALoginFlow:
    """Tests for the full 2FA login flow."""
    
    def test_login_returns_requires_2fa_when_enabled(self, api_client, db):
        """Login should return requires_2fa=true when 2FA is enabled."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        try:
            # Enable 2FA
            setup_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/setup",
                headers={"Authorization": f"Bearer {user_data['token']}"}
            )
            secret = setup_resp.json()["secret"]
            totp = pyotp.TOTP(secret)
            
            confirm_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/confirm",
                headers={"Authorization": f"Bearer {user_data['token']}"},
                json={"code": totp.now()}
            )
            assert confirm_resp.status_code == 200
            
            # Now try to login - should require 2FA
            login_resp = api_client.post(f"{BASE_URL}/api/auth/login", json={
                "email": user_data["email"],
                "password": user_data["password"]
            })
            assert login_resp.status_code == 200
            data = login_resp.json()
            
            assert data.get("requires_2fa")
            assert "user_id" in data
            assert "access_token" not in data  # No token until 2FA verified
            
            print("✓ Login returns requires_2fa=true when 2FA enabled")
        finally:
            cleanup_test_user(db, user_data["email"])
    
    def test_full_2fa_login_flow(self, api_client, db):
        """Test complete flow: login -> requires_2fa -> verify -> access_token."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        try:
            # Enable 2FA
            setup_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/setup",
                headers={"Authorization": f"Bearer {user_data['token']}"}
            )
            secret = setup_resp.json()["secret"]
            totp = pyotp.TOTP(secret)
            
            confirm_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/confirm",
                headers={"Authorization": f"Bearer {user_data['token']}"},
                json={"code": totp.now()}
            )
            assert confirm_resp.status_code == 200
            
            # Step 1: Login - should require 2FA
            login_resp = api_client.post(f"{BASE_URL}/api/auth/login", json={
                "email": user_data["email"],
                "password": user_data["password"]
            })
            assert login_resp.status_code == 200
            login_data = login_resp.json()
            assert login_data.get("requires_2fa")
            user_id = login_data["user_id"]
            
            # Step 2: Verify 2FA
            import time
            time.sleep(1)  # Wait for new TOTP window
            verify_resp = api_client.post(f"{BASE_URL}/api/auth/2fa/verify", json={
                "user_id": user_id,
                "code": totp.now()
            })
            assert verify_resp.status_code == 200
            verify_data = verify_resp.json()
            
            # Should have full auth response
            assert "access_token" in verify_data
            assert "user" in verify_data
            assert verify_data["user"]["id"] == user_id
            
            print("✓ Full 2FA login flow works: login -> requires_2fa -> verify -> access_token")
        finally:
            cleanup_test_user(db, user_data["email"])


class Test2FABackupCodes:
    """Tests for backup code login flow."""
    
    def test_backup_code_login(self, api_client, db):
        """Test login with backup code instead of TOTP."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        try:
            # Enable 2FA and get backup codes
            setup_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/setup",
                headers={"Authorization": f"Bearer {user_data['token']}"}
            )
            secret = setup_resp.json()["secret"]
            totp = pyotp.TOTP(secret)
            
            confirm_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/confirm",
                headers={"Authorization": f"Bearer {user_data['token']}"},
                json={"code": totp.now()}
            )
            assert confirm_resp.status_code == 200
            backup_codes = confirm_resp.json()["backup_codes"]
            
            # Login - should require 2FA
            login_resp = api_client.post(f"{BASE_URL}/api/auth/login", json={
                "email": user_data["email"],
                "password": user_data["password"]
            })
            user_id = login_resp.json()["user_id"]
            
            # Verify with backup code
            verify_resp = api_client.post(f"{BASE_URL}/api/auth/2fa/verify", json={
                "user_id": user_id,
                "code": backup_codes[0]  # Use first backup code
            })
            assert verify_resp.status_code == 200
            verify_data = verify_resp.json()
            
            assert "access_token" in verify_data
            assert verify_data.get("backup_code_used")
            assert "backup_codes_remaining" in verify_data
            
            print(f"✓ Backup code login works, {verify_data['backup_codes_remaining']} codes remaining")
        finally:
            cleanup_test_user(db, user_data["email"])
    
    def test_backup_code_single_use(self, api_client, db):
        """Backup codes should only work once."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        try:
            # Enable 2FA
            setup_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/setup",
                headers={"Authorization": f"Bearer {user_data['token']}"}
            )
            secret = setup_resp.json()["secret"]
            totp = pyotp.TOTP(secret)
            
            confirm_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/confirm",
                headers={"Authorization": f"Bearer {user_data['token']}"},
                json={"code": totp.now()}
            )
            backup_codes = confirm_resp.json()["backup_codes"]
            backup_code = backup_codes[0]
            
            # First login with backup code
            login_resp = api_client.post(f"{BASE_URL}/api/auth/login", json={
                "email": user_data["email"],
                "password": user_data["password"]
            })
            user_id = login_resp.json()["user_id"]
            
            verify_resp = api_client.post(f"{BASE_URL}/api/auth/2fa/verify", json={
                "user_id": user_id,
                "code": backup_code
            })
            assert verify_resp.status_code == 200
            
            # Try to use same backup code again
            login_resp2 = api_client.post(f"{BASE_URL}/api/auth/login", json={
                "email": user_data["email"],
                "password": user_data["password"]
            })
            user_id2 = login_resp2.json()["user_id"]
            
            verify_resp2 = api_client.post(f"{BASE_URL}/api/auth/2fa/verify", json={
                "user_id": user_id2,
                "code": backup_code
            })
            assert verify_resp2.status_code == 401  # Should fail
            
            print("✓ Backup codes are single-use only")
        finally:
            cleanup_test_user(db, user_data["email"])


class Test2FADisable:
    """Tests for POST /api/auth/2fa/disable endpoint."""
    
    def test_disable_requires_password(self, api_client, db):
        """Disabling 2FA requires correct password."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        try:
            # Enable 2FA
            setup_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/setup",
                headers={"Authorization": f"Bearer {user_data['token']}"}
            )
            secret = setup_resp.json()["secret"]
            totp = pyotp.TOTP(secret)
            
            confirm_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/confirm",
                headers={"Authorization": f"Bearer {user_data['token']}"},
                json={"code": totp.now()}
            )
            assert confirm_resp.status_code == 200
            
            # Try to disable with wrong password
            disable_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/disable",
                headers={"Authorization": f"Bearer {user_data['token']}"},
                json={"password": "WrongPassword123!"}
            )
            assert disable_resp.status_code == 401
            
            print("✓ Disable 2FA requires correct password")
        finally:
            cleanup_test_user(db, user_data["email"])
    
    def test_disable_with_correct_password(self, api_client, db):
        """Disabling 2FA with correct password should work."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        try:
            # Enable 2FA
            setup_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/setup",
                headers={"Authorization": f"Bearer {user_data['token']}"}
            )
            secret = setup_resp.json()["secret"]
            totp = pyotp.TOTP(secret)
            
            confirm_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/confirm",
                headers={"Authorization": f"Bearer {user_data['token']}"},
                json={"code": totp.now()}
            )
            assert confirm_resp.status_code == 200
            
            # Disable with correct password
            disable_resp = api_client.post(
                f"{BASE_URL}/api/auth/2fa/disable",
                headers={"Authorization": f"Bearer {user_data['token']}"},
                json={"password": user_data["password"]}
            )
            assert disable_resp.status_code == 200
            data = disable_resp.json()
            assert not data["enabled"]
            
            # Verify 2FA is disabled
            status_resp = api_client.get(
                f"{BASE_URL}/api/auth/2fa/status",
                headers={"Authorization": f"Bearer {user_data['token']}"}
            )
            assert not status_resp.json()["enabled"]
            
            # Login should no longer require 2FA
            login_resp = api_client.post(f"{BASE_URL}/api/auth/login", json={
                "email": user_data["email"],
                "password": user_data["password"]
            })
            assert login_resp.status_code == 200
            assert "access_token" in login_resp.json()
            assert not login_resp.json().get("requires_2fa")
            
            print("✓ 2FA disabled successfully, login no longer requires 2FA")
        finally:
            cleanup_test_user(db, user_data["email"])


class Test2FAVerifyEndpoint:
    """Tests for POST /api/auth/2fa/verify endpoint edge cases."""
    
    def test_verify_invalid_user_id(self, api_client, db):
        """Verify should fail with invalid user_id."""
        response = api_client.post(f"{BASE_URL}/api/auth/2fa/verify", json={
            "user_id": "nonexistent-user-id",
            "code": "123456"
        })
        # Should return 400 or 404
        assert response.status_code in [400, 404]
        print("✓ Verify fails with invalid user_id")
    
    def test_verify_user_without_2fa(self, api_client, db):
        """Verify should fail for user without 2FA enabled."""
        user_data = create_and_verify_user(api_client, db)
        assert user_data is not None, "Failed to create test user"
        
        try:
            response = api_client.post(f"{BASE_URL}/api/auth/2fa/verify", json={
                "user_id": user_data["user_id"],
                "code": "123456"
            })
            assert response.status_code == 400
            assert "not enabled" in response.json().get("detail", "").lower()
            print("✓ Verify fails for user without 2FA")
        finally:
            cleanup_test_user(db, user_data["email"])


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
