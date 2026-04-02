"""
Integration smoke for multi-server chat isolation and role/permission flows.

This validates the live API instead of only pure permission helpers:
- owner can create multiple servers
- membership and channel visibility stay server-scoped
- default-role permission changes are enforced
- additive role grants restore selected permissions
"""
from __future__ import annotations

from typing import Any, Dict

from tests.e2ee_acceptance import (
    API_BASE,
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
        email=f"role_member_{rnd()}@example.com",
        username=f"role_member_{rnd()}",
        display_name="Role Member",
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


def find_first_text_channel(client: ApiClient, server_id: str) -> Dict[str, Any]:
    channels = assert_ok(client.get(f"/servers/{server_id}/channels"))
    for channel in channels:
        if channel.get("type") == "text":
            return channel
    raise AssertionError(f"No text channel found in server {server_id}")


def find_default_role(client: ApiClient, server_id: str) -> Dict[str, Any]:
    roles = assert_ok(client.get(f"/servers/{server_id}/roles"))
    for role in roles:
        if role.get("is_default"):
            return role
    raise AssertionError(f"No default role found in server {server_id}")


def main() -> None:
    owner = login_existing_owner()
    member = register_member()

    server_one = assert_ok(owner.post("/servers", {
        "name": f"Smoke Alpha {rnd(4)}",
        "description": "multi-server smoke alpha",
    }))
    server_two = assert_ok(owner.post("/servers", {
        "name": f"Smoke Beta {rnd(4)}",
        "description": "multi-server smoke beta",
    }))

    invite = assert_ok(owner.post(f"/servers/{server_one['id']}/invites", {
        "max_uses": 1,
        "expires_hours": 1,
    }))
    assert_ok(member.post(f"/invites/{invite['code']}/accept"))

    channel_one = find_first_text_channel(owner, server_one["id"])
    channel_two = find_first_text_channel(owner, server_two["id"])

    # Multi-server isolation: the joined member sees server one, but not server two.
    visible_servers = assert_ok(member.get("/servers"))
    visible_server_ids = {server["id"] for server in visible_servers}
    assert server_one["id"] in visible_server_ids
    assert server_two["id"] not in visible_server_ids
    member_server_two = member.get(f"/servers/{server_two['id']}/channels")
    assert member_server_two.status_code == 403, member_server_two.text

    # Messages stay scoped to their channels/servers.
    alpha_message = assert_ok(owner.post(f"/channels/{channel_one['id']}/messages", {
        "content": f"alpha-message-{rnd(6)}",
        "attachments": [],
    }))
    beta_message = assert_ok(owner.post(f"/channels/{channel_two['id']}/messages", {
        "content": f"beta-message-{rnd(6)}",
        "attachments": [],
    }))
    alpha_timeline = assert_ok(owner.get(f"/channels/{channel_one['id']}/messages"))
    beta_timeline = assert_ok(owner.get(f"/channels/{channel_two['id']}/messages"))
    alpha_ids = {message["id"] for message in alpha_timeline}
    beta_ids = {message["id"] for message in beta_timeline}
    assert alpha_message["id"] in alpha_ids
    assert beta_message["id"] not in alpha_ids
    assert beta_message["id"] in beta_ids
    assert alpha_message["id"] not in beta_ids

    # Remove send/create permissions for @everyone in server one.
    default_role = find_default_role(owner, server_one["id"])
    updated_default = dict(default_role.get("permissions") or {})
    updated_default["send_messages"] = False
    updated_default["create_invites"] = False
    updated_default["manage_channels"] = False
    assert_ok(owner.put(
        f"/servers/{server_one['id']}/roles/{default_role['id']}",
        {"permissions": updated_default},
    ))

    member_send_denied = member.post(f"/channels/{channel_one['id']}/messages", {
        "content": "should-be-denied",
        "attachments": [],
    })
    assert member_send_denied.status_code == 403, member_send_denied.text
    member_channel_create_denied = member.post(f"/servers/{server_one['id']}/channels", {
        "name": "denied-channel",
        "type": "text",
        "topic": "",
        "is_private": False,
    })
    assert member_channel_create_denied.status_code == 403, member_channel_create_denied.text

    # Grant a role that restores selected permissions.
    writer_role = assert_ok(owner.post(f"/servers/{server_one['id']}/roles", {
        "name": "Writer",
        "color": "#22C55E",
        "mentionable": False,
        "permissions": {
            "send_messages": True,
            "manage_channels": True,
        },
    }))
    assert_ok(owner.put(f"/servers/{server_one['id']}/members/{member.user['id']}", {
        "roles": [writer_role["id"]],
    }))

    member_send_allowed = assert_ok(member.post(f"/channels/{channel_one['id']}/messages", {
        "content": f"writer-message-{rnd(6)}",
        "attachments": [],
    }))
    created_channel = assert_ok(member.post(f"/servers/{server_one['id']}/channels", {
        "name": f"writer-channel-{rnd(4)}",
        "type": "text",
        "topic": "created through granted role",
        "is_private": False,
    }))

    assert member_send_allowed["author_id"] == member.user["id"]
    assert created_channel["server_id"] == server_one["id"]

    print({
        "checks": [
            "server-membership-isolation",
            "multi-server-message-isolation",
            "default-role-permission-enforcement",
            "role-grant-restores-send-and-manage-channels",
        ],
        "server_one": server_one["id"],
        "server_two": server_two["id"],
        "member_email": member.email,
    })


if __name__ == "__main__":
    main()
