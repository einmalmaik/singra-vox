"""
Iteration 10: Tests for SMTP email verification, MinIO S3 uploads, and Voice token API.
"""
import pytest
import requests
import os
import time
import uuid
import base64

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
MAILPIT_API = "http://localhost:8025/api/v1"


def unique_email():
    return f"test_{uuid.uuid4().hex[:8]}@example.com"


# ── SMTP Registration & Verification ─────────────────────────────────────────

class TestSMTPRegistration:
    """Register → email verification flow via Mailpit"""

    def test_register_returns_verification_required(self):
        """POST /api/auth/register must return verification_required: true"""
        email = unique_email()
        resp = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": email,
            "username": f"user_{uuid.uuid4().hex[:6]}",
            "password": "TestPass123!",
            "display_name": "Test User"
        })
        assert resp.status_code == 200, f"Expected 200 got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("verification_required") is True, f"Expected verification_required=true, got {data}"
        assert data.get("email") == email

    def test_login_without_verification_returns_403(self):
        """Login with unverified account must return 403"""
        email = unique_email()
        username = f"user_{uuid.uuid4().hex[:6]}"
        # register
        reg = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "username": username, "password": "TestPass123!"
        })
        assert reg.status_code == 200
        # try login before verification
        login = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": email, "password": "TestPass123!"
        })
        assert login.status_code == 403, f"Expected 403 got {login.status_code}: {login.text}"

    def test_resend_verification_ok(self):
        """POST /api/auth/resend-verification with unverified email returns ok:true"""
        email = unique_email()
        username = f"user_{uuid.uuid4().hex[:6]}"
        reg = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "username": username, "password": "TestPass123!"
        })
        assert reg.status_code == 200
        # resend
        resp = requests.post(f"{BASE_URL}/api/auth/resend-verification", json={"email": email})
        assert resp.status_code == 200, f"Got {resp.status_code}: {resp.text}"
        data = resp.json()
        assert data.get("ok") is True

    def test_full_verify_email_flow(self):
        """Register → get code from Mailpit → verify → login succeeds"""
        email = unique_email()
        username = f"user_{uuid.uuid4().hex[:6]}"

        # 1. Register
        reg = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": email, "username": username, "password": "TestPass123!"
        })
        assert reg.status_code == 200, f"Register failed: {reg.text}"

        # 2. Wait briefly for email delivery
        time.sleep(2)

        # 3. Get messages from Mailpit
        msgs_resp = requests.get(f"{MAILPIT_API}/messages")
        assert msgs_resp.status_code == 200, f"Mailpit API not responding: {msgs_resp.status_code}"
        msgs_data = msgs_resp.json()
        messages = msgs_data.get("messages", [])

        # Find message to our email
        target_msg = None
        for msg in messages:
            tos = msg.get("To", [])
            for t in tos:
                if t.get("Address", "") == email or email in str(t):
                    target_msg = msg
                    break
            if target_msg:
                break

        if not target_msg:
            pytest.skip(f"No email found for {email} in Mailpit. Messages: {[m.get('To') for m in messages[:5]]}")

        # 4. Get message body to extract code
        msg_id = target_msg["ID"]
        msg_resp = requests.get(f"{MAILPIT_API}/message/{msg_id}")
        assert msg_resp.status_code == 200
        msg_body = msg_resp.json()
        text_body = msg_body.get("Text", "") or ""

        # Extract 6-digit code from body
        import re
        codes = re.findall(r'\b(\d{6})\b', text_body)
        assert codes, f"No 6-digit code found in email body: {text_body[:300]}"
        code = codes[0]

        # 5. Verify email
        verify_resp = requests.post(f"{BASE_URL}/api/auth/verify-email", json={
            "email": email, "code": code
        })
        assert verify_resp.status_code == 200, f"Verification failed: {verify_resp.text}"
        data = verify_resp.json()
        assert "access_token" in data or "user" in data, f"No auth data in response: {data}"

        # 6. Login after verification
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": email, "password": "TestPass123!"
        })
        assert login_resp.status_code == 200, f"Login failed after verification: {login_resp.text}"


# ── S3 / MinIO File Upload ────────────────────────────────────────────────────

class TestS3MinioUpload:
    """POST /api/upload and GET /api/files/{id}"""

    @pytest.fixture(autouse=True)
    def auth_cookies(self):
        """Login as admin to get auth cookies"""
        session = requests.Session()
        resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@singravox.local",
            "password": "Admin1234!"
        })
        if resp.status_code != 200:
            pytest.skip(f"Admin login failed: {resp.status_code} {resp.text}")
        self.session = session

    def test_upload_image_returns_url(self):
        """POST /api/upload with base64 image → returns {id, url, content_type}"""
        # 1x1 PNG base64
        png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        resp = self.session.post(f"{BASE_URL}/api/upload", json={
            "data": png_b64,
            "type": "image/png",
            "name": "test.png"
        })
        assert resp.status_code == 200, f"Upload failed: {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "id" in data or "url" in data, f"No id/url in response: {data}"
        self.__class__.uploaded_id = data.get("id")
        self.__class__.uploaded_url = data.get("url")

    def test_get_uploaded_file_returns_200(self):
        """GET /api/files/{id} → 200 with image/png content"""
        # Upload first
        png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        upload_resp = self.session.post(f"{BASE_URL}/api/upload", json={
            "data": png_b64,
            "type": "image/png",
            "name": "test.png"
        })
        assert upload_resp.status_code == 200, f"Upload failed: {upload_resp.text}"
        file_id = upload_resp.json().get("id")
        assert file_id, "No id in upload response"

        # Get file
        get_resp = self.session.get(f"{BASE_URL}/api/files/{file_id}")
        assert get_resp.status_code == 200, f"Get file failed: {get_resp.status_code}: {get_resp.text}"
        ct = get_resp.headers.get("content-type", "")
        assert "image" in ct, f"Expected image content-type, got: {ct}"

    def test_upload_without_auth_returns_401(self):
        """POST /api/upload without auth → 401"""
        png_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
        resp = requests.post(f"{BASE_URL}/api/upload", json={
            "data": png_b64, "type": "image/png", "name": "test.png"
        })
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"


# ── Voice Token API ───────────────────────────────────────────────────────────

class TestVoiceToken:
    """POST /api/voice/token must return server_url (based on LIVEKIT_PUBLIC_URL)"""

    @pytest.fixture(autouse=True)
    def auth_cookies(self):
        session = requests.Session()
        resp = session.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@singravox.local",
            "password": "Admin1234!"
        })
        if resp.status_code != 200:
            pytest.skip(f"Admin login failed: {resp.status_code} {resp.text}")
        self.session = session

    def test_voice_token_returns_server_url(self):
        """POST /api/voice/token must return server_url field"""
        # Get a valid channel first
        servers_resp = self.session.get(f"{BASE_URL}/api/servers")
        assert servers_resp.status_code == 200
        servers = servers_resp.json()
        if not servers:
            pytest.skip("No servers available")

        server_id = servers[0]["id"]
        channels_resp = self.session.get(f"{BASE_URL}/api/servers/{server_id}/channels")
        assert channels_resp.status_code == 200
        channels = channels_resp.json()
        voice_channel = next((c for c in channels if c.get("type") == "voice"), None)
        if not voice_channel:
            pytest.skip("No voice channel found")

        resp = self.session.post(f"{BASE_URL}/api/voice/token", json={
            "channel_id": voice_channel["id"],
            "server_id": server_id
        })
        assert resp.status_code == 200, f"Voice token failed: {resp.status_code}: {resp.text}"
        data = resp.json()
        assert "server_url" in data, f"No server_url in response: {data}"
        assert data["server_url"], "server_url is empty"
        print(f"Voice token server_url: {data['server_url']}")

    def test_voice_token_without_auth_returns_401(self):
        """POST /api/voice/token without auth → 401"""
        resp = requests.post(f"{BASE_URL}/api/voice/token", json={
            "channel_id": "fake", "server_id": "fake"
        })
        assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
