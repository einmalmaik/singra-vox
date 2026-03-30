#!/usr/bin/env python3
"""
Singra Vox Phase 3.5 Specific Backend Tests
Tests the new Phase 3.5 features: user status updates, GDPR endpoints
"""
import requests
import sys
import json
from datetime import datetime

class Phase35APITester:
    def __init__(self, base_url="https://sovereign-voice.preview.emergentagent.com"):
        self.base_url = base_url
        self.token = None
        self.user_id = None
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

    def test_user_status_update(self):
        """Test PUT /api/users/me with status change"""
        status_options = ["online", "away", "dnd", "offline"]
        
        for status in status_options:
            success, response = self.run_test(
                f"Update User Status to {status}",
                "PUT",
                "users/me",
                200,
                data={"status": status}
            )
            if success and response.get('status') == status:
                print(f"   ✅ Status updated to: {status}")
            elif success:
                print(f"   ⚠️  Status update response: {response.get('status')} (expected {status})")
                return False
            else:
                return False
        
        return True

    def test_gdpr_export_endpoint(self):
        """Test GET /api/users/me/export specifically"""
        success, response = self.run_test(
            "GDPR Data Export (Phase 3.5)",
            "GET",
            "users/me/export",
            200
        )
        if success and response:
            required_fields = [
                "export_date", "profile", "server_memberships", 
                "channel_messages", "direct_messages_sent", "direct_messages_received"
            ]
            missing_fields = [f for f in required_fields if f not in response]
            if not missing_fields:
                print(f"   ✅ GDPR export contains all required fields")
                print(f"   Profile email: {response.get('profile', {}).get('email')}")
                print(f"   Export date: {response.get('export_date')}")
                return True
            else:
                print(f"   ❌ Missing required fields: {missing_fields}")
                return False
        return success

    def test_health_singra_vox(self):
        """Test health endpoint returns 'Singra Vox'"""
        success, response = self.run_test(
            "Health Check (Singra Vox)",
            "GET",
            "health",
            200
        )
        if success and response.get("service") == "Singra Vox":
            print(f"   ✅ Health check returns 'Singra Vox'")
            return True
        else:
            print(f"   ❌ Expected 'Singra Vox', got: {response.get('service')}")
            return False

def main():
    print("🚀 Starting Singra Vox Phase 3.5 Specific Backend Tests")
    print("=" * 60)
    
    # Setup
    tester = Phase35APITester()
    admin_email = "admin@sovereignvoice.local"
    admin_password = "SV_Admin_2024!"

    # Test sequence for Phase 3.5 specific features
    tests = [
        ("Health Check (Singra Vox)", tester.test_health_singra_vox),
        ("Admin Login", lambda: tester.test_login(admin_email, admin_password)),
        ("User Status Updates", tester.test_user_status_update),
        ("GDPR Data Export", tester.test_gdpr_export_endpoint),
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
    print(f"📊 Phase 3.5 Test Results: {tester.tests_passed}/{tester.tests_run} passed")
    
    if failed_tests:
        print(f"❌ Failed tests: {', '.join(failed_tests)}")
        return 1
    else:
        print("✅ All Phase 3.5 backend tests passed!")
        return 0

if __name__ == "__main__":
    sys.exit(main())