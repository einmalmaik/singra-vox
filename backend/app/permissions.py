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
    "mute_members": False,
    "deafen_members": False,
    "priority_speaker": False,
    "create_invites": True,
    "pin_messages": False,
    "manage_emojis": False,
    "manage_webhooks": False,
}
ALL_PERMISSIONS: Dict[str, bool] = {
    permission: True for permission in DEFAULT_PERMISSIONS
}
NO_MEMBER_PERMISSIONS: Dict[str, bool] = {
    permission: False for permission in DEFAULT_PERMISSIONS
}


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

    resolved_permissions = {**DEFAULT_PERMISSIONS}
    for permission, allowed in (default_role_permissions or {}).items():
        resolved_permissions[permission] = bool(allowed)

    for role_permission_set in role_permissions or []:
        for permission, allowed in (role_permission_set or {}).items():
            if allowed:
                resolved_permissions[permission] = True

    return resolved_permissions


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
            {"id": {"$in": role_ids}},
            {"_id": 0, "permissions": 1},
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


async def has_server_permission(db, user_id: str, server_id: str, permission: str) -> bool:
    permissions = await get_server_permissions(db, user_id, server_id)
    return bool(permissions.get(permission, False))


async def get_message_history_cutoff(db, user_id: str, server_id: str) -> Optional[str]:
    member = await db.server_members.find_one(
        {"user_id": user_id, "server_id": server_id},
        {"_id": 0, "joined_at": 1, "is_banned": 1},
    )
    if not member or member.get("is_banned"):
        return None
    if await has_server_permission(db, user_id, server_id, "read_message_history"):
        return None
    return member.get("joined_at")
