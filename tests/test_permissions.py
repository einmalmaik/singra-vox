# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
from backend.app.permissions import DEFAULT_PERMISSIONS, resolve_server_permissions


def test_owner_gets_all_permissions():
    member = {"user_id": "user-owner", "roles": ["role-admin"], "is_banned": False}

    permissions = resolve_server_permissions(
        user_id="user-owner",
        server_owner_id="user-owner",
        member=member,
        default_role_permissions={"mention_everyone": False},
        role_permissions=[{"manage_server": True}],
    )

    assert all(permissions.values())


def test_missing_member_gets_no_permissions():
    permissions = resolve_server_permissions(
        user_id="user-a",
        server_owner_id="user-owner",
        member=None,
    )

    assert permissions["read_messages"] is False
    assert permissions["join_voice"] is False
    assert permissions["manage_server"] is False


def test_default_role_overrides_base_defaults():
    permissions = resolve_server_permissions(
        user_id="user-a",
        server_owner_id="user-owner",
        member={"user_id": "user-a", "roles": [], "is_banned": False},
        default_role_permissions={
            "send_messages": False,
            "create_invites": False,
            "mention_everyone": True,
        },
    )

    assert permissions["send_messages"] is False
    assert permissions["create_invites"] is False
    assert permissions["mention_everyone"] is True


def test_role_permissions_additive_and_do_not_remove_existing_grants():
    permissions = resolve_server_permissions(
        user_id="user-a",
        server_owner_id="user-owner",
        member={"user_id": "user-a", "roles": ["role-mod"], "is_banned": False},
        default_role_permissions={"send_messages": False},
        role_permissions=[
            {"manage_messages": True, "send_messages": True},
            {"kick_members": False, "mute_members": True},
        ],
    )

    assert permissions["manage_messages"] is True
    assert permissions["send_messages"] is True
    assert permissions["mute_members"] is True
    assert permissions["kick_members"] is False


def test_banned_member_has_no_permissions():
    permissions = resolve_server_permissions(
        user_id="user-a",
        server_owner_id="user-owner",
        member={"user_id": "user-a", "roles": ["role-mod"], "is_banned": True},
        default_role_permissions=DEFAULT_PERMISSIONS,
        role_permissions=[{"manage_server": True}],
    )

    assert not any(permissions.values())
