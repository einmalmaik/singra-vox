#!/usr/bin/env python3
"""
SovereignVoice Backend API Testing
Tests all API endpoints for the Discord-like communication platform
"""
import requests
import sys
import json
from datetime import datetime

class SovereignVoiceAPITester:
    def __init__(self, base_url="https://sovereign-voice.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.user_id = None
        self.server_id = None
        self.channel_id = None
        self.voice_channel_id = None
        self.role_id = None
        self.invite_code = None
        self.tests_run = 0
        self.tests_passed = 0
        self.session = requests.Session()

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        url = f"{self.base_url}/api/{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        if self.token:
            test_headers['Authorization'] = f'Bearer {self.token}'
        if headers:
            test_headers.update(headers)

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {method} {url}")
        
        try:
            if method == 'GET':
                response = self.session.get(url, headers=test_headers)
            elif method == 'POST':
                response = self.session.post(url, json=data, headers=test_headers)
            elif method == 'PUT':
                response = self.session.put(url, json=data, headers=test_headers)
            elif method == 'DELETE':
                response = self.session.delete(url, headers=test_headers)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return True, response.json() if response.content else {}
                except:
                    return True, {}
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Error: {error_data}")
                except:
                    print(f"   Response: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_health(self):
        """Test health endpoint"""
        success, response = self.run_test(
            "Health Check",
            "GET",
            "health",
            200
        )
        return success

    def test_setup_status(self):
        """Test setup status endpoint"""
        success, response = self.run_test(
            "Setup Status",
            "GET",
            "setup/status",
            200
        )
        if success:
            print(f"   Setup info: {response}")
        return success

    def test_login(self, email, password):
        """Test login and get token"""
        success, response = self.run_test(
            "Admin Login",
            "POST",
            "auth/login",
            200,
            data={"email": email, "password": password}
        )
        if success and 'access_token' in response:
            self.token = response['access_token']
            self.user_id = response.get('user', {}).get('id')
            print(f"   Token obtained, User ID: {self.user_id}")
            return True
        return False

    def test_auth_me(self):
        """Test current user endpoint"""
        success, response = self.run_test(
            "Get Current User",
            "GET",
            "auth/me",
            200
        )
        return success

    def test_get_servers(self):
        """Test get servers endpoint"""
        success, response = self.run_test(
            "Get Servers",
            "GET",
            "servers",
            200
        )
        if success and response:
            self.server_id = response[0]['id']
            print(f"   Found server: {response[0]['name']} (ID: {self.server_id})")
        return success

    def test_create_server(self):
        """Test create server endpoint"""
        server_name = f"Test Server {datetime.now().strftime('%H%M%S')}"
        success, response = self.run_test(
            "Create Server",
            "POST",
            "servers",
            200,
            data={"name": server_name, "description": "Test server for API testing"}
        )
        if success and response:
            test_server_id = response.get('id')
            print(f"   Created server: {server_name} (ID: {test_server_id})")
        return success

    def test_get_channels(self):
        """Test get channels endpoint"""
        if not self.server_id:
            print("❌ No server ID available for channel test")
            return False
            
        success, response = self.run_test(
            "Get Channels",
            "GET",
            f"servers/{self.server_id}/channels",
            200
        )
        if success and response:
            # Find text and voice channels
            for channel in response:
                if channel['type'] == 'text' and not self.channel_id:
                    self.channel_id = channel['id']
                    print(f"   Found text channel: {channel['name']} (ID: {self.channel_id})")
                elif channel['type'] == 'voice' and not self.voice_channel_id:
                    self.voice_channel_id = channel['id']
                    print(f"   Found voice channel: {channel['name']} (ID: {self.voice_channel_id})")
        return success

    def test_create_text_channel(self):
        """Test create text channel endpoint"""
        if not self.server_id:
            print("❌ No server ID available for channel creation")
            return False
            
        channel_name = f"test-channel-{datetime.now().strftime('%H%M%S')}"
        success, response = self.run_test(
            "Create Text Channel",
            "POST",
            f"servers/{self.server_id}/channels",
            200,
            data={"name": channel_name, "type": "text", "topic": "Test channel"}
        )
        if success and response:
            print(f"   Created channel: {channel_name} (ID: {response.get('id')})")
        return success

    def test_create_voice_channel(self):
        """Test create voice channel endpoint"""
        if not self.server_id:
            print("❌ No server ID available for voice channel creation")
            return False
            
        channel_name = f"Test Voice {datetime.now().strftime('%H%M%S')}"
        success, response = self.run_test(
            "Create Voice Channel",
            "POST",
            f"servers/{self.server_id}/channels",
            200,
            data={"name": channel_name, "type": "voice", "topic": "Test voice channel"}
        )
        if success and response:
            test_voice_id = response.get('id')
            print(f"   Created voice channel: {channel_name} (ID: {test_voice_id})")
        return success

    def test_send_message(self):
        """Test send message endpoint"""
        if not self.channel_id:
            print("❌ No channel ID available for message test")
            return False
            
        success, response = self.run_test(
            "Send Message",
            "POST",
            f"channels/{self.channel_id}/messages",
            200,
            data={"content": f"Test message from API at {datetime.now().strftime('%H:%M:%S')}"}
        )
        if success and response:
            print(f"   Message sent: {response.get('content')}")
        return success

    def test_get_messages(self):
        """Test get messages endpoint"""
        if not self.channel_id:
            print("❌ No channel ID available for messages test")
            return False
            
        success, response = self.run_test(
            "Get Messages",
            "GET",
            f"channels/{self.channel_id}/messages",
            200
        )
        if success:
            print(f"   Retrieved {len(response)} messages")
        return success

    def test_get_members(self):
        """Test get server members endpoint"""
        if not self.server_id:
            print("❌ No server ID available for members test")
            return False
            
        success, response = self.run_test(
            "Get Server Members",
            "GET",
            f"servers/{self.server_id}/members",
            200
        )
        if success:
            print(f"   Found {len(response)} members")
        return success

    def test_get_roles(self):
        """Test get server roles endpoint"""
        if not self.server_id:
            print("❌ No server ID available for roles test")
            return False
            
        success, response = self.run_test(
            "Get Server Roles",
            "GET",
            f"servers/{self.server_id}/roles",
            200
        )
        if success and response:
            # Find a non-default role for testing
            for role in response:
                if not role.get('is_default'):
                    self.role_id = role['id']
                    print(f"   Found role: {role['name']} (ID: {self.role_id})")
                    break
            print(f"   Found {len(response)} roles")
        return success

    def test_create_role(self):
        """Test create role endpoint"""
        if not self.server_id:
            print("❌ No server ID available for role creation")
            return False
            
        role_name = f"Test Role {datetime.now().strftime('%H%M%S')}"
        success, response = self.run_test(
            "Create Role",
            "POST",
            f"servers/{self.server_id}/roles",
            200,
            data={
                "name": role_name,
                "color": "#FF5733",
                "permissions": {"send_messages": True, "read_messages": True}
            }
        )
        if success and response:
            print(f"   Created role: {role_name} (ID: {response.get('id')})")
        return success

    def test_create_invite(self):
        """Test create invite endpoint"""
        if not self.server_id:
            print("❌ No server ID available for invite creation")
            return False
            
        success, response = self.run_test(
            "Create Invite",
            "POST",
            f"servers/{self.server_id}/invites",
            200,
            data={"max_uses": 10, "expires_hours": 24}
        )
        if success and response:
            self.invite_code = response.get('code')
            print(f"   Created invite: {self.invite_code}")
        return success

    def test_voice_join(self):
        """Test voice channel join endpoint (UI only)"""
        if not self.server_id or not self.voice_channel_id:
            print("❌ No server/voice channel ID available for voice join test")
            return False
            
        success, response = self.run_test(
            "Voice Channel Join",
            "POST",
            f"servers/{self.server_id}/voice/{self.voice_channel_id}/join",
            200
        )
        if success:
            print("   Voice join successful (UI status only)")
        return success

    def test_voice_state_update(self):
        """Test voice state update endpoint"""
        if not self.server_id or not self.voice_channel_id:
            print("❌ No server/voice channel ID available for voice state test")
            return False
            
        success, response = self.run_test(
            "Voice State Update",
            "PUT",
            f"servers/{self.server_id}/voice/{self.voice_channel_id}/state",
            200,
            data={"is_muted": True, "is_deafened": False}
        )
        if success:
            print("   Voice state updated (muted)")
        return success

    def test_voice_leave(self):
        """Test voice channel leave endpoint"""
        if not self.server_id or not self.voice_channel_id:
            print("❌ No server/voice channel ID available for voice leave test")
            return False
            
        success, response = self.run_test(
            "Voice Channel Leave",
            "POST",
            f"servers/{self.server_id}/voice/{self.voice_channel_id}/leave",
            200
        )
        if success:
            print("   Voice leave successful")
        return success

    def test_logout(self):
        """Test logout endpoint"""
        success, response = self.run_test(
            "Logout",
            "POST",
            "auth/logout",
            200
        )
        if success:
            self.token = None
            print("   Logged out successfully")
        return success

def main():
    print("🚀 Starting SovereignVoice Backend API Tests")
    print("=" * 50)
    
    # Setup
    tester = SovereignVoiceAPITester()
    admin_email = "admin@sovereignvoice.local"
    admin_password = "SV_Admin_2024!"

    # Test sequence
    tests = [
        ("Health Check", tester.test_health),
        ("Setup Status", tester.test_setup_status),
        ("Admin Login", lambda: tester.test_login(admin_email, admin_password)),
        ("Get Current User", tester.test_auth_me),
        ("Get Servers", tester.test_get_servers),
        ("Get Channels", tester.test_get_channels),
        ("Send Message", tester.test_send_message),
        ("Get Messages", tester.test_get_messages),
        ("Create Text Channel", tester.test_create_text_channel),
        ("Create Voice Channel", tester.test_create_voice_channel),
        ("Get Server Members", tester.test_get_members),
        ("Get Server Roles", tester.test_get_roles),
        ("Create Role", tester.test_create_role),
        ("Create Invite", tester.test_create_invite),
        ("Voice Join", tester.test_voice_join),
        ("Voice State Update", tester.test_voice_state_update),
        ("Voice Leave", tester.test_voice_leave),
        ("Create Server", tester.test_create_server),
        ("Logout", tester.test_logout),
    ]

    # Run all tests
    failed_tests = []
    for test_name, test_func in tests:
        try:
            if not test_func():
                failed_tests.append(test_name)
        except Exception as e:
            print(f"❌ {test_name} - Exception: {str(e)}")
            failed_tests.append(test_name)

    # Print results
    print("\n" + "=" * 50)
    print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} passed")
    
    if failed_tests:
        print(f"❌ Failed tests: {', '.join(failed_tests)}")
        return 1
    else:
        print("✅ All tests passed!")
        return 0

if __name__ == "__main__":
    sys.exit(main())