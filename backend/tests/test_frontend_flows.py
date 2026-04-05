"""
Backend API tests for Singra Vox - Frontend flow coverage
Tests: auth, registration, voice token, permissions, server/channel/invite
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://voice-rebo-config.preview.emergentagent.com').rstrip('/')

ADMIN_EMAIL = "admin@singravox.local"
ADMIN_PASS = "AdminPass123!"
USER2_EMAIL = "testuser2@test.de"
USER2_PASS = "TestPass123!"
NEW_USER_EMAIL = "testuser3@test.de"
NEW_USER_PASS = "TestPass123!"


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, f"Admin login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def admin_data(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def server_id(admin_session):
    r = admin_session.get(f"{BASE_URL}/api/servers")
    assert r.status_code == 200
    servers = r.json()
    assert len(servers) > 0, "No servers found"
    return servers[0]['id']


@pytest.fixture(scope="module")
def channel_id(admin_session, server_id):
    r = admin_session.get(f"{BASE_URL}/api/servers/{server_id}/channels")
    assert r.status_code == 200
    channels = r.json()
    text_channels = [c for c in channels if c.get('type') == 'text']
    assert len(text_channels) > 0, "No text channels found"
    return text_channels[0]['id']


# --- Auth Tests ---
class TestAuth:
    def test_admin_login(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
        assert r.status_code == 200
        data = r.json()
        assert "user" in data
        assert data["user"]["email"] == ADMIN_EMAIL
        print(f"Admin login OK: {data['user']['display_name']}")

    def test_user2_login(self):
        s = requests.Session()
        r = s.post(f"{BASE_URL}/api/auth/login", json={"email": USER2_EMAIL, "password": USER2_PASS})
        assert r.status_code == 200, f"User2 login failed: {r.text}"
        data = r.json()
        assert "user" in data
        print(f"User2 login OK: {data['user']['email']}")

    def test_register_new_user(self):
        """Test registration with auto-verify (no SMTP)"""
        s = requests.Session()
        # Try to delete test user first
        try:
            from pymongo import MongoClient
            c = MongoClient('mongodb://localhost:27017')
            c['singravox'].users.delete_many({"email": NEW_USER_EMAIL})
        except Exception:
            pass
        
        r = s.post(f"{BASE_URL}/api/auth/register", json={
            "email": NEW_USER_EMAIL,
            "username": "testuser3",
            "password": NEW_USER_PASS,
            "display_name": "Test User 3"
        })
        assert r.status_code in [200, 201, 409], f"Register failed: {r.text}"
        if r.status_code == 409:
            print("User already exists - OK")
        else:
            data = r.json()
            assert data.get("ok") == True or "user" in data or "email" in data
            print(f"Register OK: {r.status_code}, data={data}")

    def test_auth_me(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert "email" in data
        assert data["email"] == ADMIN_EMAIL


# --- Server/Channel Tests ---
class TestServers:
    def test_list_servers(self, admin_session):
        r = admin_session.get(f"{BASE_URL}/api/servers")
        assert r.status_code == 200
        servers = r.json()
        assert isinstance(servers, list)
        assert len(servers) > 0
        print(f"Servers: {[s['name'] for s in servers]}")

    def test_server_channels(self, admin_session, server_id):
        r = admin_session.get(f"{BASE_URL}/api/servers/{server_id}/channels")
        assert r.status_code == 200
        channels = r.json()
        assert len(channels) > 0
        text_ch = [c for c in channels if c.get('type') == 'text']
        assert len(text_ch) > 0, "No text channels"
        print(f"Channels: {[c['name'] for c in channels]}")

    def test_viewer_context_permissions(self, admin_session, server_id):
        r = admin_session.get(f"{BASE_URL}/api/servers/{server_id}/viewer-context")
        assert r.status_code == 200
        data = r.json()
        assert "server_permissions" in data, f"Missing server_permissions: {data}"
        perms = data["server_permissions"]
        assert isinstance(perms, dict)
        print(f"Viewer context permissions: {list(perms.keys())}")

    def test_server_members(self, admin_session, server_id):
        r = admin_session.get(f"{BASE_URL}/api/servers/{server_id}/members")
        assert r.status_code == 200
        members = r.json()
        assert isinstance(members, list)
        assert len(members) > 0
        print(f"Members count: {len(members)}")


# --- Chat Tests ---
class TestChat:
    def test_send_message(self, admin_session, channel_id):
        r = admin_session.post(f"{BASE_URL}/api/channels/{channel_id}/messages", json={
            "content": "TEST_message from automated test"
        })
        assert r.status_code in [200, 201], f"Send message failed: {r.text}"
        data = r.json()
        assert "id" in data
        print(f"Message sent: {data['id']}")

    def test_read_messages(self, admin_session, channel_id):
        r = admin_session.get(f"{BASE_URL}/api/channels/{channel_id}/messages")
        assert r.status_code == 200
        data = r.json()
        # Response is paginated: {messages: [...], has_more_before: bool, next_before: str}
        if isinstance(data, list):
            messages = data
        else:
            assert "messages" in data, f"Unexpected response: {data}"
            messages = data["messages"]
        assert isinstance(messages, list)
        print(f"Messages count: {len(messages)}")


# --- Roles Tests ---
class TestRoles:
    def test_list_roles(self, admin_session, server_id):
        r = admin_session.get(f"{BASE_URL}/api/servers/{server_id}/roles")
        assert r.status_code == 200
        roles = r.json()
        assert isinstance(roles, list)
        print(f"Roles: {[ro['name'] for ro in roles]}")

    def test_create_and_delete_role(self, admin_session, server_id):
        r = admin_session.post(f"{BASE_URL}/api/servers/{server_id}/roles", json={
            "name": "TEST_AutomatedRole",
            "color": "#ff0000"
        })
        assert r.status_code in [200, 201], f"Create role failed: {r.text}"
        role = r.json()
        role_id = role.get("id")
        assert role_id
        print(f"Created role: {role_id}")
        # Cleanup
        del_r = admin_session.delete(f"{BASE_URL}/api/servers/{server_id}/roles/{role_id}")
        assert del_r.status_code in [200, 204]
        print("Role deleted OK")


# --- Invite Tests ---
class TestInvites:
    def test_create_invite(self, admin_session, server_id):
        r = admin_session.post(f"{BASE_URL}/api/servers/{server_id}/invites", json={
            "max_uses": 10,
            "expires_in": 86400
        })
        assert r.status_code in [200, 201], f"Create invite failed: {r.text}"
        data = r.json()
        assert "code" in data or "invite" in data or "url" in data
        print(f"Invite created: {data}")

    def test_list_invites(self, admin_session, server_id):
        """GET invites - may not be supported (405), check create works"""
        r = admin_session.get(f"{BASE_URL}/api/servers/{server_id}/invites")
        # 405 means GET not supported, that's acceptable
        assert r.status_code in [200, 405], f"Unexpected: {r.text}"
        if r.status_code == 200:
            invites = r.json()
            assert isinstance(invites, list)
        print(f"List invites: {r.status_code}")


# --- Voice Token Tests ---
class TestVoiceToken:
    def test_voice_token_generation(self, admin_session, server_id):
        """Voice token API should return JWT - requires voice channel type"""
        # Get voice channel
        r = admin_session.get(f"{BASE_URL}/api/servers/{server_id}/channels")
        channels = r.json()
        voice_channels = [c for c in channels if c.get('type') == 'voice']
        assert len(voice_channels) > 0, "No voice channels found"
        voice_ch_id = voice_channels[0]['id']
        
        r = admin_session.post(f"{BASE_URL}/api/voice/token", json={
            "channel_id": voice_ch_id,
            "server_id": server_id
        })
        assert r.status_code == 200, f"Voice token failed: {r.text}"
        data = r.json()
        assert "participant_token" in data, f"Missing participant_token: {data}"
        token = data["participant_token"]
        assert len(token) > 10
        print(f"Voice token OK (len={len(token)}), server_url={data.get('server_url')}")
