#!/usr/bin/env python3
"""
Comprehensive backend testing for Singra Vox with SVID (Singra Vox ID) integration.
Tests both original functionality and new SVID identity features.
"""
import requests
import sys
import pyotp
import time
from datetime import datetime

class SingraVoxTester:
    def __init__(self, base_url="https://2127b0d5-e152-47e5-8e08-d12e4205d04a.preview.emergentagent.com"):
        self.base_url = base_url
        self.session = requests.Session()
        self.tests_run = 0
        self.tests_passed = 0
        self.local_token = None
        self.svid_token = None
        
        # Test credentials
        self.local_admin = {
            "email": "einmalmaik@gmail.com",
            "password": "T6qlck35l7z8h"
        }
        self.svid_user = {
            "email": "test_svid@example.com", 
            "password": "Str0ng!Pass#2026",
            "totp_secret": "QT7KKI3Y56NKUFO4OXFA6N5FLTBG7MJS"
        }

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None, use_svid_token=False):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint.lstrip('/')}"
        test_headers = {'Content-Type': 'application/json'}
        
        if headers:
            test_headers.update(headers)
            
        if use_svid_token and self.svid_token:
            test_headers['Authorization'] = f'Bearer {self.svid_token}'
        elif self.local_token:
            test_headers['Authorization'] = f'Bearer {self.local_token}'

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   {method} {endpoint}")
        
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
                    print(f"   Response: {response.json()}")
                except:
                    print(f"   Response: {response.text}")
                return False, {}

        except Exception as e:
            print(f"❌ Failed - Error: {str(e)}")
            return False, {}

    def test_local_login(self):
        """Test original local login functionality"""
        print("\n" + "="*60)
        print("TESTING LOCAL AUTHENTICATION")
        print("="*60)
        
        success, response = self.run_test(
            "Local admin login",
            "POST",
            "/api/auth/login",
            200,
            data=self.local_admin
        )
        
        if success and 'access_token' in response:
            self.local_token = response['access_token']
            print(f"   Local token acquired: {self.local_token[:20]}...")
            return True
        return False

    def test_svid_password_utilities(self):
        """Test SVID password checking and generation"""
        print("\n" + "="*60)
        print("TESTING SVID PASSWORD UTILITIES")
        print("="*60)
        
        # Test password strength checking
        weak_success, weak_response = self.run_test(
            "Password check - weak password",
            "POST",
            "/api/id/password/check",
            200,
            data={"password": "test123"}
        )
        
        if weak_success:
            print(f"   Weak password score: {weak_response.get('score', 'N/A')}")
            print(f"   Meets policy: {weak_response.get('meets_policy', 'N/A')}")
        
        strong_success, strong_response = self.run_test(
            "Password check - strong password",
            "POST", 
            "/api/id/password/check",
            200,
            data={"password": "Str0ng!Pass#2026"}
        )
        
        if strong_success:
            print(f"   Strong password score: {strong_response.get('score', 'N/A')}")
            print(f"   Meets policy: {strong_response.get('meets_policy', 'N/A')}")
        
        # Test password generation
        gen_success, gen_response = self.run_test(
            "Password generation",
            "POST",
            "/api/id/password/generate?length=16",
            200
        )
        
        if gen_success:
            print(f"   Generated password: {gen_response.get('password', 'N/A')}")
            print(f"   Generated strength: {gen_response.get('strength', {}).get('score', 'N/A')}")
        
        return weak_success and strong_success and gen_success

    def test_svid_registration(self):
        """Test SVID registration with weak password rejection"""
        print("\n" + "="*60)
        print("TESTING SVID REGISTRATION")
        print("="*60)
        
        # Test registration with weak password (should fail)
        weak_success, weak_response = self.run_test(
            "SVID registration - weak password rejection",
            "POST",
            "/api/id/register",
            [400, 422],  # 422 for Pydantic validation, 400 for app validation
            data={
                "email": "test_weak@example.com",
                "username": "testweak",
                "password": "weakpass",  # 8 chars, no special chars
                "display_name": "Test Weak"
            }
        )
        
        if weak_success:
            print(f"   Correctly rejected weak password (validation working)")
        
        # Test registration with proper weak password that passes length but fails policy
        weak2_success, weak2_response = self.run_test(
            "SVID registration - policy rejection",
            "POST", 
            "/api/id/register",
            400,
            data={
                "email": "test_weak2@example.com",
                "username": "testweak2", 
                "password": "weakpassword123",  # 15 chars but no uppercase/special
                "display_name": "Test Weak 2"
            }
        )
        
        # Test registration with strong password (should succeed or already exist)
        strong_success, strong_response = self.run_test(
            "SVID registration - strong password",
            "POST",
            "/api/id/register",
            [200, 400],  # 200 for success, 400 if already exists
            data={
                "email": "test_strong_new@example.com",
                "username": "teststrong",
                "password": "StrongP@ssw0rd123!",
                "display_name": "Test Strong"
            }
        )
        
        return weak_success and weak2_success and (strong_success or strong_response.get('ok'))

    def test_svid_login(self):
        """Test SVID login functionality"""
        print("\n" + "="*60)
        print("TESTING SVID LOGIN")
        print("="*60)
        
        # Test login with verified SVID account
        success, response = self.run_test(
            "SVID login - verified account",
            "POST",
            "/api/id/login",
            200,
            data={
                "email": self.svid_user["email"],
                "password": self.svid_user["password"]
            }
        )
        
        if success:
            if response.get('requires_2fa'):
                print(f"   2FA required, pending token: {response.get('pending_token', 'N/A')[:20]}...")
                return self.test_svid_2fa_login(response.get('pending_token'))
            else:
                self.svid_token = response.get('access_token')
                print(f"   SVID token acquired: {self.svid_token[:20]}...")
                return True
        return False

    def test_svid_2fa_login(self, pending_token):
        """Test SVID 2FA completion"""
        print("\n🔐 Testing SVID 2FA completion...")
        
        # Generate TOTP code
        totp = pyotp.TOTP(self.svid_user["totp_secret"])
        totp_code = totp.now()
        print(f"   Generated TOTP code: {totp_code}")
        
        success, response = self.run_test(
            "SVID 2FA completion",
            "POST",
            "/api/id/login/2fa",
            200,
            data={
                "pending_token": pending_token,
                "code": totp_code
            }
        )
        
        if success and 'access_token' in response:
            self.svid_token = response['access_token']
            print(f"   SVID token acquired after 2FA: {self.svid_token[:20]}...")
            return True
        return False

    def test_svid_profile(self):
        """Test SVID profile endpoints"""
        print("\n" + "="*60)
        print("TESTING SVID PROFILE")
        print("="*60)
        
        if not self.svid_token:
            print("❌ No SVID token available for profile tests")
            return False
        
        # Test getting profile
        get_success, get_response = self.run_test(
            "SVID get profile",
            "GET",
            "/api/id/me",
            200,
            use_svid_token=True
        )
        
        if get_success:
            print(f"   Profile email: {get_response.get('email', 'N/A')}")
            print(f"   Profile username: {get_response.get('username', 'N/A')}")
        
        # Test updating profile
        update_success, update_response = self.run_test(
            "SVID update profile",
            "PUT",
            "/api/id/me",
            200,
            data={"display_name": "Updated Test User"},
            use_svid_token=True
        )
        
        if update_success:
            print(f"   Updated display name: {update_response.get('display_name', 'N/A')}")
        
        return get_success and update_success

    def test_svid_2fa_setup(self):
        """Test SVID 2FA setup endpoints"""
        print("\n" + "="*60)
        print("TESTING SVID 2FA SETUP")
        print("="*60)
        
        if not self.svid_token:
            print("❌ No SVID token available for 2FA tests")
            return False
        
        # Test 2FA setup (might already be enabled)
        setup_success, setup_response = self.run_test(
            "SVID 2FA setup",
            "POST",
            "/api/id/2fa/setup",
            [200, 409],  # 409 if already enabled
            use_svid_token=True
        )
        
        if setup_success and setup_response.get('secret'):
            print(f"   2FA secret: {setup_response.get('secret', 'N/A')}")
            print(f"   QR URI: {setup_response.get('qr_uri', 'N/A')[:50]}...")
        elif setup_response.get('detail') == "2FA is already enabled":
            print("   2FA already enabled (expected for test user)")
        
        return setup_success

    def test_svid_openid_discovery(self):
        """Test SVID OpenID Connect discovery"""
        print("\n" + "="*60)
        print("TESTING SVID OPENID DISCOVERY")
        print("="*60)
        
        success, response = self.run_test(
            "SVID OpenID discovery",
            "GET",
            "/api/id/.well-known/openid-configuration",
            200
        )
        
        if success:
            print(f"   Issuer: {response.get('issuer', 'N/A')}")
            print(f"   Auth endpoint: {response.get('authorization_endpoint', 'N/A')}")
            print(f"   Token endpoint: {response.get('token_endpoint', 'N/A')}")
        
        return success

    def test_svid_instance_login(self):
        """Test logging into instance with SVID token"""
        print("\n" + "="*60)
        print("TESTING SVID INSTANCE LOGIN")
        print("="*60)
        
        if not self.svid_token:
            print("❌ No SVID token available for instance login test")
            return False
        
        success, response = self.run_test(
            "Login to instance with SVID token",
            "POST",
            "/api/auth/login-with-svid",
            200,
            data={"svid_access_token": self.svid_token}
        )
        
        if success:
            print(f"   Instance login successful")
            print(f"   User: {response.get('user', {}).get('username', 'N/A')}")
            print(f"   Instance token: {response.get('access_token', 'N/A')[:20]}...")
        
        return success

    def test_existing_functionality(self):
        """Test that existing messaging/channels still work"""
        print("\n" + "="*60)
        print("TESTING EXISTING FUNCTIONALITY")
        print("="*60)
        
        if not self.local_token:
            print("❌ No local token available for existing functionality tests")
            return False
        
        # Test servers endpoint
        servers_success, servers_response = self.run_test(
            "List servers",
            "GET",
            "/api/servers",
            200
        )
        
        if servers_success and isinstance(servers_response, list) and len(servers_response) > 0:
            server_id = servers_response[0]['id']
            print(f"   Found server: {servers_response[0].get('name', 'N/A')}")
            
            # Test channels
            channels_success, channels_response = self.run_test(
                "List channels",
                "GET",
                f"/api/servers/{server_id}/channels",
                200
            )
            
            if channels_success and isinstance(channels_response, list) and len(channels_response) > 0:
                channel_id = None
                for channel in channels_response:
                    if channel.get('type') == 'text':
                        channel_id = channel['id']
                        print(f"   Found text channel: {channel.get('name', 'N/A')}")
                        break
                
                if channel_id:
                    # Test sending message
                    message_success, message_response = self.run_test(
                        "Send message",
                        "POST",
                        f"/api/channels/{channel_id}/messages",
                        201,
                        data={"content": f"Test message from backend test at {datetime.now()}"}
                    )
                    
                    return servers_success and channels_success and message_success
                else:
                    print("   No text channels found")
                    return servers_success and channels_success
            else:
                print("   No channels found or channels response invalid")
                return servers_success
        else:
            print("   No servers found or servers response invalid")
            return servers_success

    def run_all_tests(self):
        """Run all tests"""
        print("🚀 Starting Singra Vox SVID Backend Tests")
        print(f"Backend URL: {self.base_url}")
        print("="*80)
        
        # Test local authentication first
        if not self.test_local_login():
            print("❌ Local login failed - cannot continue with authenticated tests")
            return False
        
        # Test SVID password utilities (no auth required)
        self.test_svid_password_utilities()
        
        # Test SVID registration
        self.test_svid_registration()
        
        # Test SVID login and 2FA
        if not self.test_svid_login():
            print("❌ SVID login failed - cannot test SVID authenticated endpoints")
        else:
            # Test SVID authenticated endpoints
            self.test_svid_profile()
            self.test_svid_2fa_setup()
            self.test_svid_instance_login()
        
        # Test SVID discovery (no auth required)
        self.test_svid_openid_discovery()
        
        # Test existing functionality still works
        self.test_existing_functionality()
        
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