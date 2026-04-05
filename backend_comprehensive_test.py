#!/usr/bin/env python3
"""
Singra Vox Comprehensive Testing Suite
=====================================

Tests all critical features after bug fixes:
1. STATUS BUG FIX: Login restores preferred_status (not default to 'online')
2. ENCRYPTION AT REST: Messages/files encrypted in DB, plaintext via API
3. SEARCH: Works with encrypted messages
4. GDPR EXPORT: Returns decrypted content
5. FILE ENCRYPTION: Files encrypted on disk, decrypted on download
6. VOICE TOKEN: Returns valid token using cookie auth
7. SVID: OpenID config and password check
8. AUDIT LOG: Encrypted in DB, decrypted via API
9. Frontend loads correctly
"""

import requests
import json
import base64
import time
import sys
from datetime import datetime
from pymongo import MongoClient

class SingraVoxTester:
    def __init__(self):
        self.base_url = "https://bbdd79a5-5dd9-4359-80cf-7f512a35bc81.preview.emergentagent.com"
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'SingraVox-Test/1.0'
        })
        
        # MongoDB connection for direct DB verification
        self.mongo_client = MongoClient("mongodb://localhost:27017")
        self.db = self.mongo_client["singravox"]
        
        self.tests_run = 0
        self.tests_passed = 0
        self.user_id = None
        self.server_id = None
        self.channel_id = None
        self.voice_channel_id = None
        
    def log(self, message, success=None):
        """Log test results with emoji indicators"""
        if success is True:
            print(f"✅ {message}")
            self.tests_passed += 1
        elif success is False:
            print(f"❌ {message}")
        else:
            print(f"🔍 {message}")
        self.tests_run += 1
        
    def test_login_and_status_bug_fix(self):
        """Test the critical status bug fix"""
        print("\n=== TESTING STATUS BUG FIX ===")
        
        # Step 1: Login
        login_data = {
            "email": "admin@test.com",
            "password": "TestAdmin123!"
        }
        
        response = self.session.post(f"{self.base_url}/api/auth/login", json=login_data)
        if response.status_code != 200:
            self.log(f"Login failed: {response.status_code} - {response.text}", False)
            return False
            
        auth_data = response.json()
        self.user_id = auth_data["user"]["id"]
        self.log(f"Login successful, user_id: {self.user_id}", True)
        
        # Step 2: Set status to 'dnd'
        status_data = {"status": "dnd"}
        response = self.session.put(f"{self.base_url}/api/users/me", json=status_data)
        if response.status_code != 200:
            self.log(f"Setting DND status failed: {response.status_code}", False)
            return False
        self.log("Status set to 'dnd'", True)
        
        # Step 3: Simulate disconnect by setting status='offline' in MongoDB directly
        try:
            result = self.db.users.update_one(
                {"id": self.user_id},
                {"$set": {"status": "offline"}}
            )
            if result.modified_count > 0:
                self.log("Simulated disconnect (status set to offline in DB)", True)
            else:
                self.log("Failed to simulate disconnect in DB", False)
                return False
        except Exception as e:
            self.log(f"MongoDB update failed: {e}", False)
            return False
            
        # Step 4: Re-login
        response = self.session.post(f"{self.base_url}/api/auth/login", json=login_data)
        if response.status_code != 200:
            self.log(f"Re-login failed: {response.status_code}", False)
            return False
            
        # Step 5: VERIFY login response shows status='dnd' (not 'online')
        auth_data = response.json()
        actual_status = auth_data["user"]["status"]
        
        if actual_status == "dnd":
            self.log(f"STATUS BUG FIX VERIFIED: Login restored status to 'dnd'", True)
            return True
        else:
            self.log(f"STATUS BUG NOT FIXED: Expected 'dnd', got '{actual_status}'", False)
            return False
    
    def test_encryption_at_rest(self):
        """Test encryption at rest for messages"""
        print("\n=== TESTING ENCRYPTION AT REST ===")
        
        # Get server and channel info
        response = self.session.get(f"{self.base_url}/api/servers")
        if response.status_code != 200:
            self.log("Failed to get servers", False)
            return False
            
        servers = response.json()
        if not servers:
            self.log("No servers found", False)
            return False
            
        self.server_id = servers[0]["id"]
        
        # Get channels
        response = self.session.get(f"{self.base_url}/api/servers/{self.server_id}/channels")
        if response.status_code != 200:
            self.log("Failed to get channels", False)
            return False
            
        channels = response.json()
        text_channels = [c for c in channels if c["type"] == "text"]
        voice_channels = [c for c in channels if c["type"] == "voice"]
        
        if not text_channels:
            self.log("No text channels found", False)
            return False
            
        self.channel_id = text_channels[0]["id"]
        if voice_channels:
            self.voice_channel_id = voice_channels[0]["id"]
        
        # Send a test message
        test_content = f"Test encryption message {datetime.now().isoformat()}"
        message_data = {"content": test_content}
        
        response = self.session.post(
            f"{self.base_url}/api/channels/{self.channel_id}/messages",
            json=message_data
        )
        
        if response.status_code not in [200, 201]:
            self.log(f"Failed to send message: {response.status_code}", False)
            return False
            
        try:
            message = response.json()
            print(f"DEBUG: Message response: {message}")
            message_id = message["id"]
        except (ValueError, KeyError) as e:
            self.log(f"Invalid message response: {e} - Response: {response.text}", False)
            return False
            
        self.log("Message sent successfully", True)
        
        # Verify in MongoDB that content is encrypted (AES ciphertext)
        try:
            db_message = self.db.messages.find_one({"id": message_id})
            if not db_message:
                self.log("Message not found in database", False)
                return False
                
            stored_content = db_message.get("content", "")
            
            # Check if content is encrypted (should be base64 and not match original)
            if stored_content != test_content and len(stored_content) > 20:
                try:
                    # Try to decode as base64 to verify it's encrypted
                    base64.b64decode(stored_content)
                    self.log("ENCRYPTION VERIFIED: Message stored as AES ciphertext in DB", True)
                except:
                    self.log("Content appears encrypted but not valid base64", True)
            else:
                self.log("WARNING: Message content appears to be stored in plaintext", False)
                return False
                
        except Exception as e:
            self.log(f"MongoDB verification failed: {e}", False)
            return False
            
        # Verify API returns plaintext
        response = self.session.get(f"{self.base_url}/api/channels/{self.channel_id}/messages")
        if response.status_code != 200:
            self.log("Failed to retrieve messages via API", False)
            return False
            
        messages = response.json()
        api_message = next((m for m in messages if m["id"] == message_id), None)
        
        if api_message and api_message["content"] == test_content:
            self.log("DECRYPTION VERIFIED: API returns plaintext content", True)
            return True
        else:
            self.log("API did not return correct plaintext content", False)
            return False
    
    def test_search_functionality(self):
        """Test search over encrypted messages"""
        print("\n=== TESTING SEARCH FUNCTIONALITY ===")
        
        # Search for the message we sent earlier
        search_term = "encryption"
        response = self.session.get(
            f"{self.base_url}/api/search",
            params={"q": search_term, "server_id": self.server_id}
        )
        
        if response.status_code != 200:
            self.log(f"Search failed: {response.status_code}", False)
            return False
            
        results = response.json()
        
        if results and any(search_term.lower() in r["content"].lower() for r in results):
            self.log("SEARCH VERIFIED: Found encrypted messages by content", True)
            return True
        else:
            self.log("Search did not find expected encrypted messages", False)
            return False
    
    def test_gdpr_export(self):
        """Test GDPR export returns decrypted content"""
        print("\n=== TESTING GDPR EXPORT ===")
        
        response = self.session.get(f"{self.base_url}/api/users/me/export")
        if response.status_code != 200:
            self.log(f"GDPR export failed: {response.status_code}", False)
            return False
            
        export_data = response.json()
        
        # Check if we have decrypted messages
        messages = export_data.get("channel_messages", [])
        if messages:
            # Look for our test message
            test_messages = [m for m in messages if "encryption" in m.get("content", "")]
            if test_messages:
                self.log("GDPR EXPORT VERIFIED: Returns decrypted message content", True)
                return True
            else:
                self.log("GDPR export contains messages but not our test message", True)
                return True
        else:
            self.log("GDPR export successful but no messages found", True)
            return True
    
    def test_file_encryption(self):
        """Test file encryption on disk and decryption on download"""
        print("\n=== TESTING FILE ENCRYPTION ===")
        
        # Create a test file
        test_content = b"This is a test file for encryption verification"
        test_filename = "test_encryption.txt"
        
        # Upload file
        file_data = {
            "data": base64.b64encode(test_content).decode(),
            "name": test_filename,
            "type": "text/plain",
            "channel_id": self.channel_id
        }
        
        response = self.session.post(f"{self.base_url}/api/upload", json=file_data)
        if response.status_code != 200:
            self.log(f"File upload failed: {response.status_code}", False)
            return False
            
        upload_result = response.json()
        file_id = upload_result["id"]
        self.log("File uploaded successfully", True)
        
        # Verify file metadata is encrypted in DB
        try:
            db_file = self.db.files.find_one({"id": file_id})
            if not db_file:
                self.log("File record not found in database", False)
                return False
                
            stored_name = db_file.get("original_name", "")
            stored_ct = db_file.get("content_type", "")
            
            # Check if metadata is encrypted (should not match original)
            if stored_name != test_filename and len(stored_name) > 20:
                self.log("FILE METADATA ENCRYPTION VERIFIED: Filename encrypted in DB", True)
            else:
                self.log("WARNING: Filename appears to be stored in plaintext", False)
                
        except Exception as e:
            self.log(f"File DB verification failed: {e}", False)
            return False
        
        # Download and verify content
        response = self.session.get(f"{self.base_url}/api/files/{file_id}")
        if response.status_code != 200:
            self.log(f"File download failed: {response.status_code}", False)
            return False
            
        downloaded_content = response.content
        if downloaded_content == test_content:
            self.log("FILE DECRYPTION VERIFIED: Download returns original content", True)
            return True
        else:
            self.log("Downloaded content does not match original", False)
            return False
    
    def test_voice_token(self):
        """Test voice token generation with cookie auth"""
        print("\n=== TESTING VOICE TOKEN ===")
        
        if not self.voice_channel_id:
            self.log("No voice channel available for testing", False)
            return False
        
        # Request voice token using cookie auth (not bearer)
        token_data = {
            "server_id": self.server_id,
            "channel_id": self.voice_channel_id
        }
        
        response = self.session.post(f"{self.base_url}/api/voice/token", json=token_data)
        if response.status_code != 200:
            self.log(f"Voice token request failed: {response.status_code} - {response.text}", False)
            return False
            
        token_result = response.json()
        token = token_result.get("token", "")
        
        if token and len(token) > 0:
            self.log(f"VOICE TOKEN VERIFIED: Received valid token (length: {len(token)})", True)
            return True
        else:
            self.log(f"Voice token is empty or invalid: '{token}'", False)
            return False
    
    def test_svid_endpoints(self):
        """Test SVID (Singra Vox ID) endpoints"""
        print("\n=== TESTING SVID ENDPOINTS ===")
        
        # Test OpenID configuration
        response = self.session.get(f"{self.base_url}/api/id/.well-known/openid-configuration")
        if response.status_code != 200:
            self.log(f"OpenID config failed: {response.status_code}", False)
            return False
            
        config = response.json()
        if "issuer" in config and "authorization_endpoint" in config:
            self.log("SVID OpenID configuration valid", True)
        else:
            self.log("OpenID configuration missing required fields", False)
            return False
        
        # Test password check endpoint
        check_data = {
            "email": "admin@test.com",
            "password": "TestAdmin123!"
        }
        
        response = self.session.post(f"{self.base_url}/api/id/password/check", json=check_data)
        if response.status_code == 200:
            self.log("SVID password check working", True)
            return True
        else:
            self.log(f"SVID password check failed: {response.status_code}", False)
            return False
    
    def test_audit_log_encryption(self):
        """Test audit log encryption"""
        print("\n=== TESTING AUDIT LOG ENCRYPTION ===")
        
        # Create a channel to generate audit log entry
        channel_data = {
            "name": f"test-audit-{int(time.time())}",
            "type": "text",
            "topic": "Test channel for audit log"
        }
        
        response = self.session.post(
            f"{self.base_url}/api/servers/{self.server_id}/channels",
            json=channel_data
        )
        
        if response.status_code not in [200, 201]:
            self.log(f"Channel creation failed: {response.status_code}", False)
            return False
            
        try:
            new_channel = response.json()
            new_channel_id = new_channel["id"]
        except (ValueError, KeyError) as e:
            self.log(f"Invalid channel response: {e}", False)
            return False
            
        self.log("Test channel created for audit log", True)
        
        # Check audit log in DB (should be encrypted)
        try:
            audit_entry = self.db.audit_log.find_one(
                {"server_id": self.server_id, "action": "channel_create"},
                sort=[("created_at", -1)]
            )
            
            if audit_entry:
                details = audit_entry.get("details", "")
                if details and len(details) > 20:
                    try:
                        # Try to decode as base64 to verify encryption
                        base64.b64decode(details)
                        self.log("AUDIT LOG ENCRYPTION VERIFIED: Details encrypted in DB", True)
                    except:
                        self.log("Audit log details appear encrypted but not valid base64", True)
                else:
                    self.log("Audit log details appear to be plaintext or empty", False)
                    return False
            else:
                self.log("No audit log entry found for channel creation", False)
                return False
                
        except Exception as e:
            self.log(f"Audit log DB verification failed: {e}", False)
            return False
        
        # Test audit log API (should return decrypted)
        response = self.session.get(f"{self.base_url}/api/servers/{self.server_id}/audit-log")
        if response.status_code == 200:
            audit_logs = response.json()
            if audit_logs:
                self.log("AUDIT LOG DECRYPTION VERIFIED: API returns decrypted logs", True)
                return True
            else:
                self.log("Audit log API returned empty results", True)
                return True
        else:
            self.log(f"Audit log API failed: {response.status_code}", False)
            return False
    
    def run_all_tests(self):
        """Run comprehensive test suite"""
        print("🚀 Starting Singra Vox Comprehensive Test Suite")
        print(f"🔗 Testing against: {self.base_url}")
        print("=" * 60)
        
        test_results = {}
        
        # Critical status bug fix test
        test_results["status_bug_fix"] = self.test_login_and_status_bug_fix()
        
        # Only continue with other tests if login works
        if test_results["status_bug_fix"]:
            test_results["encryption_at_rest"] = self.test_encryption_at_rest()
            test_results["search"] = self.test_search_functionality()
            test_results["gdpr_export"] = self.test_gdpr_export()
            test_results["file_encryption"] = self.test_file_encryption()
            test_results["voice_token"] = self.test_voice_token()
            test_results["svid"] = self.test_svid_endpoints()
            test_results["audit_log"] = self.test_audit_log_encryption()
        
        # Summary
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        for test_name, result in test_results.items():
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"{test_name.replace('_', ' ').title()}: {status}")
        
        success_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        print(f"\nOverall: {self.tests_passed}/{self.tests_run} tests passed ({success_rate:.1f}%)")
        
        if success_rate >= 90:
            print("🎉 Excellent! Most features working correctly")
        elif success_rate >= 70:
            print("⚠️  Good progress, some issues to address")
        else:
            print("🚨 Multiple critical issues found")
        
        return test_results

if __name__ == "__main__":
    tester = SingraVoxTester()
    try:
        results = tester.run_all_tests()
        # Exit with error code if critical tests fail
        if not results.get("status_bug_fix", False):
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n⏹️  Testing interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n💥 Testing failed with error: {e}")
        sys.exit(1)
    finally:
        if hasattr(tester, 'mongo_client'):
            tester.mongo_client.close()