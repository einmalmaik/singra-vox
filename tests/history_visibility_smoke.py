# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Integration smoke for message history visibility across join time and role grants.

This specifically protects the regression where the client only showed the most
recent page and therefore appeared to "hide" older messages even when the role
explicitly allowed reading full message history.
"""
from __future__ import annotations

from tests.e2ee_acceptance import (
    ApiClient,
    DEFAULT_PASSWORD,
    assert_ok,
    extract_code,
    latest_mail,
    rnd,
)


def login_existing_owner() -> ApiClient:
    owner = ApiClient(
        email="owner@example.com",
        username="owner",
        display_name="Owner",
        password=DEFAULT_PASSWORD,
    )
    payload = assert_ok(owner.post("/auth/login", {
        "email": owner.email,
        "password": owner.password,
    }))
    owner.user = payload["user"]
    return owner


def register_member() -> ApiClient:
    member = ApiClient(
        email=f"history_member_{rnd()}@example.com",
        username=f"history_member_{rnd()}",
        display_name="History Member",
        password=DEFAULT_PASSWORD,
    )
    assert_ok(member.post("/auth/register", {
        "email": member.email,
        "username": member.username,
        "password": member.password,
        "display_name": member.display_name,
    }))
    code = extract_code(latest_mail(member.email, "Verify your email"))
    assert_ok(member.post("/auth/verify-email", {"email": member.email, "code": code}))
    payload = assert_ok(member.post("/auth/login", {
        "email": member.email,
        "password": member.password,
    }))
    member.user = payload["user"]
    return member


def find_first_text_channel(client: ApiClient, server_id: str):
    channels = assert_ok(client.get(f"/servers/{server_id}/channels"))
    for channel in channels:
        if channel.get("type") == "text":
            return channel
    raise AssertionError(f"No text channel found in server {server_id}")


def find_default_role(client: ApiClient, server_id: str):
    roles = assert_ok(client.get(f"/servers/{server_id}/roles"))
    for role in roles:
        if role.get("is_default"):
            return role
    raise AssertionError(f"No default role found in server {server_id}")


def main() -> None:
    owner = login_existing_owner()
    member = register_member()

    server = assert_ok(owner.post("/servers", {
        "name": f"History Smoke {rnd(4)}",
        "description": "history visibility smoke",
    }))
    channel = find_first_text_channel(owner, server["id"])

    old_contents = []
    for index in range(75):
        content = f"history-old-{index:03d}-{rnd(5)}"
        old_contents.append(content)
        assert_ok(owner.post(f"/channels/{channel['id']}/messages", {
            "content": content,
            "attachments": [],
        }))

    invite = assert_ok(owner.post(f"/servers/{server['id']}/invites", {
        "max_uses": 1,
        "expires_hours": 1,
    }))
    assert_ok(member.post(f"/invites/{invite['code']}/accept"))

    default_role = find_default_role(owner, server["id"])
    default_permissions = dict(default_role.get("permissions") or {})
    default_permissions["read_message_history"] = False
    assert_ok(owner.put(
        f"/servers/{server['id']}/roles/{default_role['id']}",
        {"permissions": default_permissions},
    ))

    new_content = f"history-new-{rnd(6)}"
    assert_ok(owner.post(f"/channels/{channel['id']}/messages", {
        "content": new_content,
        "attachments": [],
    }))

    limited_timeline = assert_ok(member.get(f"/channels/{channel['id']}/messages?limit=200"))
    limited_contents = {message["content"] for message in limited_timeline}
    assert new_content in limited_contents
    assert not any(content in limited_contents for content in old_contents), limited_contents

    reader_role = assert_ok(owner.post(f"/servers/{server['id']}/roles", {
        "name": "History Reader",
        "color": "#38BDF8",
        "mentionable": False,
        "permissions": {
            "read_message_history": True,
        },
    }))
    assert_ok(owner.put(f"/servers/{server['id']}/members/{member.user['id']}", {
        "roles": [reader_role["id"]],
    }))

    full_timeline = assert_ok(member.get(f"/channels/{channel['id']}/messages?limit=200"))
    full_contents = {message["content"] for message in full_timeline}
    assert new_content in full_contents
    assert all(content in full_contents for content in old_contents), len(full_contents)
    assert len(full_timeline) >= 76, len(full_timeline)

    print({
        "checks": [
            "history-hidden-without-permission",
            "history-restored-with-read-message-history",
            "older-pages-available-over-api",
        ],
        "server_id": server["id"],
        "channel_id": channel["id"],
        "member_email": member.email,
        "visible_messages": len(full_timeline),
    })


if __name__ == "__main__":
    main()
