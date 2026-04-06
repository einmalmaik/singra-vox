# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Realtime smoke for message and typing sync through the public proxy.

This script creates a temporary user, joins a real server through an invite and
verifies bidirectional typing + message delivery over WebSocket. It is meant as
an acceptance-style regression check for the Desktop/Web live sync path.
"""
from __future__ import annotations

import json
import random
import re
import string
import time

import requests
import websocket


API_BASE = "http://127.0.0.1:8080/api"
MAILPIT_BASE = "http://127.0.0.1:8025/api/v1"
DEFAULT_PASSWORD = "Password123!"
OWNER_LOGIN = {
    "email": "owner@example.com",
    "password": DEFAULT_PASSWORD,
}


def rnd(length: int = 8) -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(length))


def wait_for_mail_code(recipient: str, subject_contains: str, timeout_seconds: int = 20) -> str:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        payload = requests.get(f"{MAILPIT_BASE}/messages", timeout=10).json()
        for message in payload.get("messages", []):
            recipients = [entry.get("Address", "").lower() for entry in (message.get("To") or [])]
            if recipient.lower() not in recipients:
                continue
            if subject_contains.lower() not in message.get("Subject", "").lower():
                continue

            detail = requests.get(f"{MAILPIT_BASE}/message/{message['ID']}", timeout=10).json()
            for candidate in (detail.get("Text", ""), detail.get("HTML", ""), detail.get("Snippet", "")):
                match = re.search(r"\b(\d{4,8})\b", candidate or "")
                if match:
                    return match.group(1)
        time.sleep(1)
    raise TimeoutError(f"Mail for {recipient} with subject {subject_contains!r} not found")


def drain_socket_messages(ws) -> None:
    ws.settimeout(0.25)
    try:
        while True:
            ws.recv()
    except Exception:
        return
    finally:
        ws.settimeout(5)


def recv_until(ws, event_type: str, timeout_seconds: int = 8) -> dict:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        payload = json.loads(ws.recv())
        if payload.get("type") == event_type:
            return payload
    raise TimeoutError(f"Did not receive {event_type!r} within {timeout_seconds}s")


def main() -> None:
    owner = requests.Session()
    owner_login = owner.post(f"{API_BASE}/auth/login", json=OWNER_LOGIN, timeout=20)
    owner_login.raise_for_status()
    owner_token = owner_login.json()["access_token"]

    servers = owner.get(f"{API_BASE}/servers", timeout=20).json()
    if not servers:
        raise RuntimeError("Owner is not part of any server")
    server_id = servers[0]["id"]
    channels = owner.get(f"{API_BASE}/servers/{server_id}/channels", timeout=20).json()
    text_channel = next((channel for channel in channels if channel["type"] == "text"), None)
    if not text_channel:
        raise RuntimeError("No text channel available for realtime smoke")

    invite_response = owner.post(
        f"{API_BASE}/servers/{server_id}/invites",
        json={"max_uses": 3, "expires_hours": 1},
        timeout=20,
    )
    invite_response.raise_for_status()
    invite_code = invite_response.json()["code"]

    email = f"rt_{rnd()}@example.com"
    username = f"rt{rnd(6)}"
    joined_user = requests.Session()
    register_response = joined_user.post(
        f"{API_BASE}/auth/register",
        json={
            "email": email,
            "username": username,
            "password": DEFAULT_PASSWORD,
            "display_name": "Realtime Smoke",
        },
        timeout=20,
    )
    register_response.raise_for_status()
    verification_code = wait_for_mail_code(email, "Verify your email")
    verify_response = joined_user.post(
        f"{API_BASE}/auth/verify-email",
        json={"email": email, "code": verification_code},
        timeout=20,
    )
    verify_response.raise_for_status()
    joined_token = verify_response.json()["access_token"]

    accept_response = joined_user.post(f"{API_BASE}/invites/{invite_code}/accept", timeout=20)
    accept_response.raise_for_status()

    owner_ws = websocket.create_connection(
        f"ws://127.0.0.1:8080/api/ws?token={owner_token}",
        timeout=10,
        http_proxy_host=None,
        http_proxy_port=None,
    )
    joined_ws = websocket.create_connection(
        f"ws://127.0.0.1:8080/api/ws?token={joined_token}",
        timeout=10,
        http_proxy_host=None,
        http_proxy_port=None,
    )

    try:
        drain_socket_messages(owner_ws)
        drain_socket_messages(joined_ws)

        joined_ws.send(json.dumps({"type": "typing", "channel_id": text_channel["id"]}))
        recv_until(owner_ws, "typing")

        first_message = joined_user.post(
            f"{API_BASE}/channels/{text_channel['id']}/messages",
            json={"content": "web-to-desktop smoke"},
            timeout=20,
        )
        first_message.raise_for_status()
        received_first = recv_until(owner_ws, "new_message")
        assert received_first["message"]["content"] == "web-to-desktop smoke"

        owner_ws.send(json.dumps({"type": "typing", "channel_id": text_channel["id"]}))
        recv_until(joined_ws, "typing")

        second_message = owner.post(
            f"{API_BASE}/channels/{text_channel['id']}/messages",
            json={"content": "desktop-to-web smoke"},
            timeout=20,
        )
        second_message.raise_for_status()
        received_second = recv_until(joined_ws, "new_message")
        assert received_second["message"]["content"] == "desktop-to-web smoke"

        print("Realtime websocket smoke passed")
    finally:
        owner_ws.close()
        joined_ws.close()


if __name__ == "__main__":
    main()
