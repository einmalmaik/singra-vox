#!/usr/bin/env python3
"""
Comprehensive backend API testing for Singra Vox Discord-like chat application.
Tests authentication, setup, servers, channels, messages, E2EE, and DM functionality.
"""

import requests
import sys
import json
from datetime import datetime
from typing import Dict, Any, Optional

class SingraVoxAPITester:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'SingraVox-Test-Client/1.0'
        })
        
        # Test results tracking
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        
        # Auth state
        self.access_token = None
        self.user_data = None
        self.server_id = None
        self.channel_id = None
        
        # Test user credentials
        self.admin_email = "einmalmaik@gmail.com"
        self.admin_password = "T6qlck35l7z8h"
        
    def log_test(self, test_name: str, success: bool, details: str = ""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {test_name}")
            if details:
                print(f"   {details}")
        else:
            self.failed_tests.append(test_name)
            print(f"❌ {test_name}")
            if details:
                print(f"   {details}")
    
    def make_request(self, method: str, endpoint: str, data: Dict[Any, Any] = None, 
                    expected_status: int = 200, auth_required: bool = True) -> Optional[requests.Response]:
        """Make HTTP request with error handling"""
        url = f"{self.base_url}/api{endpoint}"
        
        headers = {}
        if auth_required and self.access_token:
            headers['Authorization'] = f'Bearer {self.access_token}'
            
        try:
            if method.upper() == 'GET':
                response = self.session.get(url, headers=headers)
            elif method.upper() == 'POST':
                response = self.session.post(url, json=data, headers=headers)
            elif method.upper() == 'PUT':
                response = self.session.put(url, json=data, headers=headers)
            elif method.upper() == 'DELETE':
                response = self.session.delete(url, headers=headers)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
                
            return response
            
        except Exception as e:
            print(f"   Request failed: {str(e)}")
            return None
    
    def test_setup_status(self):
        """Test /api/setup/status endpoint"""
        response = self.make_request('GET', '/setup/status', auth_required=False)
        
        if response and response.status_code == 200:
            data = response.json()
            initialized = data.get('initialized', False)
            self.log_test("Setup Status", initialized, 
                         f"Instance initialized: {initialized}")
            return initialized
        else:
            self.log_test("Setup Status", False, 
                         f"Failed to get setup status: {response.status_code if response else 'No response'}")
            return False
    
    def test_login(self):
        """Test /api/auth/login endpoint"""
        login_data = {
            "email": self.admin_email,
            "password": self.admin_password
        }
        
        response = self.make_request('POST', '/auth/login', login_data, auth_required=False)
        
        if response and response.status_code == 200:
            data = response.json()
            self.access_token = data.get('access_token')
            self.user_data = data.get('user')
            
            success = bool(self.access_token and self.user_data)
            self.log_test("Admin Login", success, 
                         f"User: {self.user_data.get('email') if self.user_data else 'None'}")
            return success
        else:
            error_msg = "Unknown error"
            if response:
                try:
                    error_data = response.json()
                    error_msg = error_data.get('detail', f"Status {response.status_code}")
                except:
                    error_msg = f"Status {response.status_code}"
            
            self.log_test("Admin Login", False, f"Login failed: {error_msg}")
            return False
    
    def test_auth_me(self):
        """Test /api/auth/me endpoint"""
        if not self.access_token:
            self.log_test("Auth Me", False, "No access token available")
            return False
            
        response = self.make_request('GET', '/auth/me')
        
        if response and response.status_code == 200:
            data = response.json()
            user_id = data.get('id')
            email = data.get('email')
            
            success = bool(user_id and email == self.admin_email)
            self.log_test("Auth Me", success, 
                         f"User ID: {user_id}, Email: {email}")
            return success
        else:
            self.log_test("Auth Me", False, 
                         f"Failed: {response.status_code if response else 'No response'}")
            return False
    
    def test_auth_sessions(self):
        """Test /api/auth/sessions endpoint"""
        if not self.access_token:
            self.log_test("Auth Sessions", False, "No access token available")
            return False
            
        response = self.make_request('GET', '/auth/sessions')
        
        if response and response.status_code == 200:
            data = response.json()
            sessions = data.get('sessions', [])
            
            success = isinstance(sessions, list)
            self.log_test("Auth Sessions", success, 
                         f"Found {len(sessions)} sessions")
            return success
        else:
            self.log_test("Auth Sessions", False, 
                         f"Failed: {response.status_code if response else 'No response'}")
            return False
    
    def test_auth_refresh(self):
        """Test /api/auth/refresh endpoint"""
        response = self.make_request('POST', '/auth/refresh', {})
        
        if response and response.status_code == 200:
            data = response.json()
            success = data.get('ok', False)
            self.log_test("Auth Refresh", success, 
                         f"Refresh successful: {success}")
            return success
        else:
            self.log_test("Auth Refresh", False, 
                         f"Failed: {response.status_code if response else 'No response'}")
            return False
    
    def test_servers_list(self):
        """Test /api/servers endpoint"""
        if not self.access_token:
            self.log_test("Server List", False, "No access token available")
            return False
            
        response = self.make_request('GET', '/servers')
        
        if response and response.status_code == 200:
            servers = response.json()
            
            if isinstance(servers, list) and len(servers) > 0:
                # Look for "Singra Community" server
                community_server = None
                for server in servers:
                    if server.get('name') == 'Singra Community':
                        community_server = server
                        self.server_id = server.get('id')
                        break
                
                success = community_server is not None
                self.log_test("Server List", success, 
                             f"Found {len(servers)} servers, Singra Community: {'Yes' if success else 'No'}")
                return success
            else:
                self.log_test("Server List", False, "No servers found")
                return False
        else:
            self.log_test("Server List", False, 
                         f"Failed: {response.status_code if response else 'No response'}")
            return False
    
    def test_channels_list(self):
        """Test channel listing for the server"""
        if not self.server_id:
            self.log_test("Channel List", False, "No server ID available")
            return False
            
        response = self.make_request('GET', f'/servers/{self.server_id}/channels')
        
        if response and response.status_code == 200:
            channels = response.json()
            
            if isinstance(channels, list) and len(channels) > 0:
                # Look for #general channel
                general_channel = None
                voice_channel = None
                
                for channel in channels:
                    if channel.get('name') == 'general' and channel.get('type') == 'text':
                        general_channel = channel
                        self.channel_id = channel.get('id')
                    elif channel.get('type') == 'voice':
                        voice_channel = channel
                
                success = general_channel is not None
                self.log_test("Channel List", success, 
                             f"Found {len(channels)} channels, #general: {'Yes' if success else 'No'}, Voice: {'Yes' if voice_channel else 'No'}")
                return success
            else:
                self.log_test("Channel List", False, "No channels found")
                return False
        else:
            self.log_test("Channel List", False, 
                         f"Failed: {response.status_code if response else 'No response'}")
            return False
    
    def test_send_message(self):
        """Test sending a message in #general channel"""
        if not self.channel_id:
            self.log_test("Send Message", False, "No channel ID available")
            return False
            
        message_data = {
            "content": f"Test message from API test at {datetime.now().isoformat()}",
            "mentioned_user_ids": [],
            "mentioned_role_ids": [],
            "mentions_everyone": False
        }
        
        response = self.make_request('POST', f'/channels/{self.channel_id}/messages', message_data)
        
        if response and response.status_code in [200, 201]:
            data = response.json()
            message_id = data.get('id')
            content = data.get('content')
            
            success = bool(message_id and content)
            self.log_test("Send Message", success, 
                         f"Message ID: {message_id}, Status: {response.status_code}")
            return success
        else:
            error_details = f"Status: {response.status_code if response else 'No response'}"
            if response:
                try:
                    error_data = response.json()
                    error_details += f", Error: {error_data}"
                except:
                    error_details += f", Response: {response.text[:100]}"
            
            self.log_test("Send Message", False, error_details)
            return False
    
    def test_user_registration(self):
        """Test user registration flow"""
        test_user_data = {
            "email": f"testuser_{int(datetime.now().timestamp())}@example.com",
            "username": f"testuser_{int(datetime.now().timestamp())}",
            "password": "TestPassword123!",
            "display_name": "Test User"
        }
        
        response = self.make_request('POST', '/auth/register', test_user_data, auth_required=False)
        
        if response:
            if response.status_code == 200:
                data = response.json()
                success = data.get('ok', False) or 'user' in data
                self.log_test("User Registration", success, 
                             f"Registration successful: {success}")
                return success
            elif response.status_code == 403:
                # Open signup might be disabled
                self.log_test("User Registration", True, 
                             "Open signup disabled (expected)")
                return True
            else:
                self.log_test("User Registration", False, 
                             f"Failed: {response.status_code}")
                return False
        else:
            self.log_test("User Registration", False, "No response")
            return False
    
    def test_e2ee_state(self):
        """Test E2EE state endpoint"""
        if not self.access_token:
            self.log_test("E2EE State", False, "No access token available")
            return False
            
        response = self.make_request('GET', '/e2ee/state')
        
        if response and response.status_code == 200:
            data = response.json()
            enabled = data.get('enabled', False)
            devices = data.get('devices', [])
            
            success = 'enabled' in data  # Just check that we get a valid response
            self.log_test("E2EE State", success, 
                         f"E2EE enabled: {enabled}, Devices: {len(devices)}")
            return success
        else:
            self.log_test("E2EE State", False, 
                         f"Failed: {response.status_code if response else 'No response'}")
            return False
    
    def test_dm_conversation_creation(self):
        """Test DM conversation creation"""
        if not self.access_token or not self.user_data:
            self.log_test("DM Conversation", False, "No auth data available")
            return False
            
        # First get DM conversations list
        response = self.make_request('GET', '/dm/conversations')
        
        if response and response.status_code == 200:
            conversations = response.json()
            success = isinstance(conversations, list)
            self.log_test("DM Conversation", success, 
                         f"Found {len(conversations)} DM conversations")
            return success
        else:
            self.log_test("DM Conversation", False, 
                         f"Failed: {response.status_code if response else 'No response'}")
            return False
    
    def run_all_tests(self):
        """Run all backend API tests"""
        print("🚀 Starting Singra Vox Backend API Tests")
        print(f"📡 Testing against: {self.base_url}")
        print("=" * 60)
        
        # Test setup status
        self.test_setup_status()
        
        # Test authentication flow
        if self.test_login():
            self.test_auth_me()
            self.test_auth_sessions()
            self.test_auth_refresh()
            
            # Test server and channel functionality
            if self.test_servers_list():
                if self.test_channels_list():
                    self.test_send_message()
            
            # Test E2EE
            self.test_e2ee_state()
            
            # Test DM functionality
            self.test_dm_conversation_creation()
        
        # Test user registration (independent of login)
        self.test_user_registration()
        
        # Print summary
        print("=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.failed_tests:
            print(f"❌ Failed tests: {', '.join(self.failed_tests)}")
            return False
        else:
            print("✅ All tests passed!")
            return True

def main():
    # Use the backend URL from the environment
    backend_url = "https://2127b0d5-e152-47e5-8e08-d12e4205d04a.preview.emergentagent.com"
    
    tester = SingraVoxAPITester(backend_url)
    success = tester.run_all_tests()
    
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())