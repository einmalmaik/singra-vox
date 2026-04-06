#!/usr/bin/env python3
"""
Singra Vox Backend API Testing
==============================

Tests all backend endpoints for the singra-vox privacy-first communication platform.
Focuses on testing the specific requirements from the review request.
"""

import requests
import sys
import json
from datetime import datetime

class SingraVoxAPITester:
    def __init__(self, base_url="https://40ab1aba-644d-4f9f-bbb3-da15d824d979.preview.emergentagent.com"):
        self.base_url = base_url.rstrip('/')
        self.session = requests.Session()
        self.session.headers.update({'Content-Type': 'application/json'})
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []
        self.admin_credentials = {
            "email": "admin@mauntingstudios.de",
            "password": "Admin1234!"
        }

    def log_test(self, name, success, details=""):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
            if details:
                print(f"   {details}")
        else:
            self.failed_tests.append({"name": name, "details": details})
            print(f"❌ {name}")
            if details:
                print(f"   {details}")

    def test_health_check(self):
        """Test backend health check endpoint"""
        try:
            response = self.session.get(f"{self.base_url}/api/health", timeout=10)
            success = response.status_code == 200
            
            if success:
                try:
                    data = response.json()
                    if "ok" in str(data).lower() or "healthy" in str(data).lower():
                        self.log_test("Health Check", True, f"Status: {response.status_code}, Response: {data}")
                    else:
                        self.log_test("Health Check", True, f"Status: {response.status_code}")
                except:
                    self.log_test("Health Check", True, f"Status: {response.status_code}")
            else:
                self.log_test("Health Check", False, f"Status: {response.status_code}")
                
        except Exception as e:
            self.log_test("Health Check", False, f"Exception: {str(e)}")

    def test_setup_status(self):
        """Test setup status endpoint"""
        try:
            response = self.session.get(f"{self.base_url}/api/setup/status", timeout=10)
            success = response.status_code == 200
            
            if success:
                try:
                    data = response.json()
                    initialized = data.get("initialized", False)
                    self.log_test("Setup Status", True, f"Initialized: {initialized}, Response: {data}")
                except:
                    self.log_test("Setup Status", False, f"Invalid JSON response: {response.text}")
            else:
                self.log_test("Setup Status", False, f"Status: {response.status_code}, Response: {response.text}")
                
        except Exception as e:
            self.log_test("Setup Status", False, f"Exception: {str(e)}")

    def test_admin_login(self):
        """Test admin login functionality"""
        try:
            login_data = {
                "email": self.admin_credentials["email"],
                "password": self.admin_credentials["password"]
            }
            
            response = self.session.post(f"{self.base_url}/api/auth/login", 
                                       json=login_data, timeout=10)
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    if "access_token" in data or "token" in data:
                        self.log_test("Admin Login", True, f"Login successful for {self.admin_credentials['email']}")
                        return data
                    else:
                        self.log_test("Admin Login", False, f"No token in response: {data}")
                except:
                    self.log_test("Admin Login", False, f"Invalid JSON response: {response.text}")
            else:
                self.log_test("Admin Login", False, f"Status: {response.status_code}, Response: {response.text}")
                
        except Exception as e:
            self.log_test("Admin Login", False, f"Exception: {str(e)}")
        
        return None

    def test_svid_openid_configuration(self):
        """Test SVID OpenID configuration endpoint"""
        try:
            response = self.session.get(f"{self.base_url}/api/id/.well-known/openid-configuration", timeout=10)
            
            if response.status_code == 200:
                try:
                    data = response.json()
                    issuer = data.get("issuer", "")
                    expected_issuer = "https://voxid.mauntingstudios.de"
                    
                    if issuer == expected_issuer:
                        self.log_test("SVID OpenID Configuration", True, 
                                    f"Issuer correctly set to: {issuer}")
                    else:
                        self.log_test("SVID OpenID Configuration", False, 
                                    f"Issuer mismatch. Expected: {expected_issuer}, Got: {issuer}")
                except:
                    self.log_test("SVID OpenID Configuration", False, f"Invalid JSON response: {response.text}")
            else:
                self.log_test("SVID OpenID Configuration", False, 
                            f"Status: {response.status_code}, Response: {response.text}")
                
        except Exception as e:
            self.log_test("SVID OpenID Configuration", False, f"Exception: {str(e)}")

    def test_svid_register_endpoint(self):
        """Test SVID register endpoint exists"""
        try:
            # Test with minimal data to see if endpoint exists
            test_data = {
                "email": "test@example.com",
                "username": "testuser",
                "password": "TestPassword123!"
            }
            
            response = self.session.post(f"{self.base_url}/api/id/register", 
                                       json=test_data, timeout=10)
            
            # We expect either 200 (success), 400 (validation error), or 409 (conflict)
            # What we don't want is 404 (endpoint not found)
            if response.status_code in [200, 400, 409]:
                self.log_test("SVID Register Endpoint", True, 
                            f"Endpoint exists, Status: {response.status_code}")
            elif response.status_code == 404:
                self.log_test("SVID Register Endpoint", False, 
                            f"Endpoint not found (404)")
            else:
                self.log_test("SVID Register Endpoint", True, 
                            f"Endpoint exists, Status: {response.status_code}")
                
        except Exception as e:
            self.log_test("SVID Register Endpoint", False, f"Exception: {str(e)}")

    def test_config_files(self):
        """Test that config files have correct SVID_ISSUER defaults"""
        expected_issuer = "https://voxid.mauntingstudios.de"
        
        # Test backend/.env.example
        try:
            with open("/app/backend/.env.example", "r") as f:
                content = f.read()
                if f"SVID_ISSUER={expected_issuer}" in content:
                    self.log_test("Backend .env.example SVID_ISSUER", True, 
                                f"Default set to {expected_issuer}")
                else:
                    self.log_test("Backend .env.example SVID_ISSUER", False, 
                                f"Default not found or incorrect")
        except Exception as e:
            self.log_test("Backend .env.example SVID_ISSUER", False, f"Exception: {str(e)}")

        # Test backend/app/identity/config.py
        try:
            with open("/app/backend/app/identity/config.py", "r") as f:
                content = f.read()
                if f'"{expected_issuer}"' in content:
                    self.log_test("Identity Config SVID_ISSUER", True, 
                                f"Fallback set to {expected_issuer}")
                else:
                    self.log_test("Identity Config SVID_ISSUER", False, 
                                f"Fallback not found or incorrect")
        except Exception as e:
            self.log_test("Identity Config SVID_ISSUER", False, f"Exception: {str(e)}")

        # Test docker-compose files
        for compose_file in ["/app/deploy/docker-compose.yml", "/app/deploy/docker-compose.prod.yml"]:
            try:
                with open(compose_file, "r") as f:
                    content = f.read()
                    if f"SVID_ISSUER:-{expected_issuer}" in content:
                        self.log_test(f"Docker Compose {compose_file.split('/')[-1]} SVID_ISSUER", True, 
                                    f"Default set to {expected_issuer}")
                    else:
                        self.log_test(f"Docker Compose {compose_file.split('/')[-1]} SVID_ISSUER", False, 
                                    f"Default not found or incorrect")
            except Exception as e:
                self.log_test(f"Docker Compose {compose_file.split('/')[-1]} SVID_ISSUER", False, f"Exception: {str(e)}")

        # Test install.sh
        try:
            with open("/app/install.sh", "r") as f:
                content = f.read()
                if f"SVID_ISSUER={expected_issuer}" in content:
                    self.log_test("Install.sh SVID_ISSUER", True, 
                                f"Default set to {expected_issuer}")
                else:
                    self.log_test("Install.sh SVID_ISSUER", False, 
                                f"Default not found or incorrect")
        except Exception as e:
            self.log_test("Install.sh SVID_ISSUER", False, f"Exception: {str(e)}")

    def run_all_tests(self):
        """Run all backend tests"""
        print("🔍 Starting Singra Vox Backend API Tests")
        print(f"📡 Testing against: {self.base_url}")
        print("=" * 60)
        
        # Core API tests
        self.test_health_check()
        self.test_setup_status()
        self.test_admin_login()
        
        # SVID specific tests
        self.test_svid_openid_configuration()
        self.test_svid_register_endpoint()
        
        # Configuration file tests
        self.test_config_files()
        
        # Summary
        print("\n" + "=" * 60)
        print(f"📊 Test Results: {self.tests_passed}/{self.tests_run} passed")
        
        if self.failed_tests:
            print("\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"   • {test['name']}: {test['details']}")
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        print(f"✅ Success Rate: {success_rate:.1f}%")
        
        return self.tests_passed == self.tests_run

def main():
    """Main test execution"""
    tester = SingraVoxAPITester()
    success = tester.run_all_tests()
    
    # Return appropriate exit code
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())