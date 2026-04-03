"""
Permission system tests for Singra Vox – Discord-style permissions.
Tests all 15 scenarios from the review request.
"""
import os
import pytest
import requests
import time

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Credentials
ADMIN_EMAIL = "admin@singravox.local"
ADMIN_PASS = "Admin1234!"
TESTUSER_EMAIL = "testuser@singravox.local"
TESTUSER_PASS = "TestPass123!"

# Known IDs (server owned by admin, testuser is a member)
SERVER_ID = "03778528-7e75-4ddc-83df-f06260323967"
CHANNEL_ID = "bee73bda-4936-48b2-afa0-a2745ba53d26"  # general text channel
VOICE_CHANNEL_ID = "79f4729e-d2f7-4f88-87e1-d5cda81d5b6b"


def get_token(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code == 200:
        return r.json()["access_token"]
    pytest.skip(f"Login failed for {email}: {r.text}")


def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin_token():
    return get_token(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def testuser_token():
    return get_token(TESTUSER_EMAIL, TESTUSER_PASS)


@pytest.fixture(scope="module")
def outsider_token():
    """Register a brand new user who has no server membership."""
    import uuid
    uid = uuid.uuid4().hex[:8]
    email = f"outsider_{uid}@test.local"
    password = "OutPass123!"
    # register
    r = requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "username": f"outsider_{uid}", "password": password,
        "display_name": f"Outsider {uid}"
    })
    assert r.status_code in (200, 201), f"Register failed: {r.text}"
    # get verification code from Mailpit
    time.sleep(1)
    msgs = requests.get("http://localhost:8025/api/v1/messages").json()
    code = None
    for msg in msgs.get("messages", []):
        if email in str(msg.get("To", "")):
            msg_id = msg["ID"]
            body = requests.get(f"http://localhost:8025/api/v1/message/{msg_id}").json()
            text = body.get("Text", "")
            for line in text.split("\n"):
                if line.strip().isdigit() and len(line.strip()) == 6:
                    code = line.strip()
                    break
            break
    if not code:
        # try to find code in recent messages
        for msg in msgs.get("messages", []):
            msg_id = msg["ID"]
            body = requests.get(f"http://localhost:8025/api/v1/message/{msg_id}").json()
            text = body.get("Text", "") + body.get("HTML", "")
            import re
            m = re.search(r'\b(\d{6})\b', text)
            if m:
                code = m.group(1)
                break
    if not code:
        pytest.skip("Could not retrieve verification code from Mailpit")
    rv = requests.post(f"{BASE_URL}/api/auth/verify-email", json={"email": email, "code": code})
    assert rv.status_code == 200, f"Verify failed: {rv.text}"
    return get_token(email, password)


# ── Test 1: Member can send messages ─────────────────────────────────────────
class TestMemberSendMessages:
    """Test 1: testuser (member) can send a message → 200"""

    def test_member_can_send_message(self, testuser_token):
        r = requests.post(
            f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
            json={"content": "Hello from testuser", "type": "text"},
            headers=auth(testuser_token)
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "id" in data
        assert data["content"] == "Hello from testuser"
        print(f"PASS: member can send messages → 200")


# ── Test 2: Member cannot read channel overrides (manage_channels) ────────────
class TestMemberCannotReadOverrides:
    """Test 2: testuser attempts GET /api/channels/{id}/overrides → 403"""

    def test_member_cannot_read_overrides(self, testuser_token):
        r = requests.get(
            f"{BASE_URL}/api/channels/{CHANNEL_ID}/overrides",
            headers=auth(testuser_token)
        )
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print(f"PASS: member cannot read overrides → 403")


# ── Test 3: Owner can read overrides ─────────────────────────────────────────
class TestOwnerCanReadOverrides:
    """Test 3: admin (owner) can GET /api/channels/{id}/overrides → 200"""

    def test_owner_can_read_overrides(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/channels/{CHANNEL_ID}/overrides",
            headers=auth(admin_token)
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert isinstance(r.json(), list)
        print(f"PASS: owner can read overrides → 200")


# ── Test 4: testuser cannot create temp channel (no manage_channels) ─────────
class TestMemberCannotCreateTempChannel:
    """Test 4: testuser POST /api/servers/{id}/channels/temp → 403"""

    def test_member_cannot_create_temp_channel(self, testuser_token):
        r = requests.post(
            f"{BASE_URL}/api/servers/{SERVER_ID}/channels/temp",
            json={"name": "test-temp", "type": "text"},
            headers=auth(testuser_token)
        )
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print(f"PASS: member cannot create temp channel → 403")


# ── Test 5: Admin can create temp channel ────────────────────────────────────
class TestOwnerCanCreateTempChannel:
    """Test 5: admin POST /api/servers/{id}/channels/temp → 200"""

    def test_owner_can_create_temp_channel(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/servers/{SERVER_ID}/channels/temp",
            json={"name": "temp-test-channel", "type": "text"},
            headers=auth(admin_token)
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert data["is_temporary"] is True
        assert data["name"] == "temp-test-channel"
        print(f"PASS: owner can create temp channel → 200")


# ── Test 6: File upload and access by member ─────────────────────────────────
class TestFileAccess:
    """Test 6: admin uploads file with channel_id → testuser (member) can access → 200"""

    def test_file_upload_and_member_access(self, admin_token, testuser_token):
        import base64
        data = base64.b64encode(b"hello world").decode()
        r = requests.post(
            f"{BASE_URL}/api/upload",
            json={"data": data, "name": "test.txt", "type": "text/plain", "channel_id": CHANNEL_ID},
            headers=auth(admin_token)
        )
        assert r.status_code == 200, f"Upload failed: {r.text}"
        file_id = r.json()["id"]

        # testuser (member with read_messages) should be able to access file
        r2 = requests.get(f"{BASE_URL}/api/files/{file_id}", headers=auth(testuser_token))
        assert r2.status_code == 200, f"Expected 200, got {r2.status_code}: {r2.text}"
        print(f"PASS: member can access channel file → 200")


# ── Test 7: Non-member cannot list emojis ────────────────────────────────────
class TestNonMemberCannotListEmojis:
    """Test 7: outsider (not a member) GET /api/servers/{id}/emojis → 403"""

    def test_outsider_cannot_list_emojis(self, outsider_token):
        r = requests.get(
            f"{BASE_URL}/api/servers/{SERVER_ID}/emojis",
            headers=auth(outsider_token)
        )
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print(f"PASS: non-member cannot list emojis → 403")


# ── Test 8: Member can list emojis ───────────────────────────────────────────
class TestMemberCanListEmojis:
    """Test 8: testuser (member) GET /api/servers/{id}/emojis → 200"""

    def test_member_can_list_emojis(self, testuser_token):
        r = requests.get(
            f"{BASE_URL}/api/servers/{SERVER_ID}/emojis",
            headers=auth(testuser_token)
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert isinstance(r.json(), list)
        print(f"PASS: member can list emojis → 200")


# ── Test 9: Non-member cannot mark channel read ──────────────────────────────
class TestNonMemberCannotMarkRead:
    """Test 9: outsider POST /api/channels/{id}/read → 403"""

    def test_outsider_cannot_mark_channel_read(self, outsider_token):
        r = requests.post(
            f"{BASE_URL}/api/channels/{CHANNEL_ID}/read",
            headers=auth(outsider_token),
            json={}
        )
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print(f"PASS: non-member cannot mark channel read → 403")


# ── Test 10: Member can mark channel read ────────────────────────────────────
class TestMemberCanMarkRead:
    """Test 10: testuser POST /api/channels/{id}/read → 200"""

    def test_member_can_mark_channel_read(self, testuser_token):
        r = requests.post(
            f"{BASE_URL}/api/channels/{CHANNEL_ID}/read",
            headers=auth(testuser_token),
            json={}
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert r.json().get("ok") is True
        print(f"PASS: member can mark channel read → 200")


# ── Test 11: Thread reply without send_messages → 403 ────────────────────────
class TestThreadReplyWithoutSendMessages:
    """Test 11: Role without send_messages, testuser replies to thread → 403"""

    def test_thread_reply_denied_without_send_messages(self, admin_token, testuser_token):
        # Create a role with send_messages=False
        r = requests.post(
            f"{BASE_URL}/api/servers/{SERVER_ID}/roles",
            json={"name": "NoSendRole", "permissions": {"send_messages": False, "read_messages": True}},
            headers=auth(admin_token)
        )
        assert r.status_code in (200, 201), f"Role create failed: {r.text}"
        role_id = r.json()["id"]

        # Get testuser member info
        testuser_id = "8b5675a4-33a9-47f4-a6de-e1e64411c6b7"

        # Assign role to testuser
        r2 = requests.put(
            f"{BASE_URL}/api/servers/{SERVER_ID}/members/{testuser_id}",
            json={"roles": [role_id]},
            headers=auth(admin_token)
        )
        assert r2.status_code == 200, f"Role assign failed: {r2.text}"

        # Set override: everyone gets send_messages=False for channel
        requests.put(
            f"{BASE_URL}/api/channels/{CHANNEL_ID}/overrides",
            json={"target_type": "role", "target_id": role_id, "permissions": {"send_messages": False}},
            headers=auth(admin_token)
        )

        # First create a thread message as admin
        msg_r = requests.post(
            f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
            json={"content": "Thread parent", "type": "text"},
            headers=auth(admin_token)
        )
        assert msg_r.status_code == 200, f"Create message failed: {msg_r.text}"
        thread_id = msg_r.json()["id"]

        # Now try to reply as testuser — should be 403 because NoSendRole denies send_messages
        r3 = requests.post(
            f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages/{thread_id}/reply",
            json={"content": "Reply attempt"},
            headers=auth(testuser_token)
        )
        
        # Cleanup: remove role from testuser
        requests.put(
            f"{BASE_URL}/api/servers/{SERVER_ID}/members/{testuser_id}",
            json={"roles": []},
            headers=auth(admin_token)
        )

        assert r3.status_code == 403, f"Expected 403, got {r3.status_code}: {r3.text}"
        print(f"PASS: thread reply without send_messages → 403")


# ── Test 12: Revisions without membership → 403 ──────────────────────────────
class TestRevisionsWithoutMembership:
    """Test 12: GET /api/messages/{id}/revisions without membership → 403"""

    def test_revisions_require_read_messages(self, admin_token, outsider_token):
        # Create a message as admin
        msg_r = requests.post(
            f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
            json={"content": "Test message for revisions", "type": "text"},
            headers=auth(admin_token)
        )
        assert msg_r.status_code == 200
        msg_id = msg_r.json()["id"]

        # Outsider (non-member) tries to access revisions
        r = requests.get(
            f"{BASE_URL}/api/messages/{msg_id}/revisions",
            headers=auth(outsider_token)
        )
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print(f"PASS: revisions without membership → 403")


# ── Test 13: Voice token ──────────────────────────────────────────────────────
class TestVoiceToken:
    """Test 13: admin GET /api/voice/token → returns server_url"""

    def test_voice_token_returns_server_url(self, admin_token):
        r = requests.post(
            f"{BASE_URL}/api/voice/token",
            json={"server_id": SERVER_ID, "channel_id": VOICE_CHANNEL_ID},
            headers=auth(admin_token)
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        assert "server_url" in data, f"Missing server_url in response: {data}"
        assert data["server_url"]
        print(f"PASS: voice token returns server_url → {data['server_url']}")


# ── Test 14: Default permissions check ───────────────────────────────────────
class TestDefaultPermissions:
    """Test 14: testuser viewer-context has expected default permissions"""

    def test_default_permissions_for_member(self, testuser_token):
        r = requests.get(
            f"{BASE_URL}/api/servers/{SERVER_ID}/viewer-context",
            headers=auth(testuser_token)
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        sp = data.get("server_permissions", {})
        assert sp.get("send_messages") is True, f"send_messages should be True: {sp}"
        assert sp.get("read_messages") is True, f"read_messages should be True: {sp}"
        assert sp.get("attach_files") is True, f"attach_files should be True: {sp}"
        assert sp.get("manage_channels") is False, f"manage_channels should be False: {sp}"
        print(f"PASS: default permissions correct → send_messages=True, read_messages=True, attach_files=True, manage_channels=False")


# ── Test 15: Owner bypass ─────────────────────────────────────────────────────
class TestOwnerBypass:
    """Test 15: Server owner has ALL permissions even if role denies them"""

    def test_owner_bypass_all_permissions(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/servers/{SERVER_ID}/viewer-context",
            headers=auth(admin_token)
        )
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        sp = data.get("server_permissions", {})
        # Owner should have ALL permissions set to True
        for perm, val in sp.items():
            assert val is True, f"Owner should have {perm}=True, got {val}"
        print(f"PASS: owner bypass → all {len(sp)} permissions are True")
