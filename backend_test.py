#!/usr/bin/env python3
"""
Singra Vox (SovereignVoice) Backend API Testing - Phase 2
Tests all API endpoints including Phase 2 features: threads, search, unread tracking,
file uploads, E2EE key management, group DMs, channel overrides, temp rooms, edit history
"""
import requests
import sys
import json
import base64
from datetime import datetime

class SingraVoxAPITester:
    def __init__(self, base_url="https://sovereign-voice.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.user_id = None
        self.server_id = None
        self.channel_id = None
        self.voice_channel_id = None
        self.role_id = None
        self.invite_code = None
        self.message_id = None  # For thread testing
        self.file_id = None     # For file upload testing
        self.group_id = None    # For group DM testing
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
        """Test health endpoint - should return 'Singra Vox'"""
        success, response = self.run_test(
            "Health Check",
            "GET",
            "health",
            200
        )
        if success and response.get('service') == 'Singra Vox':
            print(f"   ✅ Service name correct: {response.get('service')}")
            return True
        elif success:
            print(f"   ⚠️  Service name: {response.get('service')} (expected 'Singra Vox')")
            return False
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

    # ============================================================
    # PHASE 2 TESTS
    # ============================================================
    
    def test_send_message_with_mentions(self):
        """Test send message with @mentions"""
        if not self.channel_id:
            print("❌ No channel ID available for mention test")
            return False
            
        success, response = self.run_test(
            "Send Message with @mentions",
            "POST",
            f"channels/{self.channel_id}/messages",
            200,
            data={"content": f"Hello @admin, this is a test message with mentions at {datetime.now().strftime('%H:%M:%S')}"}
        )
        if success and response:
            self.message_id = response.get('id')  # Store for thread testing
            print(f"   Message with mentions sent: {response.get('content')}")
            if response.get('mention_ids'):
                print(f"   Mentions detected: {len(response.get('mention_ids'))} users")
        return success

    def test_search_messages(self):
        """Test message search endpoint"""
        success, response = self.run_test(
            "Search Messages",
            "GET",
            f"search?q=test&server_id={self.server_id}",
            200
        )
        if success:
            print(f"   Found {len(response)} search results")
        return success

    def test_get_unread(self):
        """Test get unread counts endpoint"""
        success, response = self.run_test(
            "Get Unread Counts",
            "GET",
            "unread",
            200
        )
        if success:
            channels = response.get('channels', {})
            dm_total = response.get('dm_total', 0)
            print(f"   Unread channels: {len(channels)}, DM unread: {dm_total}")
        return success

    def test_mark_channel_read(self):
        """Test mark channel as read endpoint"""
        if not self.channel_id:
            print("❌ No channel ID available for mark read test")
            return False
            
        success, response = self.run_test(
            "Mark Channel Read",
            "POST",
            f"channels/{self.channel_id}/read",
            200
        )
        if success:
            print("   Channel marked as read")
        return success

    def test_file_upload(self):
        """Test file upload endpoint"""
        # Create a small test file (base64 encoded)
        test_content = "This is a test file for Singra Vox file upload testing"
        test_data = base64.b64encode(test_content.encode()).decode()
        
        success, response = self.run_test(
            "File Upload",
            "POST",
            "upload",
            200,
            data={
                "data": test_data,
                "name": "test_file.txt",
                "type": "text/plain"
            }
        )
        if success and response:
            self.file_id = response.get('id')
            print(f"   File uploaded: {response.get('name')} (ID: {self.file_id})")
        return success

    def test_file_retrieval(self):
        """Test file retrieval endpoint"""
        if not self.file_id:
            print("❌ No file ID available for retrieval test")
            return False
            
        # Use requests directly for file download
        url = f"{self.base_url}/api/files/{self.file_id}"
        headers = {'Authorization': f'Bearer {self.token}'} if self.token else {}
        
        self.tests_run += 1
        print(f"\n🔍 Testing File Retrieval...")
        print(f"   URL: GET {url}")
        
        try:
            response = self.session.get(url, headers=headers)
            if response.status_code == 200:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                print(f"   File content retrieved: {len(response.content)} bytes")
                return True
            else:
                print(f"❌ Failed - Expected 200, got {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False

    def test_thread_reply(self):
        """Test thread reply endpoint"""
        if not self.channel_id or not self.message_id:
            print("❌ No channel/message ID available for thread reply test")
            return False
            
        success, response = self.run_test(
            "Thread Reply",
            "POST",
            f"channels/{self.channel_id}/messages/{self.message_id}/reply",
            200,
            data={"content": f"This is a thread reply at {datetime.now().strftime('%H:%M:%S')}"}
        )
        if success and response:
            print(f"   Thread reply sent: {response.get('content')}")
        return success

    def test_get_thread(self):
        """Test get thread endpoint"""
        if not self.message_id:
            print("❌ No message ID available for get thread test")
            return False
            
        success, response = self.run_test(
            "Get Thread",
            "GET",
            f"messages/{self.message_id}/thread",
            200
        )
        if success and response:
            parent = response.get('parent', {})
            replies = response.get('replies', [])
            print(f"   Thread loaded: parent message + {len(replies)} replies")
        return success

    def test_upload_e2ee_keys(self):
        """Test E2EE key bundle upload endpoint"""
        # Mock key data (in real implementation these would be actual crypto keys)
        success, response = self.run_test(
            "Upload E2EE Key Bundle",
            "POST",
            "keys/bundle",
            200,
            data={
                "identity_key": "mock_identity_key_data",
                "signed_pre_key": "mock_signed_pre_key_data",
                "one_time_pre_keys": ["mock_otp_key_1", "mock_otp_key_2"]
            }
        )
        if success:
            print("   E2EE key bundle uploaded")
        return success

    def test_get_e2ee_keys(self):
        """Test E2EE key bundle retrieval endpoint"""
        if not self.user_id:
            print("❌ No user ID available for E2EE key retrieval test")
            return False
            
        success, response = self.run_test(
            "Get E2EE Key Bundle",
            "GET",
            f"keys/{self.user_id}/bundle",
            200
        )
        if success and response:
            identity_key = response.get('identity_key')
            signed_pre_key = response.get('signed_pre_key')
            one_time_pre_key = response.get('one_time_pre_key')
            print(f"   E2EE keys retrieved: identity={bool(identity_key)}, signed_pre={bool(signed_pre_key)}, otp={bool(one_time_pre_key)}")
        return success

    def test_create_group_dm(self):
        """Test create group DM endpoint"""
        success, response = self.run_test(
            "Create Group DM",
            "POST",
            "groups",
            200,
            data={
                "name": f"Test Group {datetime.now().strftime('%H%M%S')}",
                "member_ids": []  # Just the creator for now
            }
        )
        if success and response:
            self.group_id = response.get('id')
            print(f"   Group DM created: {response.get('name')} (ID: {self.group_id})")
        return success

    def test_list_group_dms(self):
        """Test list group DMs endpoint"""
        success, response = self.run_test(
            "List Group DMs",
            "GET",
            "groups",
            200
        )
        if success:
            print(f"   Found {len(response)} group DMs")
        return success

    def test_send_group_message(self):
        """Test send group message endpoint"""
        if not self.group_id:
            print("❌ No group ID available for group message test")
            return False
            
        success, response = self.run_test(
            "Send Group Message",
            "POST",
            f"groups/{self.group_id}/messages",
            200,
            data={"content": f"Test group message at {datetime.now().strftime('%H:%M:%S')}"}
        )
        if success and response:
            print(f"   Group message sent: {response.get('content')}")
        return success

    def test_channel_overrides(self):
        """Test channel permission overrides endpoint"""
        if not self.channel_id or not self.role_id:
            print("❌ No channel/role ID available for override test")
            return False
            
        success, response = self.run_test(
            "Set Channel Override",
            "PUT",
            f"channels/{self.channel_id}/overrides",
            200,
            data={
                "target_type": "role",
                "target_id": self.role_id,
                "permissions": {"send_messages": False, "read_messages": True}
            }
        )
        if success:
            print("   Channel permission override set")
        return success

    def test_create_temp_channel(self):
        """Test create temporary channel endpoint"""
        if not self.server_id:
            print("❌ No server ID available for temp channel test")
            return False
            
        success, response = self.run_test(
            "Create Temp Channel",
            "POST",
            f"servers/{self.server_id}/channels/temp",
            200,
            data={
                "name": f"temp-{datetime.now().strftime('%H%M%S')}",
                "type": "text",
                "topic": "Temporary channel for testing"
            }
        )
        if success and response:
            print(f"   Temp channel created: {response.get('name')} (ID: {response.get('id')})")
        return success

    def test_edit_message_and_revisions(self):
        """Test message editing and revision history"""
        if not self.message_id:
            print("❌ No message ID available for edit test")
            return False
            
        # First edit the message
        success, response = self.run_test(
            "Edit Message",
            "PUT",
            f"messages/{self.message_id}",
            200,
            data={"content": f"EDITED: This message was edited at {datetime.now().strftime('%H:%M:%S')}"}
        )
        if not success:
            return False
            
        print("   Message edited successfully")
        
        # Then check revision history
        success, response = self.run_test(
            "Get Message Revisions",
            "GET",
            f"messages/{self.message_id}/revisions",
            200
        )
        if success:
            print(f"   Found {len(response)} message revisions")
        return success

def main():
    print("🚀 Starting Singra Vox (SovereignVoice) Backend API Tests - Phase 2")
    print("=" * 60)
    
    # Setup
    tester = SingraVoxAPITester()
    admin_email = "admin@sovereignvoice.local"
    admin_password = "SV_Admin_2024!"

    # Test sequence - Phase 1 + Phase 2
    tests = [
        # Phase 1 Core Tests
        ("Health Check (Singra Vox)", tester.test_health),
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
        
        # Phase 2 New Features
        ("Send Message with @mentions", tester.test_send_message_with_mentions),
        ("Search Messages", tester.test_search_messages),
        ("Get Unread Counts", tester.test_get_unread),
        ("Mark Channel Read", tester.test_mark_channel_read),
        ("File Upload", tester.test_file_upload),
        ("File Retrieval", tester.test_file_retrieval),
        ("Thread Reply", tester.test_thread_reply),
        ("Get Thread", tester.test_get_thread),
        ("Upload E2EE Keys", tester.test_upload_e2ee_keys),
        ("Get E2EE Keys", tester.test_get_e2ee_keys),
        ("Create Group DM", tester.test_create_group_dm),
        ("List Group DMs", tester.test_list_group_dms),
        ("Send Group Message", tester.test_send_group_message),
        ("Channel Overrides", tester.test_channel_overrides),
        ("Create Temp Channel", tester.test_create_temp_channel),
        ("Edit Message & Revisions", tester.test_edit_message_and_revisions),
        
        # Cleanup
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
    print("\n" + "=" * 60)
    print(f"📊 Test Results: {tester.tests_passed}/{tester.tests_run} passed")
    
    if failed_tests:
        print(f"❌ Failed tests: {', '.join(failed_tests)}")
        return 1
    else:
        print("✅ All tests passed!")
        return 0

if __name__ == "__main__":
    sys.exit(main())