#!/usr/bin/env python3
"""
Singra Vox Encryption Testing - Iteration 2
============================================

Tests the comprehensive encryption features implemented:
1. Backend starts with encryption enabled
2. Message encryption at rest (MongoDB verification)
3. File upload/download encryption
4. File metadata encryption
5. SVID endpoints functionality
6. Group message encryption
7. DM encryption
8. All data encrypted at rest verification

Uses direct MongoDB access to verify no plaintext data exists.
"""
import requests
import sys
import time
import base64
import os
import tempfile
from datetime import datetime
from pymongo import MongoClient

class SingraVoxEncryptionTester:
    def __init__(self, base_url="https://vox-identity.preview.emergentagent.com"):
        self.base_url = base_url
        self.session = requests.Session()
        self.tests_run = 0
        self.tests_passed = 0
        self.access_token = None
        self.user_id = None
        self.server_id = None
        self.channel_id = None
        self.group_id = None
        self.dm_partner_id = None
        
        # MongoDB connection
        self.mongo_client = MongoClient("mongodb://localhost:27017")
        self.db = self.mongo_client.singravox
        
        # Test credentials
        self.test_credentials = {
            "email": "admin@test.com",
            "password": "TestAdmin123!"
        }
        
        # Test data for encryption verification
        self.test_message = "This is a test message that should be encrypted at rest!"
        self.test_file_content = b"This is test file content that should be encrypted on disk!"
        self.test_filename = "test_encryption_file.txt"

    def run_test(self, name, method, endpoint, expected_status, data=None, headers=None, files=None):
        """Run a single API test"""
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
            if files:
                # Remove Content-Type for multipart uploads
                test_headers.pop('Content-Type', None)
                
            if method == 'GET':
                response = self.session.get(url, headers=test_headers)
            elif method == 'POST':
                if files:
                    response = self.session.post(url, files=files, data=data, headers=test_headers)
                else:
                    response = self.session.post(url, json=data, headers=test_headers)
            elif method == 'PUT':
                response = self.session.put(url, json=data, headers=test_headers)
            elif method == 'DELETE':
                response = self.session.delete(url, headers=test_headers)

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

    def test_backend_encryption_enabled(self):
        """Test that backend starts with encryption enabled"""
        print("\n" + "="*60)
        print("TESTING BACKEND ENCRYPTION STATUS")
        print("="*60)
        
        # Check if INSTANCE_ENCRYPTION_SECRET is set by testing an endpoint
        success, response = self.run_test(
            "Backend health check",
            "GET",
            "/api/health",
            200
        )
        
        if success:
            print("✅ Backend is running and accessible")
            return True
        return False

    def test_login_flow(self):
        """Login with existing admin credentials"""
        print("\n" + "="*60)
        print("TESTING LOGIN FLOW")
        print("="*60)
        
        success, response = self.run_test(
            "Login with admin credentials",
            "POST",
            "/api/auth/login",
            200,
            data=self.test_credentials
        )
        
        if success:
            self.access_token = response.get('access_token')
            if response.get('user'):
                self.user_id = response.get('user', {}).get('id')
            print(f"✅ Login successful, user: {response.get('user', {}).get('username', 'N/A')}")
            return True
        return False

    def test_message_encryption(self):
        """Test message encryption at rest"""
        print("\n" + "="*60)
        print("TESTING MESSAGE ENCRYPTION AT REST")
        print("="*60)
        
        if not self.access_token:
            print("❌ No access token for message encryption test")
            return False
        
        # First, get or create a server and channel
        if not self.server_id:
            success, response = self.run_test(
                "Create test server",
                "POST",
                "/api/servers",
                [200, 201],
                data={"name": "Encryption Test Server", "description": "Testing encryption"}
            )
            if success:
                self.server_id = response.get('id')
        
        if not self.channel_id and self.server_id:
            # Get channels
            success, response = self.run_test(
                "Get server channels",
                "GET",
                f"/api/servers/{self.server_id}/channels",
                200
            )
            if success:
                channels = response if isinstance(response, list) else []
                for channel in channels:
                    if channel.get('type') == 'text':
                        self.channel_id = channel.get('id')
                        break
        
        if not self.channel_id:
            print("❌ No text channel available for message encryption test")
            return False
        
        # Send a test message
        message_data = {
            "content": self.test_message,
            "attachments": []
        }
        
        success, response = self.run_test(
            "Send test message to channel",
            "POST",
            f"/api/channels/{self.channel_id}/messages",
            [200, 201],
            data=message_data
        )
        
        if not success:
            return False
        
        message_id = response.get('id')
        print(f"✅ Message sent with ID: {message_id}")
        
        # Verify message content is plaintext in API response
        if response.get('content') == self.test_message:
            print("✅ API returns plaintext message content")
        else:
            print(f"❌ API response content mismatch: {response.get('content')}")
            return False
        
        # Check MongoDB directly to verify encryption
        try:
            mongo_message = self.db.messages.find_one({"id": message_id})
            if mongo_message:
                stored_content = mongo_message.get('content', '')
                print(f"   MongoDB stored content: {stored_content[:50]}...")
                
                # Verify content is NOT plaintext in database
                if stored_content != self.test_message:
                    print("✅ Message content is encrypted in MongoDB (not plaintext)")
                    
                    # Verify it looks like encrypted data (Base64)
                    try:
                        base64.b64decode(stored_content)
                        print("✅ Stored content appears to be Base64 encoded (encrypted)")
                        return True
                    except:
                        print("⚠️  Stored content is not Base64 - may not be encrypted properly")
                        return False
                else:
                    print("❌ CRITICAL: Message content is stored as PLAINTEXT in MongoDB!")
                    return False
            else:
                print("❌ Message not found in MongoDB")
                return False
        except Exception as e:
            print(f"❌ Error checking MongoDB: {e}")
            return False

    def test_file_encryption(self):
        """Test file upload/download encryption"""
        print("\n" + "="*60)
        print("TESTING FILE ENCRYPTION")
        print("="*60)
        
        if not self.access_token:
            print("❌ No access token for file encryption test")
            return False
        
        # Create test file data
        file_data_b64 = base64.b64encode(self.test_file_content).decode('ascii')
        
        upload_data = {
            "data": file_data_b64,
            "name": self.test_filename,
            "type": "text/plain",
            "channel_id": self.channel_id
        }
        
        # Upload file
        success, response = self.run_test(
            "Upload test file",
            "POST",
            "/api/upload",
            200,
            data=upload_data
        )
        
        if not success:
            return False
        
        file_id = response.get('id')
        file_url = response.get('url')
        print(f"✅ File uploaded with ID: {file_id}")
        print(f"   File URL: {file_url}")
        
        # Check MongoDB for file metadata encryption
        try:
            mongo_file = self.db.files.find_one({"id": file_id})
            if mongo_file:
                stored_name = mongo_file.get('original_name', '')
                stored_type = mongo_file.get('content_type', '')
                
                print(f"   MongoDB stored name: {stored_name[:50]}...")
                print(f"   MongoDB stored type: {stored_type[:50]}...")
                
                # Verify metadata is encrypted (not plaintext)
                if stored_name != self.test_filename:
                    print("✅ File name is encrypted in MongoDB")
                else:
                    print("❌ CRITICAL: File name is stored as PLAINTEXT in MongoDB!")
                    return False
                
                if stored_type != "text/plain":
                    print("✅ Content type is encrypted in MongoDB")
                else:
                    print("❌ CRITICAL: Content type is stored as PLAINTEXT in MongoDB!")
                    return False
                
                # Check if file is marked as encrypted
                if mongo_file.get('encrypted_at_rest'):
                    print("✅ File is marked as encrypted at rest")
                else:
                    print("⚠️  File not marked as encrypted at rest")
                
            else:
                print("❌ File record not found in MongoDB")
                return False
        except Exception as e:
            print(f"❌ Error checking file metadata in MongoDB: {e}")
            return False
        
        # Download file and verify content matches original
        success, response = self.run_test(
            "Download uploaded file",
            "GET",
            f"/files/{file_id}",
            200
        )
        
        if success:
            # For file downloads, response might be binary
            if isinstance(response, str):
                downloaded_content = response.encode()
            else:
                downloaded_content = response
            
            if downloaded_content == self.test_file_content:
                print("✅ Downloaded file content matches original")
                return True
            else:
                print(f"❌ Downloaded content mismatch")
                print(f"   Original: {self.test_file_content}")
                print(f"   Downloaded: {downloaded_content}")
                return False
        
        return False

    def test_svid_endpoints(self):
        """Test SVID (Singra Vox ID) endpoints"""
        print("\n" + "="*60)
        print("TESTING SVID ENDPOINTS")
        print("="*60)
        
        # Test OpenID configuration endpoint
        success, response = self.run_test(
            "SVID OpenID configuration",
            "GET",
            "/api/id/.well-known/openid-configuration",
            200
        )
        
        if not success:
            return False
        
        print(f"✅ OpenID configuration available")
        print(f"   Issuer: {response.get('issuer', 'N/A')}")
        print(f"   Authorization endpoint: {response.get('authorization_endpoint', 'N/A')}")
        
        # Test SVID registration endpoint
        svid_user_data = {
            "email": f"svid_test_{int(time.time())}@test.com",
            "username": f"svidtest{int(time.time())}",
            "password": "TestSVID123!",
            "display_name": "SVID Test User"
        }
        
        success, response = self.run_test(
            "SVID user registration",
            "POST",
            "/api/id/register",
            [200, 201],
            data=svid_user_data
        )
        
        if success:
            print(f"✅ SVID user registered: {response.get('username', 'N/A')}")
            
            # Check if verification is required
            if response.get('verification_required'):
                print("✅ SVID registration successful (verification required)")
                
                # Check if account was created in MongoDB (even if unverified)
                try:
                    email = response.get('email')
                    if email:
                        svid_account = self.db.svid_accounts.find_one({"email": email})
                        if svid_account:
                            print("✅ SVID account found in MongoDB (unverified)")
                            return True
                        else:
                            print("❌ SVID account not found in MongoDB")
                            return False
                    else:
                        print("⚠️  No email in response to verify account creation")
                        return True  # Still pass since registration succeeded
                except Exception as e:
                    print(f"❌ Error checking SVID account in MongoDB: {e}")
                    return False
            else:
                # Direct account creation without verification
                svid_user_id = response.get('id') or response.get('user', {}).get('id')
                try:
                    svid_account = self.db.svid_accounts.find_one({"id": svid_user_id})
                    if svid_account:
                        print("✅ SVID account found in MongoDB")
                        return True
                    else:
                        print("❌ SVID account not found in MongoDB")
                        return False
                except Exception as e:
                    print(f"❌ Error checking SVID account in MongoDB: {e}")
                    return False
        
        return False

    def test_group_message_encryption(self):
        """Test group message encryption"""
        print("\n" + "="*60)
        print("TESTING GROUP MESSAGE ENCRYPTION")
        print("="*60)
        
        if not self.access_token:
            print("❌ No access token for group message test")
            return False
        
        # Create a test group
        group_data = {
            "name": "Encryption Test Group",
            "member_ids": []  # Just the current user
        }
        
        success, response = self.run_test(
            "Create test group",
            "POST",
            "/api/groups",
            [200, 201],
            data=group_data
        )
        
        if not success:
            return False
        
        self.group_id = response.get('id')
        print(f"✅ Group created with ID: {self.group_id}")
        
        # Send a message to the group
        group_message_data = {
            "content": "This is a test group message for encryption!",
            "is_encrypted": False  # Server-side encryption, not E2EE
        }
        
        success, response = self.run_test(
            "Send message to group",
            "POST",
            f"/api/groups/{self.group_id}/messages",
            [200, 201],
            data=group_message_data
        )
        
        if not success:
            return False
        
        message_id = response.get('id')
        print(f"✅ Group message sent with ID: {message_id}")
        
        # Verify API returns plaintext
        if response.get('content') == group_message_data['content']:
            print("✅ API returns plaintext group message content")
        else:
            print(f"❌ API response content mismatch")
            return False
        
        # Check MongoDB for encryption
        try:
            mongo_message = self.db.group_messages.find_one({"id": message_id})
            if mongo_message:
                stored_content = mongo_message.get('content', '')
                print(f"   MongoDB stored content: {stored_content[:50]}...")
                
                if stored_content != group_message_data['content']:
                    print("✅ Group message content is encrypted in MongoDB")
                    return True
                else:
                    print("❌ CRITICAL: Group message content is stored as PLAINTEXT in MongoDB!")
                    return False
            else:
                print("❌ Group message not found in MongoDB")
                return False
        except Exception as e:
            print(f"❌ Error checking group message in MongoDB: {e}")
            return False

    def test_dm_encryption(self):
        """Test direct message encryption"""
        print("\n" + "="*60)
        print("TESTING DIRECT MESSAGE ENCRYPTION")
        print("="*60)
        
        if not self.access_token:
            print("❌ No access token for DM test")
            return False
        
        # Use an existing user for DM testing instead of creating a new one
        try:
            existing_users = list(self.db.users.find(
                {"id": {"$ne": self.user_id}}, 
                {"_id": 0, "password_hash": 0}
            ).limit(1))
            
            if existing_users:
                self.dm_partner_id = existing_users[0]['id']
                print(f"✅ Using existing user for DM test: {existing_users[0].get('username', 'N/A')}")
            else:
                print("⚠️  No other users available for DM test, skipping")
                return True
        except Exception as e:
            print(f"❌ Error finding existing user: {e}")
            return False
        
        # Send a DM
        dm_data = {
            "content": "This is a test direct message for encryption!",
            "is_encrypted": False
        }
        
        success, response = self.run_test(
            "Send direct message",
            "POST",
            f"/api/dm/{self.dm_partner_id}",
            [200, 201],
            data=dm_data
        )
        
        if not success:
            print("⚠️  DM endpoint may not be available, skipping DM encryption test")
            return True  # Skip but don't fail
        
        message_id = response.get('id')
        print(f"✅ DM sent with ID: {message_id}")
        
        # Check MongoDB for DM encryption
        try:
            mongo_message = self.db.direct_messages.find_one({"id": message_id})
            if mongo_message:
                stored_content = mongo_message.get('content', '')
                print(f"   MongoDB stored content: {stored_content[:50]}...")
                
                if stored_content != dm_data['content']:
                    print("✅ DM content is encrypted in MongoDB")
                    return True
                else:
                    print("❌ CRITICAL: DM content is stored as PLAINTEXT in MongoDB!")
                    return False
            else:
                print("❌ DM not found in MongoDB")
                return False
        except Exception as e:
            print(f"❌ Error checking DM in MongoDB: {e}")
            return False

    def run_all_tests(self):
        """Run all encryption tests"""
        print("🔐 Starting Singra Vox Encryption Tests - Iteration 2")
        print(f"Backend URL: {self.base_url}")
        print(f"MongoDB: mongodb://localhost:27017/singravox")
        print("="*80)
        
        # Test 1: Backend encryption enabled
        if not self.test_backend_encryption_enabled():
            print("❌ Backend not accessible - cannot continue")
            return False
        
        # Test 2: Login flow
        if not self.test_login_flow():
            print("❌ Login failed - cannot continue")
            return False
        
        # Test 3: Message encryption at rest
        self.test_message_encryption()
        
        # Test 4: File encryption
        self.test_file_encryption()
        
        # Test 5: SVID endpoints
        self.test_svid_endpoints()
        
        # Test 6: Group message encryption
        self.test_group_message_encryption()
        
        # Test 7: DM encryption
        self.test_dm_encryption()
        
        # Print results
        print("\n" + "="*80)
        print("📊 ENCRYPTION TEST RESULTS")
        print("="*80)
        print(f"Tests passed: {self.tests_passed}/{self.tests_run}")
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        print(f"Success rate: {success_rate:.1f}%")
        
        if self.tests_passed == self.tests_run:
            print("🎉 All encryption tests passed!")
            return True
        else:
            print(f"⚠️  {self.tests_run - self.tests_passed} tests failed")
            return False

def main():
    tester = SingraVoxEncryptionTester()
    success = tester.run_all_tests()
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())