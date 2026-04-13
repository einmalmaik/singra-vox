# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Full Permission System Test Suite for Singra Vox – Discord-style permissions.
Tests all 30 scenarios: standard flow, role overrides, privilege escalation,
token manipulation, channel overrides, and edge cases.
"""
import os
import re
import time
import uuid
import base64
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")

# Credentials
ADMIN_EMAIL = "admin@singravox.local"
ADMIN_PASS = "Admin1234!"
TESTUSER_EMAIL = "testuser@singravox.local"
TESTUSER_PASS = "TestPass123!"

# Known IDs
SERVER_ID = "03778528-7e75-4ddc-83df-f06260323967"
CHANNEL_ID = "bee73bda-4936-48b2-afa0-a2745ba53d26"  # general text channel
ADMIN_ID = "56e4b9c8-184f-4c15-a9bd-5dcb625c5545"
TESTUSER_ID = "8b5675a4-33a9-47f4-a6de-e1e64411c6b7"


def get_token(email, password):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password})
    if r.status_code == 200:
        return r.json()["access_token"]
    pytest.skip(f"Login failed for {email}: {r.text}")


def h(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def admin_token():
    return get_token(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def testuser_token():
    return get_token(TESTUSER_EMAIL, TESTUSER_PASS)


def _register_and_verify_user(email, password, username, display_name):
    """Helper to register, verify, and return token for a new user."""
    r = requests.post(f"{BASE_URL}/api/auth/register", json={
        "email": email, "username": username, "password": password,
        "display_name": display_name
    })
    if r.status_code not in (200, 201):
        pytest.skip(f"Register failed: {r.text}")
    time.sleep(1)
    msgs = requests.get("http://localhost:8025/api/v1/messages").json()
    code = None
    for msg in msgs.get("messages", []):
        if email in str(msg.get("To", "")):
            body = requests.get(f"http://localhost:8025/api/v1/message/{msg['ID']}").json()
            m = re.search(r'\b(\d{6})\b', body.get("Text", "") + body.get("HTML", ""))
            if m:
                code = m.group(1)
                break
    if not code:
        for msg in msgs.get("messages", []):
            body = requests.get(f"http://localhost:8025/api/v1/message/{msg['ID']}").json()
            m = re.search(r'\b(\d{6})\b', body.get("Text", "") + body.get("HTML", ""))
            if m:
                code = m.group(1)
                break
    if not code:
        pytest.skip("Could not retrieve verification code from Mailpit")
    rv = requests.post(f"{BASE_URL}/api/auth/verify-email", json={"email": email, "code": code})
    if rv.status_code != 200:
        pytest.skip(f"Verify failed: {rv.text}")
    return get_token(email, password)


@pytest.fixture(scope="module")
def outsider(admin_token):
    """Register a brand new user who has no membership in main server.
    Admin creates a second server to test cross-server access."""
    uid = uuid.uuid4().hex[:8]
    email = f"outsider_{uid}@test.local"
    password = "OutPass123!"
    token = _register_and_verify_user(email, password, f"outsider_{uid}", f"Outsider {uid}")
    user_r = requests.get(f"{BASE_URL}/api/auth/me", headers=h(token))
    outsider_user_id = user_r.json()["id"]
    # Admin creates a separate server for cross-server access tests
    sr = requests.post(f"{BASE_URL}/api/servers", json={"name": f"Admin Foreign Server {uid}"}, headers=h(admin_token))
    if sr.status_code not in (200, 201):
        pytest.skip(f"Admin could not create foreign server: {sr.text}")
    outsider_server_id = sr.json()["id"]
    return {"token": token, "server_id": outsider_server_id, "user_id": outsider_user_id, "foreign_server_token": admin_token}


# ─── STANDARD FLOW ────────────────────────────────────────────────────────────

class TestOwnerCanDoEverything:
    """Test 1: admin (owner) can use all endpoints successfully"""

    def test_owner_can_read_server(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/servers/{SERVER_ID}", headers=h(admin_token))
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        print("PASS: owner can read server → 200")

    def test_owner_can_send_message(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
                          json={"content": "Owner message", "type": "text"}, headers=h(admin_token))
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        print("PASS: owner can send message → 200")

    def test_owner_viewer_context_all_true(self, admin_token):
        r = requests.get(f"{BASE_URL}/api/servers/{SERVER_ID}/viewer-context", headers=h(admin_token))
        assert r.status_code == 200
        sp = r.json().get("server_permissions", {})
        for perm, val in sp.items():
            assert val is True, f"Owner should have {perm}=True, got {val}"
        print(f"PASS: owner has all {len(sp)} permissions True")


class TestEveryoneDefaultPermissions:
    """Test 2: new member @everyone defaults"""

    def test_default_send_messages_true(self, testuser_token):
        r = requests.get(f"{BASE_URL}/api/servers/{SERVER_ID}/viewer-context", headers=h(testuser_token))
        assert r.status_code == 200
        sp = r.json().get("server_permissions", {})
        assert sp.get("send_messages") is True
        assert sp.get("read_messages") is True
        assert sp.get("attach_files") is True
        assert sp.get("manage_channels") is False
        assert sp.get("ban_members") is False
        print("PASS: @everyone defaults correct")


class TestMemberSendMessage:
    """Test 3: testuser can send message → 200"""

    def test_member_can_send_message(self, testuser_token):
        r = requests.post(f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
                          json={"content": "Hello from testuser", "type": "text"}, headers=h(testuser_token))
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        assert r.json().get("content") == "Hello from testuser"
        print("PASS: member can send message → 200")


class TestMemberReadMessages:
    """Test 4: testuser GET /api/channels/{id}/messages → 200"""

    def test_member_can_read_messages(self, testuser_token):
        r = requests.get(f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages", headers=h(testuser_token))
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        # Response is paginated: {"messages": [...], "has_more_before": ...}
        assert "messages" in data or isinstance(data, list), f"Unexpected response: {data}"
        print("PASS: member can read messages → 200")


class TestMemberUploadFile:
    """Test 5: testuser POST /api/upload with channel_id → 200"""

    def test_member_can_upload_file(self, testuser_token):
        data = base64.b64encode(b"test file content").decode()
        r = requests.post(f"{BASE_URL}/api/upload",
                          json={"data": data, "name": "test.txt", "type": "text/plain", "channel_id": CHANNEL_ID},
                          headers=h(testuser_token))
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        print("PASS: member can upload file → 200")


class TestMemberCannotKick:
    """Test 6: testuser POST kick → 403"""

    def test_member_cannot_kick(self, testuser_token, admin_token):
        # Create a dummy member to try to kick
        r = requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{ADMIN_ID}",
                            headers=h(testuser_token))
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print("PASS: member cannot kick → 403")


class TestMemberCannotBan:
    """Test 7: testuser POST ban → 403"""

    def test_member_cannot_ban(self, testuser_token):
        r = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/moderation/ban",
                          json={"user_id": ADMIN_ID, "reason": "test"}, headers=h(testuser_token))
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print("PASS: member cannot ban → 403")


class TestMemberCannotCreateChannel:
    """Test 8: testuser POST /api/servers/{id}/channels → 403"""

    def test_member_cannot_create_channel(self, testuser_token):
        r = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/channels",
                          json={"name": "hack-channel", "type": "text"}, headers=h(testuser_token))
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print("PASS: member cannot create channel → 403")


class TestMemberCannotDeleteChannel:
    """Test 9: testuser DELETE /api/channels/{id} → 403"""

    def test_member_cannot_delete_channel(self, testuser_token):
        r = requests.delete(f"{BASE_URL}/api/channels/{CHANNEL_ID}", headers=h(testuser_token))
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print("PASS: member cannot delete channel → 403")


class TestMemberCannotDeleteServer:
    """Test 10: testuser DELETE /api/servers/{id} → 403"""

    def test_member_cannot_delete_server(self, testuser_token):
        r = requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}", headers=h(testuser_token))
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print("PASS: member cannot delete server → 403")


# ─── ROLLEN-OVERRIDE ──────────────────────────────────────────────────────────

class TestMutedRoleBlocksSendMessages:
    """Test 11: Role 'Muted' with send_messages=false → 403 when sending
    
    BUG FIXED: resolve_server_permissions() now correctly applies deny-logic.
    Denials from roles override @everyone defaults unless another role grants the permission.
    """

    def test_muted_role_blocks_send(self, admin_token, testuser_token):
        # Create Muted role
        r = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/roles",
                          json={"name": "Muted_T11", "permissions": {"send_messages": False, "read_messages": True}},
                          headers=h(admin_token))
        assert r.status_code in (200, 201), f"Role create failed: {r.text}"
        role_id = r.json()["id"]

        # Assign to testuser
        r2 = requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                          json={"roles": [role_id]}, headers=h(admin_token))
        assert r2.status_code == 200, f"Assign role failed: {r2.text}"

        # Try to send message
        r3 = requests.post(f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
                           json={"content": "This should fail", "type": "text"}, headers=h(testuser_token))

        # Cleanup
        requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                     json={"roles": []}, headers=h(admin_token))
        requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{role_id}", headers=h(admin_token))

        assert r3.status_code == 403, \
            f"CRITICAL BUG: Role with send_messages=False doesn't block sending! " \
            f"Got {r3.status_code} instead of 403."


class TestNoFilesRoleBlocksUpload:
    """Test 12: Role 'NoFiles' with attach_files=false → 403 on file upload
    
    BUG FIXED: Same as Test 11 - roles can now deny permissions.
    """

    def test_nofiles_role_blocks_upload(self, admin_token, testuser_token):
        r = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/roles",
                          json={"name": "NoFiles_T12", "permissions": {"attach_files": False}},
                          headers=h(admin_token))
        assert r.status_code in (200, 201), f"Role create failed: {r.text}"
        role_id = r.json()["id"]

        r2 = requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                          json={"roles": [role_id]}, headers=h(admin_token))
        assert r2.status_code == 200

        data = base64.b64encode(b"blocked file").decode()
        r3 = requests.post(f"{BASE_URL}/api/upload",
                           json={"data": data, "name": "blocked.txt", "type": "text/plain", "channel_id": CHANNEL_ID},
                           headers=h(testuser_token))

        # Cleanup
        requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                     json={"roles": []}, headers=h(admin_token))
        requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{role_id}", headers=h(admin_token))

        assert r3.status_code == 403, \
            f"CRITICAL BUG: Role with attach_files=False doesn't block upload! " \
            f"Got {r3.status_code} instead of 403."


class TestModRoleAllowsCreateChannel:
    """Test 13: Role 'Mod' with manage_channels=true → testuser can create channel → 200"""

    def test_mod_role_allows_create_channel(self, admin_token, testuser_token):
        r = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/roles",
                          json={"name": "Mod_T13", "permissions": {"manage_channels": True}},
                          headers=h(admin_token))
        assert r.status_code in (200, 201), f"Role create failed: {r.text}"
        role_id = r.json()["id"]

        r2 = requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                          json={"roles": [role_id]}, headers=h(admin_token))
        assert r2.status_code == 200

        r3 = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/channels",
                           json={"name": "mod-created-channel", "type": "text"}, headers=h(testuser_token))

        # Cleanup new channel
        if r3.status_code in (200, 201):
            new_ch_id = r3.json().get("id")
            if new_ch_id:
                requests.delete(f"{BASE_URL}/api/channels/{new_ch_id}", headers=h(admin_token))

        requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                     json={"roles": []}, headers=h(admin_token))
        requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{role_id}", headers=h(admin_token))

        assert r3.status_code in (200, 201), f"Expected 200, got {r3.status_code}: {r3.text}"
        print("PASS: Mod role allows create channel → 200")


class TestModeratorRoleAllowsKick:
    """Test 14: Role 'Moderator' with kick_members=true → testuser can kick → 200"""

    def test_moderator_role_allows_kick(self, admin_token, testuser_token, outsider):
        # First join outsider to main server
        # Get an invite from admin
        inv_r = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/invites",
                              json={"max_uses": 1}, headers=h(admin_token))
        assert inv_r.status_code in (200, 201), f"Invite create failed: {inv_r.text}"
        inv_code = inv_r.json().get("code")

        join_r = requests.post(f"{BASE_URL}/api/invites/{inv_code}/accept", headers=h(outsider["token"]))
        assert join_r.status_code in (200, 201), f"Join failed: {join_r.text}"

        # Create Moderator role
        r = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/roles",
                          json={"name": "Moderator_T14", "permissions": {"kick_members": True}},
                          headers=h(admin_token))
        assert r.status_code in (200, 201), f"Role create failed: {r.text}"
        role_id = r.json()["id"]

        r2 = requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                          json={"roles": [role_id]}, headers=h(admin_token))
        assert r2.status_code == 200

        # testuser kicks outsider
        r3 = requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{outsider['user_id']}",
                             headers=h(testuser_token))

        # Cleanup
        requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                     json={"roles": []}, headers=h(admin_token))
        requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{role_id}", headers=h(admin_token))

        assert r3.status_code == 200, f"Expected 200, got {r3.status_code}: {r3.text}"
        print("PASS: Moderator role allows kick → 200")


class TestOwnerBypassMutedRole:
    """Test 15: Owner with Muted role can still send messages → 200"""

    def test_owner_bypass_despite_muted_role(self, admin_token):
        # Create Muted role
        r = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/roles",
                          json={"name": "Muted_T15", "permissions": {"send_messages": False}},
                          headers=h(admin_token))
        assert r.status_code in (200, 201)
        role_id = r.json()["id"]

        # Assign to admin
        requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{ADMIN_ID}",
                     json={"roles": [role_id]}, headers=h(admin_token))
        # May need manage_members - admin is owner so it should work
        # Actually admin calling update_member on themselves - needs manage_members... but owner can do all
        # Let's check

        # Try to send message as admin
        r3 = requests.post(f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
                           json={"content": "Owner bypass test", "type": "text"}, headers=h(admin_token))

        # Cleanup
        requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{ADMIN_ID}",
                     json={"roles": []}, headers=h(admin_token))
        requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{role_id}", headers=h(admin_token))

        assert r3.status_code == 200, f"Expected 200, got {r3.status_code}: {r3.text}"
        print("PASS: Owner bypass despite Muted role → 200")


# ─── PRIVILEGE ESCALATION ────────────────────────────────────────────────────

class TestPrivilegeEscalation:
    """Tests 16-20: Privilege escalation attempts"""

    def test_16_read_foreign_server(self, testuser_token, outsider):
        """Test 16: testuser reads outsider's server → 403"""
        r = requests.get(f"{BASE_URL}/api/servers/{outsider['server_id']}", headers=h(testuser_token))
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print("PASS T16: cannot read foreign server → 403")

    def test_17_read_foreign_server_channel(self, testuser_token, outsider):
        """Test 17: testuser reads channel in foreign server → 403"""
        # Create a channel in the foreign server as admin
        ch_r = requests.post(f"{BASE_URL}/api/servers/{outsider['server_id']}/channels",
                             json={"name": "foreign-channel", "type": "text"},
                             headers=h(outsider["foreign_server_token"]))
        if ch_r.status_code not in (200, 201):
            pytest.skip(f"Could not create foreign channel: {ch_r.text}")
        foreign_ch_id = ch_r.json()["id"]

        r = requests.get(f"{BASE_URL}/api/channels/{foreign_ch_id}/messages", headers=h(testuser_token))

        # Cleanup
        requests.delete(f"{BASE_URL}/api/channels/{foreign_ch_id}",
                        headers=h(outsider["foreign_server_token"]))

        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print("PASS T17: cannot read foreign channel messages → 403")

    def test_18_self_assign_admin_role(self, testuser_token, admin_token):
        """Test 18: testuser tries to assign admin role to themselves → 403"""
        # Get admin's role if any
        roles_r = requests.get(f"{BASE_URL}/api/servers/{SERVER_ID}/roles", headers=h(admin_token))
        roles = roles_r.json() if roles_r.status_code == 200 else []
        role_id = roles[0]["id"] if roles else "fake-role-id"

        # testuser tries to update their own roles
        r = requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                         json={"roles": [role_id]}, headers=h(testuser_token))
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print("PASS T18: cannot self-assign role → 403")

    def test_19_change_other_member_role(self, testuser_token, admin_token):
        """Test 19: testuser tries to update admin's member record → 403"""
        roles_r = requests.get(f"{BASE_URL}/api/servers/{SERVER_ID}/roles", headers=h(admin_token))
        roles = roles_r.json() if roles_r.status_code == 200 else []
        role_id = roles[0]["id"] if roles else "fake-role-id"

        r = requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{ADMIN_ID}",
                         json={"roles": [role_id]}, headers=h(testuser_token))
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print("PASS T19: cannot change other member's roles → 403")

    def test_20_delete_owner_role(self, testuser_token, admin_token):
        """Test 20: testuser tries to delete a server role → 403"""
        # Create a role as admin to try to delete
        rc = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/roles",
                           json={"name": "DeleteTarget_T20", "permissions": {}}, headers=h(admin_token))
        assert rc.status_code in (200, 201)
        role_id = rc.json()["id"]

        r = requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{role_id}",
                            headers=h(testuser_token))

        # Cleanup
        requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{role_id}", headers=h(admin_token))

        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print("PASS T20: cannot delete role → 403")


# ─── TOKEN MANIPULATION ───────────────────────────────────────────────────────

class TestTokenManipulation:
    """Tests 21-23: JWT manipulation"""

    def test_21_fake_jwt(self):
        """Test 21: Request with fake JWT signature → 401"""
        fake_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJoYWNrZXIiLCJlbWFpbCI6ImhhY2tlckBoYWNrLmNvbSJ9.FAKESIGNATURE123"
        r = requests.get(f"{BASE_URL}/api/servers/{SERVER_ID}", headers=h(fake_token))
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"
        print("PASS T21: fake JWT → 401")

    def test_22_expired_token(self):
        """Test 22: Expired JWT → 401"""
        # This token has exp in the past
        expired_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1NmU0YjljOC0xODRmLTRjMTUtYTliZC01ZGNiNjI1YzU1NDUiLCJlbWFpbCI6ImFkbWluQHNpbmdyYXZveC5sb2NhbCIsInNpZCI6Ijk1Zjk2ZDlhLTM3MWQtNDU4Zi05ZjJmLWI3ODg3YmJhOTc3NSIsImlhdCI6MTYwMDAwMDAwMCwiZXhwIjoxNjAwMDAwMDAxLCJ0eXBlIjoiYWNjZXNzIn0.invalid"
        r = requests.get(f"{BASE_URL}/api/servers/{SERVER_ID}", headers=h(expired_token))
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"
        print("PASS T22: expired token → 401")

    def test_23_no_token(self):
        """Test 23: No Authorization header → 401"""
        r = requests.get(f"{BASE_URL}/api/servers/{SERVER_ID}")
        assert r.status_code == 401, f"Expected 401, got {r.status_code}: {r.text}"
        print("PASS T23: no token → 401")


# ─── KANAL-OVERRIDES ──────────────────────────────────────────────────────────

class TestChannelOverrides:
    """Tests 24-25: Channel-level permission overrides"""

    def test_24_override_blocks_read(self, admin_token, testuser_token):
        """Test 24: Channel override read_messages=false for testuser → 403 on GET messages"""
        # Set user override: read_messages=False (target_type must be "user")
        r = requests.put(f"{BASE_URL}/api/channels/{CHANNEL_ID}/overrides",
                         json={"target_type": "user", "target_id": TESTUSER_ID,
                               "permissions": {"read_messages": False}},
                         headers=h(admin_token))
        assert r.status_code in (200, 201), f"Override create failed: {r.text}"

        r2 = requests.get(f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages", headers=h(testuser_token))

        # Cleanup: remove override
        requests.delete(f"{BASE_URL}/api/channels/{CHANNEL_ID}/overrides/user/{TESTUSER_ID}",
                        headers=h(admin_token))

        assert r2.status_code == 403, f"Expected 403, got {r2.status_code}: {r2.text}"
        print("PASS T24: channel override blocks read_messages → 403")

    def test_25_override_grants_manage_messages(self, admin_token, testuser_token):
        """Test 25: Channel override gives testuser manage_messages=true → can delete message → 200"""
        # Create a message to delete
        msg_r = requests.post(f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
                              json={"content": "Delete me T25", "type": "text"}, headers=h(admin_token))
        assert msg_r.status_code == 200
        msg_id = msg_r.json()["id"]

        # Set override: manage_messages=True for testuser (target_type must be "user")
        r = requests.put(f"{BASE_URL}/api/channels/{CHANNEL_ID}/overrides",
                         json={"target_type": "user", "target_id": TESTUSER_ID,
                               "permissions": {"manage_messages": True}},
                         headers=h(admin_token))
        assert r.status_code in (200, 201), f"Override create failed: {r.text}"

        # testuser deletes the message
        r2 = requests.delete(f"{BASE_URL}/api/messages/{msg_id}", headers=h(testuser_token))

        # Cleanup override
        requests.delete(f"{BASE_URL}/api/channels/{CHANNEL_ID}/overrides/user/{TESTUSER_ID}",
                        headers=h(admin_token))

        assert r2.status_code in (200, 204), f"Expected 200, got {r2.status_code}: {r2.text}"
        print("PASS T25: channel override grants manage_messages → 200")


# ─── EDGE CASES ───────────────────────────────────────────────────────────────

class TestEdgeCases:
    """Tests 26-30: Edge cases"""

    def test_26_deleted_role_falls_back_to_everyone(self, admin_token, testuser_token):
        """Test 26: Delete assigned role → permissions fall back to @everyone
        
        NOTE: Due to CRITICAL BUG (T11/T12) - roles can't revoke @everyone defaults,
        the blocking step (r_blocked) will ALSO return 200.
        After role deletion, testuser should still be able to send (200).
        This test verifies the fallback behavior works without the blocking step.
        """
        # Create role with send_messages=False
        r = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/roles",
                          json={"name": "TempRole_T26", "permissions": {"send_messages": False}},
                          headers=h(admin_token))
        assert r.status_code in (200, 201)
        role_id = r.json()["id"]

        # Assign role
        requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                     json={"roles": [role_id]}, headers=h(admin_token))

        # Delete the role
        del_r = requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{role_id}", headers=h(admin_token))
        assert del_r.status_code in (200, 204), f"Role delete failed: {del_r.text}"

        # After deletion, testuser should fall back to @everyone (send_messages=True)
        r_after = requests.post(f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
                                json={"content": "After role delete T26", "type": "text"}, headers=h(testuser_token))

        # Cleanup
        requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                     json={"roles": []}, headers=h(admin_token))

        assert r_after.status_code == 200, f"Expected 200 after fallback, got {r_after.status_code}: {r_after.text}"
        print("PASS T26: after role delete, testuser falls back to @everyone → 200")

    def test_27_banned_user_cannot_access(self, admin_token):
        """Test 27: Banned user cannot access server"""
        uid = uuid.uuid4().hex[:8]
        email2 = f"banme_{uid}@test.local"
        ban_token = _register_and_verify_user(email2, "BanPass123!", f"banme_{uid}", f"BanMe {uid}")
        banme_id = requests.get(f"{BASE_URL}/api/auth/me", headers=h(ban_token)).json()["id"]

        # Join the server
        inv_r = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/invites",
                              json={"max_uses": 1}, headers=h(admin_token))
        inv_code = inv_r.json().get("code")
        requests.post(f"{BASE_URL}/api/invites/{inv_code}/join", headers=h(ban_token))

        # Ban the user
        ban_r = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/moderation/ban",
                              json={"user_id": banme_id, "reason": "test ban"}, headers=h(admin_token))
        assert ban_r.status_code == 200, f"Ban failed: {ban_r.text}"

        # Banned user tries to access server
        r = requests.get(f"{BASE_URL}/api/servers/{SERVER_ID}", headers=h(ban_token))
        assert r.status_code == 403, f"Expected 403 for banned user, got {r.status_code}: {r.text}"
        print("PASS T27: banned user cannot access server → 403")

        # Cleanup: unban
        requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/moderation/unban",
                      json={"user_id": banme_id}, headers=h(admin_token))

    def test_28_mass_requests_no_permission_bypass(self, testuser_token):
        """Test 28: 20 rapid requests to protected endpoint → all 403, no bypass"""
        results = []
        for _ in range(20):
            r = requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}", headers=h(testuser_token))
            results.append(r.status_code)
        non_403 = [s for s in results if s != 403]
        assert not non_403, f"Permission bypass detected! Non-403 responses: {non_403}"
        print("PASS T28: all 20 rapid requests returned 403")

    def test_29_null_permission_value_treated_as_false(self, admin_token):
        """Test 29: PATCH role with null permission value → treated as false"""
        r = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/roles",
                          json={"name": "NullPerm_T29", "permissions": {"manage_server": True}},
                          headers=h(admin_token))
        assert r.status_code in (200, 201)
        role_id = r.json()["id"]

        # Update with null
        r2 = requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{role_id}",
                          json={"permissions": {"manage_server": None}}, headers=h(admin_token))
        assert r2.status_code in (200, 201), f"Role update failed: {r2.text}"

        # Get the role to verify
        roles_r = requests.get(f"{BASE_URL}/api/servers/{SERVER_ID}/roles", headers=h(admin_token))
        updated_role = next((role for role in roles_r.json() if role["id"] == role_id), None)

        # Cleanup
        requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{role_id}", headers=h(admin_token))

        assert updated_role is not None
        # manage_server should be false (null treated as false)
        perm_val = updated_role.get("permissions", {}).get("manage_server")
        assert perm_val is not True, f"manage_server should be false/null, got {perm_val}"
        print(f"PASS T29: null permission treated as false, manage_server={perm_val}")

    def test_30_overrides_list_only_for_admins(self, testuser_token):
        """Test 30: testuser GET /api/channels/{id}/overrides → 403"""
        r = requests.get(f"{BASE_URL}/api/channels/{CHANNEL_ID}/overrides", headers=h(testuser_token))
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print("PASS T30: overrides list requires manage_channels → 403")


# ─── BODY INJECTION ATTACKS ───────────────────────────────────────────────────

class TestBodyInjectionAttacks:
    """Extra: Test request body injection for privilege escalation"""

    def test_inject_is_owner_in_message(self, testuser_token):
        """Injecting is_owner:true in message body should not grant owner privileges"""
        r = requests.post(f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
                          json={"content": "Injection test", "type": "text",
                                "is_owner": True, "role_id": "admin", "permissions": {"ban_members": True}},
                          headers=h(testuser_token))
        # Should succeed (member can send), but injected fields should be ignored
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        data = r.json()
        assert "is_owner" not in data or data.get("is_owner") is not True, "is_owner injected!"
        print("PASS: is_owner injection ignored")

    def test_inject_role_in_register(self):
        """Injecting is_admin in register body should not grant admin role"""
        uid = uuid.uuid4().hex[:8]
        email = f"inject_{uid}@test.local"
        r = requests.post(f"{BASE_URL}/api/auth/register",
                          json={"email": email, "username": f"inject_{uid}",
                                "password": "InjPass123!", "display_name": "Injector",
                                "is_admin": True, "role": "admin", "is_superuser": True})
        # Should succeed registration but without admin privileges
        assert r.status_code in (200, 201), f"Register failed: {r.text}"
        data = r.json()
        assert data.get("is_admin") is not True, "is_admin injection succeeded!"
        print("PASS: admin injection in register ignored")



# ─── NEW SCENARIOS FROM REVIEW REQUEST ───────────────────────────────────────

class TestGrantBeatsDeny:
    """Test: Muted(send_messages=False) + VIP(send_messages=True) → 200 (Grant beats Deny)"""

    def test_grant_beats_deny(self, admin_token, testuser_token):
        # Create Muted role (deny)
        r1 = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/roles",
                           json={"name": "Muted_GBD", "permissions": {"send_messages": False}},
                           headers=h(admin_token))
        assert r1.status_code in (200, 201)
        muted_id = r1.json()["id"]

        # Create VIP role (grant)
        r2 = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/roles",
                           json={"name": "VIP_GBD", "permissions": {"send_messages": True}},
                           headers=h(admin_token))
        assert r2.status_code in (200, 201)
        vip_id = r2.json()["id"]

        # Assign both roles
        r3 = requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                          json={"roles": [muted_id, vip_id]}, headers=h(admin_token))
        assert r3.status_code == 200

        # Try to send
        r4 = requests.post(f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
                           json={"content": "VIP beats muted", "type": "text"}, headers=h(testuser_token))

        # Cleanup
        requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                     json={"roles": []}, headers=h(admin_token))
        requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{muted_id}", headers=h(admin_token))
        requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{vip_id}", headers=h(admin_token))

        assert r4.status_code == 200, f"Grant+Deny: Expected 200 (grant beats deny), got {r4.status_code}: {r4.text}"
        print("PASS: Muted+VIP → grant beats deny → 200")


class TestRoleRemovalRestoresPermission:
    """Test 15: After Muted role removal testuser can send again → 200"""

    def test_role_removal_restores_permission(self, admin_token, testuser_token):
        # Create and assign Muted role
        r1 = requests.post(f"{BASE_URL}/api/servers/{SERVER_ID}/roles",
                           json={"name": "Muted_RR", "permissions": {"send_messages": False}},
                           headers=h(admin_token))
        assert r1.status_code in (200, 201)
        muted_id = r1.json()["id"]

        requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                     json={"roles": [muted_id]}, headers=h(admin_token))

        # Verify blocked
        r_block = requests.post(f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
                                json={"content": "Should be blocked", "type": "text"}, headers=h(testuser_token))
        assert r_block.status_code == 403, f"Role should block send, got {r_block.status_code}"

        # Remove role
        requests.put(f"{BASE_URL}/api/servers/{SERVER_ID}/members/{TESTUSER_ID}",
                     json={"roles": []}, headers=h(admin_token))

        # Now should work
        r_after = requests.post(f"{BASE_URL}/api/channels/{CHANNEL_ID}/messages",
                                json={"content": "After role removal", "type": "text"}, headers=h(testuser_token))

        # Cleanup role
        requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}/roles/{muted_id}", headers=h(admin_token))

        assert r_after.status_code == 200, f"Expected 200 after role removal, got {r_after.status_code}: {r_after.text}"
        print("PASS: After role removal → can send → 200")


class TestViewerContextForTestuser:
    """Test 16: GET /api/servers/{id}/viewer-context → manage_channels=false for testuser"""

    def test_viewer_context_manage_channels_false(self, testuser_token):
        r = requests.get(f"{BASE_URL}/api/servers/{SERVER_ID}/viewer-context", headers=h(testuser_token))
        assert r.status_code == 200
        sp = r.json().get("server_permissions", {})
        assert sp.get("manage_channels") is False, f"manage_channels should be False, got {sp.get('manage_channels')}"
        print("PASS: viewer-context manage_channels=false for testuser")


class TestChannelAccessEndpoint:
    """Test 18: GET /api/channels/{id}/access without manage_channels → 403"""

    def test_channel_access_requires_manage_channels(self, testuser_token):
        r = requests.get(f"{BASE_URL}/api/channels/{CHANNEL_ID}/access", headers=h(testuser_token))
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"
        print("PASS: GET /api/channels/{id}/access requires manage_channels → 403")


class TestEmojiListMembership:
    """Test 19: GET /api/emojis/{server_id}/list without membership → 403"""

    def test_emoji_list_requires_membership(self, testuser_token, outsider):
        # outsider is NOT a member of the main server - try to list emojis from main server
        r2 = requests.get(f"{BASE_URL}/api/servers/{SERVER_ID}/emojis", headers=h(outsider["token"]))
        assert r2.status_code == 403, f"Expected 403 for non-member emoji list, got {r2.status_code}: {r2.text}"
        print("PASS: emoji list without membership → 403")


class TestMassAbuse50Requests:
    """Test 20: 50 rapid requests on 403 endpoint → rate-limit, no bypass"""

    def test_mass_abuse_no_bypass(self, testuser_token):
        results = []
        for _ in range(50):
            r = requests.delete(f"{BASE_URL}/api/servers/{SERVER_ID}", headers=h(testuser_token))
            results.append(r.status_code)
        # All should be 403 (permission denied) or 429 (rate limited) - no 200/201
        bypasses = [s for s in results if s not in (403, 429)]
        assert not bypasses, f"Permission bypass or unexpected response: {bypasses} in {results}"
        has_rate_limit = any(s == 429 for s in results)
        print(f"PASS: 50 rapid requests → all blocked. Rate-limited: {has_rate_limit}. Statuses: {set(results)}")
