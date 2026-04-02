from backend.app.permissions import resolve_channel_permissions


def test_channel_permissions_apply_category_then_channel_precedence():
    server_permissions = {
        "read_messages": True,
        "send_messages": True,
        "read_message_history": True,
        "join_voice": True,
        "speak": True,
        "stream": True,
    }
    member = {"user_id": "user-1", "roles": ["role-mod"], "is_banned": False}

    permissions = resolve_channel_permissions(
        user_id="user-1",
        server_owner_id="owner-1",
        member=member,
        server_permissions=server_permissions,
        category_overrides=[
            {"target_type": "everyone", "target_id": "everyone", "permissions": {"send_messages": False}},
            {"target_type": "role", "target_id": "role-mod", "permissions": {"send_messages": True}},
        ],
        channel_overrides=[
            {"target_type": "everyone", "target_id": "everyone", "permissions": {"send_messages": False}},
            {"target_type": "user", "target_id": "user-1", "permissions": {"send_messages": True}},
        ],
        channel={"id": "channel-1", "server_id": "server-1", "is_private": False},
    )

    assert permissions["send_messages"] is True


def test_private_channel_acl_removes_read_and_voice_permissions_for_non_member():
    server_permissions = {
        "read_messages": True,
        "read_message_history": True,
        "send_messages": True,
        "attach_files": True,
        "join_voice": True,
        "speak": True,
        "stream": True,
    }
    member = {"user_id": "user-1", "roles": ["role-member"], "is_banned": False}

    permissions = resolve_channel_permissions(
        user_id="user-1",
        server_owner_id="owner-1",
        member=member,
        server_permissions=server_permissions,
        channel_access_entries=[
            {"channel_id": "channel-1", "type": "user", "target_id": "user-2"},
            {"channel_id": "channel-1", "type": "role", "target_id": "role-vip"},
        ],
        channel={"id": "channel-1", "server_id": "server-1", "is_private": True},
    )

    assert permissions["read_messages"] is False
    assert permissions["read_message_history"] is False
    assert permissions["send_messages"] is False
    assert permissions["attach_files"] is False
    assert permissions["join_voice"] is False
    assert permissions["speak"] is False
    assert permissions["stream"] is False


def test_user_override_restores_channel_access_after_role_and_everyone_denies():
    server_permissions = {
        "read_messages": True,
        "send_messages": True,
        "read_message_history": True,
        "join_voice": True,
        "speak": True,
        "stream": True,
    }
    member = {"user_id": "user-1", "roles": ["role-mod"], "is_banned": False}

    permissions = resolve_channel_permissions(
        user_id="user-1",
        server_owner_id="owner-1",
        member=member,
        server_permissions=server_permissions,
        channel_overrides=[
            {"target_type": "everyone", "target_id": "everyone", "permissions": {"read_messages": False}},
            {"target_type": "role", "target_id": "role-mod", "permissions": {"read_messages": False}},
            {"target_type": "user", "target_id": "user-1", "permissions": {"read_messages": True}},
        ],
        channel={"id": "channel-2", "server_id": "server-1", "is_private": False},
    )

    assert permissions["read_messages"] is True
