# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""E2EE (End-to-End Encryption) API tests"""
import pytest
import requests
import os
import base64
import secrets

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")

def get_token():
    resp = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@singravox.local",
        "password": "Admin1234!"
    })
    if resp.status_code == 200:
        return resp.json().get("access_token")
    return None

def random_b64(n=32):
    return base64.b64encode(secrets.token_bytes(n)).decode()

@pytest.fixture(scope="module")
def auth_headers():
    token = get_token()
    if not token:
        pytest.skip("Cannot authenticate")
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

@pytest.fixture(scope="module")
def server_id(auth_headers):
    resp = requests.get(f"{BASE_URL}/api/servers", headers=auth_headers)
    servers = resp.json()
    if servers:
        return servers[0]["id"]
    # Create a server
    resp = requests.post(f"{BASE_URL}/api/servers", headers=auth_headers, json={"name": "E2EE Test Server"})
    return resp.json()["id"]

class TestE2EEState:
    """Test E2EE state endpoint"""

    def test_e2ee_state_returns_structure(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/e2ee/state", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "enabled" in data
        assert "account" in data
        assert "devices" in data
        assert "current_device" in data
        print(f"E2EE state: enabled={data['enabled']}")

    def test_e2ee_state_unauthenticated(self):
        resp = requests.get(f"{BASE_URL}/api/e2ee/state")
        assert resp.status_code in [401, 403]


class TestE2EEBootstrap:
    """Test E2EE bootstrap (setup) endpoint"""
    bootstrapped_device_id = None

    def test_bootstrap_e2ee(self, auth_headers):
        device_id = random_b64(16)
        device_pub = random_b64(32)
        recovery_pub = random_b64(32)
        encrypted_recovery = random_b64(64)
        recovery_salt = random_b64(16)
        recovery_nonce = random_b64(24)

        payload = {
            "device_id": device_id,
            "device_name": "TEST_Web_Device",
            "device_public_key": device_pub,
            "recovery_public_key": recovery_pub,
            "encrypted_recovery_private_key": encrypted_recovery,
            "recovery_salt": recovery_salt,
            "recovery_nonce": recovery_nonce,
        }
        # Send device-id header
        headers = dict(auth_headers)
        headers["X-Singra-Device-Id"] = device_id

        resp = requests.post(f"{BASE_URL}/api/e2ee/bootstrap", headers=headers, json=payload)
        if resp.status_code == 409:
            # Already configured from previous test run - that's OK, fetch existing device_id
            state_resp = requests.get(f"{BASE_URL}/api/e2ee/state", headers=auth_headers)
            state_data = state_resp.json()
            if state_data.get("enabled") and state_data.get("devices"):
                TestE2EEBootstrap.bootstrapped_device_id = state_data["devices"][0]["device_id"]
                print(f"E2EE already configured, using existing device: {TestE2EEBootstrap.bootstrapped_device_id}")
                return
            pytest.fail("Bootstrap failed with 409 and no existing devices")
        assert resp.status_code == 200, f"Bootstrap failed: {resp.text}"
        data = resp.json()
        assert data.get("enabled"), "E2EE should be enabled after bootstrap"
        TestE2EEBootstrap.bootstrapped_device_id = device_id
        print(f"Bootstrap success: enabled={data['enabled']}, devices={len(data.get('devices', []))}")

    def test_e2ee_state_after_bootstrap(self, auth_headers):
        """Verify /api/e2ee/state returns enabled:true after bootstrap"""
        resp = requests.get(f"{BASE_URL}/api/e2ee/state", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["enabled"], f"E2EE should be enabled after bootstrap, got: {data}"
        assert data["account"] is not None
        assert len(data["devices"]) >= 1
        print(f"State after bootstrap: enabled={data['enabled']}, device_count={len(data['devices'])}")

    def test_e2ee_devices_list(self, auth_headers):
        resp = requests.get(f"{BASE_URL}/api/e2ee/state", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        devices = data["devices"]
        assert len(devices) >= 1
        device = devices[0]
        assert "device_id" in device
        assert "device_name" in device
        print(f"Device: {device['device_name']}, verified={device.get('verified_at')}")


class TestE2EEChannel:
    """Test creating and using E2EE-enabled channels"""
    channel_id = None

    def test_create_e2ee_channel(self, auth_headers, server_id):
        """Create a channel with E2EE (is_private=True)"""
        payload = {
            "name": "TEST_e2ee_channel",
            "channel_type": "text",
            "is_private": True  # E2EE flag
        }
        resp = requests.post(
            f"{BASE_URL}/api/servers/{server_id}/channels",
            headers=auth_headers,
            json=payload
        )
        assert resp.status_code == 200, f"Create E2EE channel failed: {resp.text}"
        data = resp.json()
        assert data.get("is_private")
        assert "e2ee_channel" in data["name"].lower()
        TestE2EEChannel.channel_id = data["id"]
        print(f"Created E2EE channel: {data['id']}, is_private={data['is_private']}")

    def test_get_e2ee_channel_recipients(self, auth_headers):
        """Test /api/e2ee/channels/{id}/recipients"""
        if not TestE2EEChannel.channel_id:
            pytest.skip("No channel created")
        
        device_id = TestE2EEBootstrap.bootstrapped_device_id
        headers = dict(auth_headers)
        if device_id:
            headers["X-Singra-Device-Id"] = device_id
        
        resp = requests.get(
            f"{BASE_URL}/api/e2ee/channels/{TestE2EEChannel.channel_id}/recipients",
            headers=headers
        )
        assert resp.status_code == 200, f"Get recipients failed: {resp.text}"
        data = resp.json()
        assert "recipients" in data
        assert len(data["recipients"]) >= 1
        print(f"Channel recipients: {len(data['recipients'])}")

    def test_send_e2ee_message(self, auth_headers):
        """Send an encrypted message to E2EE channel"""
        if not TestE2EEChannel.channel_id:
            pytest.skip("No channel created")
        
        device_id = TestE2EEBootstrap.bootstrapped_device_id
        headers = dict(auth_headers)
        if device_id:
            headers["X-Singra-Device-Id"] = device_id
        
        # Send message with E2EE encrypted format
        payload = {
            "content": "",  # Content is empty for E2EE messages
            "ciphertext": random_b64(64),
            "nonce": random_b64(24),
            "key_envelopes": [
                {
                    "recipient_kind": "device",
                    "recipient_user_id": "56e4b9c8-184f-4c15-a9bd-5dcb625c5545",
                    "recipient_device_id": device_id,
                    "sealed_key": random_b64(80)
                }
            ],
            "sender_device_id": device_id,
            "protocol_version": "sv-e2ee-v1",
            "is_e2ee": True
        }
        resp = requests.post(
            f"{BASE_URL}/api/channels/{TestE2EEChannel.channel_id}/messages",
            headers=headers,
            json=payload
        )
        assert resp.status_code == 200, f"Send E2EE message failed: {resp.text}"
        data = resp.json()
        assert data.get("is_e2ee"), "Message should be marked as e2ee"
        print(f"Sent E2EE message: id={data['id']}, is_e2ee={data.get('is_e2ee')}")

    def test_get_e2ee_messages(self, auth_headers):
        """Verify messages in E2EE channel are encrypted (no plaintext content)"""
        if not TestE2EEChannel.channel_id:
            pytest.skip("No channel created")
        
        device_id = TestE2EEBootstrap.bootstrapped_device_id
        headers = dict(auth_headers)
        if device_id:
            headers["X-Singra-Device-Id"] = device_id
        
        resp = requests.get(
            f"{BASE_URL}/api/channels/{TestE2EEChannel.channel_id}/messages",
            headers=headers
        )
        assert resp.status_code == 200
        data = resp.json()
        messages = data.get("messages", data) if isinstance(data, dict) else data
        if messages:
            msg = messages[-1]
            assert msg.get("is_e2ee"), "Message should be marked as E2EE"
            # Encrypted message should have ciphertext, not readable content
            assert msg.get("ciphertext") or msg.get("encrypted_content"), "Message should have ciphertext"
            print(f"Verified message encryption: is_e2ee={msg.get('is_e2ee')}, has_ciphertext={bool(msg.get('ciphertext'))}")


class TestE2EECleanup:
    """Cleanup test data"""
    
    def test_cleanup_e2ee_device(self, auth_headers):
        """Revoke the test device to clean up"""
        device_id = TestE2EEBootstrap.bootstrapped_device_id
        if not device_id:
            pytest.skip("No device to cleanup")
        
        headers = dict(auth_headers)
        headers["X-Singra-Device-Id"] = device_id
        
        resp = requests.post(
            f"{BASE_URL}/api/e2ee/devices/{device_id}/revoke",
            headers=headers
        )
        # May return 200 or other success code
        print(f"Revoke device response: {resp.status_code}")
        # Don't assert strictly - cleanup
