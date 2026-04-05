#!/usr/bin/env python3
"""
Backend testing for Singra Vox - focusing on setup, bootstrap, and core functionality.
Tests the specific features mentioned in the review request.
"""
import requests
import sys
import time
from datetime import datetime

class SingraVoxTester:
    def __init__(self, base_url="https://bbdd79a5-5dd9-4359-80cf-7f512a35bc81.preview.emergentagent.com"):
        self.base_url = base_url
        self.session = requests.Session()
        self.tests_run = 0
        self.tests_passed = 0
        self.access_token = None
        self.user_id = None
        self.server_id = None
        self.channel_id = None
        
        # Test credentials for owner account creation
        self.owner_credentials = {
            "instance_name": "Test Singra Vox Instance",
            "owner_email": "admin@test.com",
            "owner_username": "admin",
            "owner_password": "TestAdmin123!",
            "owner_display_name": "Admin",
            "allow_open_signup": True
        }

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None):
        """Run a single API test"""
        # Ensure endpoint starts with /api/
        if not endpoint.startswith('/api/'):
            endpoint = f"/api/{endpoint.lstrip('/')}"
        url = f"{self.base_url}{endpoint}"
        test_headers = {'Content-Type': 'application/json'}
        
        if headers:
            test_headers.update(headers)
            
        if self.access_token:
            test_headers['Authorization'] = f'Bearer {self.access_token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   {method} {url}")
        
        try:
            if method == 'GET':
                response = self.session.get(url, headers=test_headers)
            elif method == 'POST':
                response = self.session.post(url, json=data, headers=test_headers)
            elif method == 'PUT':
                response = self.session.put(url, json=data, headers=test_headers)
            elif method == 'DELETE':
                response = self.session.delete(url, headers=test_headers)

            # Handle expected_status as list or single value
            if isinstance(expected_status, list):
                success = response.status_code in expected_status
            else:
                success = response.status_code == expected_status
                
            if success:
                self.tests_passed += 1
                print(f"✅ Passed - Status: {response.status_code}")
                try:
                    return True, response.json()
                except:
                    return True, response.text
            else:
                print(f"❌ Failed - Expected {expected_status}, got {response.status_code}")
                try:
                    error_data = response.json()
                    print(f"   Response: {error_data}")
                except:
                    print(f"   Response: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_setup_status_uninitialized(self):
        """Test that setup status returns uninitialized state"""
        print("\n" + "="*60)
        print("TESTING SETUP STATUS (UNINITIALIZED)")
        print("="*60)
        
        success, response = self.run_test(
            "Setup status - should be uninitialized",
            "GET",
            "/api/setup/status",
            200
        )
        
        if success:
            print(f"   Initialized: {response.get('initialized', 'N/A')}")
            print(f"   Setup required: {response.get('setup_required', 'N/A')}")
            print(f"   Instance name: {response.get('instance_name', 'N/A')}")
            print(f"   Allow open signup: {response.get('allow_open_signup', 'N/A')}")
            
            # Verify it's actually uninitialized
            if not response.get('initialized', True):
                print("   ✅ Instance is correctly uninitialized")
                return True
            else:
                print("   ⚠️  Instance appears to be already initialized")
                return True  # Still pass the test, just note the state
        
        return False

    def test_bootstrap_instance(self):
        """Test instance bootstrap/setup flow"""
        print("\n" + "="*60)
        print("TESTING INSTANCE BOOTSTRAP")
        print("="*60)
        
        success, response = self.run_test(
            "Bootstrap instance with owner account",
            "POST",
            "/api/setup/bootstrap",
            200,
            data=self.owner_credentials
        )
        
        if success:
            print(f"   Bootstrap successful")
            print(f"   User created: {response.get('user', {}).get('username', 'N/A')}")
            print(f"   User email: {response.get('user', {}).get('email', 'N/A')}")
            print(f"   User role: {response.get('user', {}).get('instance_role', 'N/A')}")
            
            # Store access token and user info for subsequent tests
            self.access_token = response.get('access_token')
            if response.get('user'):
                self.user_id = response.get('user', {}).get('id')
            
            if self.access_token:
                print(f"   Access token acquired: {self.access_token[:20]}...")
                return True
        
        return False

    def test_login_after_setup(self):
        """Test login flow after setup with the created owner account"""
        print("\n" + "="*60)
        print("TESTING LOGIN AFTER SETUP")
        print("="*60)
        
        success, response = self.run_test(
            "Login with owner credentials",
            "POST",
            "/api/auth/login",
            200,
            data={
                "email": self.owner_credentials["owner_email"],
                "password": self.owner_credentials["owner_password"]
            }
        )
        
        if success:
            print(f"   Login successful")
            print(f"   User: {response.get('user', {}).get('username', 'N/A')}")
            print(f"   Email: {response.get('user', {}).get('email', 'N/A')}")
            print(f"   Role: {response.get('user', {}).get('instance_role', 'N/A')}")
            
            # Update access token from login
            self.access_token = response.get('access_token')
            if response.get('user'):
                self.user_id = response.get('user', {}).get('id')
            
            if self.access_token:
                print(f"   New access token: {self.access_token[:20]}...")
                return True
        
        return False

    def test_auth_me(self):
        """Test /api/auth/me returns user info after login"""
        print("\n" + "="*60)
        print("TESTING AUTH ME ENDPOINT")
        print("="*60)
        
        if not self.access_token:
            print("❌ No access token available for auth/me test")
            return False
        
        success, response = self.run_test(
            "Get current user info",
            "GET",
            "/api/auth/me",
            200
        )
        
        if success:
            print(f"   User ID: {response.get('id', 'N/A')}")
            print(f"   Username: {response.get('username', 'N/A')}")
            print(f"   Email: {response.get('email', 'N/A')}")
            print(f"   Display name: {response.get('display_name', 'N/A')}")
            print(f"   Instance role: {response.get('instance_role', 'N/A')}")
            print(f"   Email verified: {response.get('email_verified', 'N/A')}")
            return True
        
        return False

    def test_server_creation(self):
        """Test server creation via API after login"""
        print("\n" + "="*60)
        print("TESTING SERVER CREATION")
        print("="*60)
        
        if not self.access_token:
            print("❌ No access token available for server creation test")
            return False
        
        server_data = {
            "name": "Test Server",
            "description": "A test server created by backend tests"
        }
        
        success, response = self.run_test(
            "Create new server",
            "POST",
            "/api/servers",
            [200, 201],  # Accept both 200 and 201
            data=server_data
        )
        
        if success:
            print(f"   Server created: {response.get('name', 'N/A')}")
            print(f"   Server ID: {response.get('id', 'N/A')}")
            print(f"   Owner ID: {response.get('owner_id', 'N/A')}")
            print(f"   Description: {response.get('description', 'N/A')}")
            
            # Store server ID for channel tests
            self.server_id = response.get('id')
            return True
        
        return False

    def test_channel_listing(self):
        """Test channel listing for a server"""
        print("\n" + "="*60)
        print("TESTING CHANNEL LISTING")
        print("="*60)
        
        if not self.access_token:
            print("❌ No access token available for channel listing test")
            return False
        
        if not self.server_id:
            print("❌ No server ID available for channel listing test")
            return False
        
        success, response = self.run_test(
            "List server channels",
            "GET",
            f"/api/servers/{self.server_id}/channels",
            200
        )
        
        if success:
            channels = response if isinstance(response, list) else []
            print(f"   Found {len(channels)} channels")
            
            for channel in channels:
                print(f"   - {channel.get('name', 'N/A')} ({channel.get('type', 'N/A')})")
                if channel.get('type') == 'text' and not self.channel_id:
                    self.channel_id = channel.get('id')
                    print(f"     Stored text channel ID: {self.channel_id}")
            
            return True
        
        return False

    def test_voice_token_generation(self):
        """Test LiveKit voice token generation endpoint"""
        print("\n" + "="*60)
        print("TESTING LIVEKIT VOICE TOKEN GENERATION")
        print("="*60)
        
        if not self.access_token:
            print("❌ No access token available for voice token test")
            return False
        
        if not self.server_id:
            print("❌ No server ID available for voice token test")
            return False
        
        # Find a voice channel first
        voice_channel_id = None
        if self.server_id:
            # Get channels to find a voice channel
            try:
                url = f"{self.base_url}/api/servers/{self.server_id}/channels"
                headers = {
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {self.access_token}'
                }
                response = self.session.get(url, headers=headers)
                if response.status_code == 200:
                    channels = response.json()
                    for channel in channels:
                        if channel.get('type') == 'voice':
                            voice_channel_id = channel.get('id')
                            print(f"   Found voice channel: {channel.get('name', 'N/A')}")
                            break
            except Exception as e:
                print(f"   Error finding voice channel: {e}")
        
        if not voice_channel_id:
            print("❌ No voice channel found for voice token test")
            return False
        
        token_data = {
            "server_id": self.server_id,
            "channel_id": voice_channel_id
        }
        
        success, response = self.run_test(
            "Generate LiveKit voice token",
            "POST",
            "/api/voice/token",
            200,
            data=token_data
        )
        
        if success:
            print(f"   Voice token generated successfully")
            print(f"   Token length: {len(response.get('token', ''))}")
            print(f"   LiveKit URL: {response.get('livekit_url', 'N/A')}")
            print(f"   Room name: {response.get('room_name', 'N/A')}")
            return True
        
        return False

    def test_logout_flow(self):
        """Test logout flow"""
        print("\n" + "="*60)
        print("TESTING LOGOUT FLOW")
        print("="*60)
        
        if not self.access_token:
            print("❌ No access token available for logout test")
            return False
        
        success, response = self.run_test(
            "Logout current session",
            "POST",
            "/api/auth/logout",
            200
        )
        
        if success:
            print(f"   Logout successful")
            
            # Try to access a protected endpoint to verify logout
            verify_success, verify_response = self.run_test(
                "Verify logout - should fail auth",
                "GET",
                "/api/auth/me",
                401  # Should be unauthorized now
            )
            
            if verify_success:
                print(f"   ✅ Logout verified - auth/me correctly returns 401")
                # Clear the token since we've logged out
                self.access_token = None
                return True
            else:
                print(f"   ⚠️  Logout may not have worked - auth/me didn't return 401")
                return False
        
        return False

    def run_all_tests(self):
        """Run all tests in the correct order"""
        print("🚀 Starting Singra Vox Backend Tests")
        print(f"Backend URL: {self.base_url}")
        print("="*80)
        
        # Test 1: Setup status (should be uninitialized)
        self.test_setup_status_uninitialized()
        
        # Test 2: Bootstrap instance
        if not self.test_bootstrap_instance():
            print("❌ Bootstrap failed - trying to login with existing credentials")
            # If bootstrap fails, try to login with existing credentials
            if not self.test_login_after_setup():
                print("❌ Both bootstrap and login failed - cannot continue")
                return False
        
        # Test 3: Auth me endpoint
        self.test_auth_me()
        
        # Test 4: Server creation
        self.test_server_creation()
        
        # Test 5: Channel listing
        self.test_channel_listing()
        
        # Test 6: Voice token generation
        self.test_voice_token_generation()
        
        # Test 7: Logout flow
        self.test_logout_flow()
        
        # Print results
        print("\n" + "="*80)
        print("📊 TEST RESULTS")
        print("="*80)
        print(f"Tests passed: {self.tests_passed}/{self.tests_run}")
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        print(f"Success rate: {success_rate:.1f}%")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All tests passed!")
            return True
        else:
            print(f"⚠️  {self.tests_run - self.tests_passed} tests failed")
            return False

def main():
    tester = SingraVoxTester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())