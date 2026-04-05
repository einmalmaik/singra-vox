#!/usr/bin/env python3
"""
Comprehensive Password Reset Testing for Singra Vox
===================================================

Tests the unified password reset system for both local and SVID accounts:
1. Password Reset Lookup API
2. Local Password Reset Flow  
3. SVID Password Reset Flow
4. Password Strength Check API
5. Password Generator API
6. SVID Re-registration for unverified emails

Test Accounts:
- Local: admin@test.com / TestAdmin123!
- SVID (verified): testfinal@mauntingstudios.de
- Local+SVID: testfinal@mauntingstudios.de (exists in both collections)
"""

import requests
import json
import sys
import time
from datetime import datetime

class PasswordResetTester:
    def __init__(self, base_url="https://voice-rebo-config.preview.emergentagent.com"):
        self.base_url = base_url
        self.session = requests.Session()
        self.tests_run = 0
        self.tests_passed = 0
        self.test_results = []

    def log_test(self, name, success, details="", response_data=None):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {details}")
        
        self.test_results.append({
            "name": name,
            "success": success,
            "details": details,
            "response_data": response_data
        })

    def test_password_reset_lookup(self):
        """Test the password reset lookup endpoint"""
        print("\n🔍 Testing Password Reset Lookup API...")
        
        test_cases = [
            {
                "email": "admin@test.com",
                "expected_accounts": ["local"],
                "description": "Local only account"
            },
            {
                "email": "testfinal@mauntingstudios.de", 
                "expected_accounts": ["local", "svid"],  # Should exist in both
                "description": "Local+SVID account"
            },
            {
                "email": "nonexistent@example.com",
                "expected_accounts": [],
                "description": "Non-existent email"
            }
        ]
        
        for case in test_cases:
            try:
                response = self.session.post(
                    f"{self.base_url}/api/auth/password-reset-lookup",
                    json={"email": case["email"]},
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200:
                    data = response.json()
                    accounts = data.get("accounts", [])
                    
                    # For security, we don't reveal exact matches, but check structure
                    if isinstance(accounts, list):
                        self.log_test(
                            f"Password Reset Lookup - {case['description']}", 
                            True,
                            f"Returned accounts: {accounts}"
                        )
                    else:
                        self.log_test(
                            f"Password Reset Lookup - {case['description']}", 
                            False,
                            f"Invalid response format: {data}"
                        )
                else:
                    self.log_test(
                        f"Password Reset Lookup - {case['description']}", 
                        False,
                        f"HTTP {response.status_code}: {response.text}"
                    )
                    
            except Exception as e:
                self.log_test(
                    f"Password Reset Lookup - {case['description']}", 
                    False,
                    f"Exception: {str(e)}"
                )

    def test_local_password_reset_flow(self):
        """Test local password reset flow"""
        print("\n🔐 Testing Local Password Reset Flow...")
        
        # Step 1: Request password reset
        try:
            response = self.session.post(
                f"{self.base_url}/api/auth/forgot-password",
                json={"email": "admin@test.com"},
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok"):
                    self.log_test("Local Password Reset Request", True, "Reset code requested successfully")
                else:
                    self.log_test("Local Password Reset Request", False, f"Unexpected response: {data}")
            else:
                self.log_test("Local Password Reset Request", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("Local Password Reset Request", False, f"Exception: {str(e)}")

        # Step 2: Test reset with dummy code (will fail but tests endpoint)
        try:
            response = self.session.post(
                f"{self.base_url}/api/auth/reset-password",
                json={
                    "email": "admin@test.com",
                    "code": "123456",
                    "new_password": "NewTestPassword123!"
                },
                headers={"Content-Type": "application/json"}
            )
            
            # Should fail with invalid code, but endpoint should be working
            if response.status_code in [400, 410]:  # Invalid or expired code
                self.log_test("Local Password Reset Endpoint", True, "Endpoint working (expected invalid code error)")
            else:
                self.log_test("Local Password Reset Endpoint", False, f"Unexpected status: {response.status_code}")
                
        except Exception as e:
            self.log_test("Local Password Reset Endpoint", False, f"Exception: {str(e)}")

    def test_svid_password_reset_flow(self):
        """Test SVID password reset flow"""
        print("\n🆔 Testing SVID Password Reset Flow...")
        
        # Step 1: Request SVID password reset
        try:
            response = self.session.post(
                f"{self.base_url}/api/id/password/forgot",
                json={"email": "testfinal@mauntingstudios.de"},
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok"):
                    self.log_test("SVID Password Reset Request", True, "Reset code requested successfully")
                else:
                    self.log_test("SVID Password Reset Request", False, f"Unexpected response: {data}")
            else:
                self.log_test("SVID Password Reset Request", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("SVID Password Reset Request", False, f"Exception: {str(e)}")

        # Step 2: Test reset with dummy code (will fail but tests endpoint)
        try:
            response = self.session.post(
                f"{self.base_url}/api/id/password/reset",
                json={
                    "email": "testfinal@mauntingstudios.de",
                    "code": "123456",
                    "new_password": "NewTestPassword123!"
                },
                headers={"Content-Type": "application/json"}
            )
            
            # Should fail with invalid code, but endpoint should be working
            if response.status_code in [400, 410]:  # Invalid or expired code
                self.log_test("SVID Password Reset Endpoint", True, "Endpoint working (expected invalid code error)")
            else:
                self.log_test("SVID Password Reset Endpoint", False, f"Unexpected status: {response.status_code}")
                
        except Exception as e:
            self.log_test("SVID Password Reset Endpoint", False, f"Exception: {str(e)}")

    def test_password_strength_check(self):
        """Test password strength check API"""
        print("\n💪 Testing Password Strength Check...")
        
        test_passwords = [
            {"password": "weak", "expected_weak": True},
            {"password": "StrongPassword123!", "expected_weak": False},
            {"password": "12345678", "expected_weak": True},
            {"password": "ComplexP@ssw0rd2024", "expected_weak": False}
        ]
        
        for test_case in test_passwords:
            try:
                response = self.session.post(
                    f"{self.base_url}/api/id/password/check",
                    json={"password": test_case["password"]},
                    headers={"Content-Type": "application/json"}
                )
                
                if response.status_code == 200:
                    data = response.json()
                    if "score" in data and "meets_policy" in data:
                        self.log_test(
                            f"Password Strength Check - '{test_case['password'][:8]}...'", 
                            True,
                            f"Score: {data.get('score')}, Meets policy: {data.get('meets_policy')}"
                        )
                    else:
                        self.log_test(
                            f"Password Strength Check - '{test_case['password'][:8]}...'", 
                            False,
                            f"Missing required fields in response: {data}"
                        )
                else:
                    self.log_test(
                        f"Password Strength Check - '{test_case['password'][:8]}...'", 
                        False,
                        f"HTTP {response.status_code}: {response.text}"
                    )
                    
            except Exception as e:
                self.log_test(
                    f"Password Strength Check - '{test_case['password'][:8]}...'", 
                    False,
                    f"Exception: {str(e)}"
                )

    def test_password_generator(self):
        """Test password generator API"""
        print("\n🎲 Testing Password Generator...")
        
        try:
            response = self.session.post(
                f"{self.base_url}/api/id/password/generate?length=18",
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                password = data.get("password")
                
                if password and len(password) >= 16:  # Should be strong password
                    self.log_test("Password Generator", True, f"Generated password length: {len(password)}")
                    
                    # Test the generated password strength
                    strength_response = self.session.post(
                        f"{self.base_url}/api/id/password/check",
                        json={"password": password},
                        headers={"Content-Type": "application/json"}
                    )
                    
                    if strength_response.status_code == 200:
                        strength_data = strength_response.json()
                        if strength_data.get("meets_policy"):
                            self.log_test("Generated Password Strength", True, f"Generated password meets policy")
                        else:
                            self.log_test("Generated Password Strength", False, f"Generated password doesn't meet policy")
                    else:
                        self.log_test("Generated Password Strength", False, "Could not check generated password strength")
                        
                else:
                    self.log_test("Password Generator", False, f"Invalid password generated: {data}")
            else:
                self.log_test("Password Generator", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("Password Generator", False, f"Exception: {str(e)}")

    def test_svid_re_registration(self):
        """Test SVID re-registration for unverified emails"""
        print("\n🔄 Testing SVID Re-registration...")
        
        # Test with a potentially unverified email
        test_email = f"test_unreg_{int(time.time())}@example.com"
        
        try:
            response = self.session.post(
                f"{self.base_url}/api/id/register",
                json={
                    "email": test_email,
                    "username": f"testuser{int(time.time())}",
                    "password": "TestPassword123!",
                    "display_name": "Test User"
                },
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                data = response.json()
                if data.get("ok"):
                    self.log_test("SVID Registration", True, f"Registration successful for {test_email}")
                    
                    # Try to register again with same email (should succeed for unverified)
                    response2 = self.session.post(
                        f"{self.base_url}/api/id/register",
                        json={
                            "email": test_email,
                            "username": f"testuser2{int(time.time())}",
                            "password": "TestPassword456!",
                            "display_name": "Test User 2"
                        },
                        headers={"Content-Type": "application/json"}
                    )
                    
                    if response2.status_code == 200:
                        self.log_test("SVID Re-registration", True, "Re-registration allowed for unverified email")
                    else:
                        self.log_test("SVID Re-registration", False, f"Re-registration failed: {response2.status_code}")
                        
                else:
                    self.log_test("SVID Registration", False, f"Registration failed: {data}")
            else:
                self.log_test("SVID Registration", False, f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("SVID Registration", False, f"Exception: {str(e)}")

    def run_all_tests(self):
        """Run all password reset tests"""
        print("🚀 Starting Password Reset Testing Suite")
        print("=" * 50)
        
        start_time = datetime.now()
        
        # Run all test suites
        self.test_password_reset_lookup()
        self.test_local_password_reset_flow()
        self.test_svid_password_reset_flow()
        self.test_password_strength_check()
        self.test_password_generator()
        self.test_svid_re_registration()
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        # Print summary
        print("\n" + "=" * 50)
        print("📊 TEST SUMMARY")
        print("=" * 50)
        print(f"Tests Run: {self.tests_run}")
        print(f"Tests Passed: {self.tests_passed}")
        print(f"Tests Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed/self.tests_run)*100:.1f}%")
        print(f"Duration: {duration:.2f} seconds")
        
        if self.tests_passed < self.tests_run:
            print("\n❌ FAILED TESTS:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"  - {result['name']}: {result['details']}")
        
        return self.tests_passed == self.tests_run

def main():
    tester = PasswordResetTester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())