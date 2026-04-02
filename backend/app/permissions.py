from __future__ import annotations

from typing import Dict, Iterable, Optional


DEFAULT_PERMISSIONS: Dict[str, bool] = {
    "manage_server": False,
    "manage_channels": False,
    "manage_roles": False,
    "manage_members": False,
    "kick_members": False,
    "ban_members": False,
    "send_messages": True,
    "read_messages": True,
    "read_message_history": True,
    "manage_messages": False,
    "attach_files": True,
    "mention_everyone": False,
    "join_voice": True,
    "speak": True,
    "stream": True,
    "mute_members": False,
    "deafen_members": False,
    "priority_speaker": False,
    "create_invites": True,
    "pin_messages": False,
    "manage_emojis": False,
    "manage_webhooks": False,
}
ALL_PERMISSIONS: Dict[str, bool] = {permission: True for permission in DEFAULT_PERMISSIONS}
NO_MEMBER_PERMISSIONS: Dict[str, bool] = {permission: False for permission in DEFAULT_PERMISSIONS}


def _clone_permissions(source: Optional[dict] = None) -> Dict[str, bool]:
    permissions = {**DEFAULT_PERMISSIONS}
    for permission, allowed in (source or {}).items():
        if permission in permissions:
            permissions[permission] = bool(allowed)
    return permissions


def resolve_server_permissions(
    *,
    user_id: str,
    server_owner_id: Optional[str],
    member: Optional[dict],
    default_role_permissions: Optional[dict] = None,
    role_permissions: Optional[Iterable[dict]] = None,
) -> Dict[str, bool]:
    if not member or member.get("is_banned"):
        return {**NO_MEMBER_PERMISSIONS}

    if server_owner_id and server_owner_id == user_id:
        return {**ALL_PERMISSIONS}

    resolved_permissions = _clone_permissions(default_role_permissions)
    for role_permission_set in role_permissions or []:
        for permission, allowed in (role_permission_set or {}).items():
            if permission in resolved_permissions and allowed:
                resolved_permissions[permission] = True

    return resolved_permissions


def _normalize_override_permissions(permissions: Optional[dict]) -> dict:
    normalized = {}
    for permission, value in (permissions or {}).items():
        if permission in DEFAULT_PERMISSIONS and isinstance(value, bool):
            normalized[permission] = value
    return normalized


def _apply_override_layer(base_permissions: Dict[str, bool], overrides: Iterable[dict]) -> Dict[str, bool]:
    next_permissions = {**base_permissions}
    deny_values = {}
    allow_values = {}
    for override in overrides:
        for permission, value in _normalize_override_permissions(override.get("permissions")).items():
            if value:
                allow_values[permission] = True
            else:
                deny_values[permission] = False

    for permission in deny_values:
        next_permissions[permission] = False
    for permission in allow_values:
        next_permissions[permission] = True
    return next_permissions


def _private_channel_allows_member(*, channel: dict, member: Optional[dict], server_owner_id: Optional[str], user_id: str, access_entries: Iterable[dict]) -> bool:
    if not channel.get("is_private"):
        return True
    if server_owner_id and server_owner_id == user_id:
        return True
    if not member or member.get("is_banned"):
        return False

    user_allowlist = {entry.get("target_id") for entry in access_entries if entry.get("type") == "user"}
    role_allowlist = {entry.get("target_id") for entry in access_entries if entry.get("type") == "role"}

    if not user_allowlist and not role_allowlist:
        return True
    if user_id in user_allowlist:
        return True
    return bool(role_allowlist.intersection(member.get("roles") or []))


def _permission_context_overrides(*, overrides: Iterable[dict], user_id: str, role_ids: Iterable[str]) -> tuple[list[dict], list[dict], list[dict]]:
    everyone = []
    role_overrides = []
    user_overrides = []

    user_role_ids = set(role_ids or [])
    for override in overrides:
        target_type = (override.get("target_type") or "").lower()
        target_id = override.get("target_id")
        if target_type == "everyone":
            everyone.append(override)
        elif target_type == "role" and target_id in user_role_ids:
            role_overrides.append(override)
        elif target_type == "user" and target_id == user_id:
            user_overrides.append(override)
    return everyone, role_overrides, user_overrides


def resolve_channel_permissions(
    *,
    user_id: str,
    server_owner_id: Optional[str],
    member: Optional[dict],
    server_permissions: Dict[str, bool],
    category_overrides: Iterable[dict] = (),
    channel_overrides: Iterable[dict] = (),
    channel_access_entries: Iterable[dict] = (),
    channel: Optional[dict] = None,
) -> Dict[str, bool]:
    if not member or member.get("is_banned"):
        return {**NO_MEMBER_PERMISSIONS}
    if server_owner_id and server_owner_id == user_id:
        return {**ALL_PERMISSIONS}

    role_ids = member.get("roles") or []
    resolved = {**server_permissions}

    for scoped_overrides in (category_overrides or (), channel_overrides or ()):
        everyone, matching_roles, matching_user = _permission_context_overrides(
            overrides=scoped_overrides,
            user_id=user_id,
            role_ids=role_ids,
        )
        resolved = _apply_override_layer(resolved, everyone)
        resolved = _apply_override_layer(resolved, matching_roles)
        resolved = _apply_override_layer(resolved, matching_user)

    if channel and channel.get("is_private"):
        allowed = _private_channel_allows_member(
            channel=channel,
            member=member,
            server_owner_id=server_owner_id,
            user_id=user_id,
            access_entries=channel_access_entries or [],
        )
        if not allowed:
            for permission in ("read_messages", "read_message_history", "send_messages", "attach_files", "join_voice", "speak", "stream"):
                resolved[permission] = False

    return resolved


async def load_server_permission_context(db, user_id: str, server_id: str):
    member = await db.server_members.find_one(
        {"user_id": user_id, "server_id": server_id},
        {"_id": 0},
    )
    if not member or member.get("is_banned"):
        return None, member, None, []

    server = await db.servers.find_one({"id": server_id}, {"_id": 0, "owner_id": 1})
    default_role = await db.roles.find_one(
        {"server_id": server_id, "is_default": True},
        {"_id": 0, "permissions": 1},
    )

    role_ids = member.get("roles") or []
    role_docs = []
    if role_ids:
        role_docs = await db.roles.find(
            {"server_id": server_id, "id": {"$in": role_ids}},
            {"_id": 0, "id": 1, "permissions": 1},
        ).to_list(len(role_ids))

    return server, member, default_role, role_docs


async def get_server_permissions(db, user_id: str, server_id: str) -> Dict[str, bool]:
    server, member, default_role, role_docs = await load_server_permission_context(db, user_id, server_id)
    return resolve_server_permissions(
        user_id=user_id,
        server_owner_id=(server or {}).get("owner_id"),
        member=member,
        default_role_permissions=(default_role or {}).get("permissions") or {},
        role_permissions=[role.get("permissions") or {} for role in role_docs],
    )


async def get_channel_permissions(db, user_id: str, channel: dict) -> Dict[str, bool]:
    server_id = channel["server_id"]
    server, member, default_role, role_docs = await load_server_permission_context(db, user_id, server_id)
    server_permissions = resolve_server_permissions(
        user_id=user_id,
        server_owner_id=(server or {}).get("owner_id"),
        member=member,
        default_role_permissions=(default_role or {}).get("permissions") or {},
        role_permissions=[role.get("permissions") or {} for role in role_docs],
    )
    if not member or member.get("is_banned"):
        return server_permissions

    category = None
    category_overrides = []
    if channel.get("parent_id"):
        category = await db.channels.find_one(
            {"id": channel["parent_id"], "server_id": server_id, "type": "category"},
            {"_id": 0, "id": 1},
        )
    if category:
        category_overrides = await db.channel_overrides.find(
            {"channel_id": category["id"]},
            {"_id": 0, "target_type": 1, "target_id": 1, "permissions": 1},
        ).to_list(200)

    channel_overrides = await db.channel_overrides.find(
        {"channel_id": channel["id"]},
        {"_id": 0, "target_type": 1, "target_id": 1, "permissions": 1},
    ).to_list(200)
    channel_access_entries = await db.channel_access.find(
        {"channel_id": channel["id"]},
        {"_id": 0},
    ).to_list(500)

    return resolve_channel_permissions(
        user_id=user_id,
        server_owner_id=(server or {}).get("owner_id"),
        member=member,
        server_permissions=server_permissions,
        category_overrides=category_overrides,
        channel_overrides=channel_overrides,
        channel_access_entries=channel_access_entries,
        channel=channel,
    )


async def has_server_permission(db, user_id: str, server_id: str, permission: str) -> bool:
    permissions = await get_server_permissions(db, user_id, server_id)
    return bool(permissions.get(permission, False))


async def has_channel_permission(db, user_id: str, channel: dict, permission: str) -> bool:
    permissions = await get_channel_permissions(db, user_id, channel)
    return bool(permissions.get(permission, False))


async def get_message_history_cutoff(db, user_id: str, server_id: str, *, channel: Optional[dict] = None) -> Optional[str]:
    member = await db.server_members.find_one(
        {"user_id": user_id, "server_id": server_id},
        {"_id": 0, "joined_at": 1, "is_banned": 1},
    )
    if not member or member.get("is_banned"):
        return None

    allowed = (
        await has_channel_permission(db, user_id, channel, "read_message_history")
        if channel
        else await has_server_permission(db, user_id, server_id, "read_message_history")
    )
    if allowed:
        return None
    return member.get("joined_at")


async def build_viewer_context(db, user_id: str, server_id: str) -> dict:
    server, member, default_role, role_docs = await load_server_permission_context(db, user_id, server_id)
    server_permissions = resolve_server_permissions(
        user_id=user_id,
        server_owner_id=(server or {}).get("owner_id"),
        member=member,
        default_role_permissions=(default_role or {}).get("permissions") or {},
        role_permissions=[role.get("permissions") or {} for role in role_docs],
    )

    channel_permissions = {}
    channels = await db.channels.find({"server_id": server_id}, {"_id": 0}).to_list(200)
    for channel in channels:
        channel_permissions[channel["id"]] = await get_channel_permissions(db, user_id, channel)

    membership_state = {
        "is_member": bool(member and not member.get("is_banned")),
        "is_banned": bool((member or {}).get("is_banned")),
        "role_ids": (member or {}).get("roles") or [],
    }

    return {
        "server_permissions": server_permissions,
        "channel_permissions": channel_permissions,
        "role_ids": membership_state["role_ids"],
        "membership_state": membership_state,
    }
