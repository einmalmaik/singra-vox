from __future__ import annotations

import re
from typing import Optional

from app.core.database import db
from app.permissions import has_channel_permission, has_server_permission
from app.core.utils import sanitize_user


async def hydrate_message_mentions(message: dict) -> dict:
    message["mentions_everyone"] = bool(message.get("mentions_everyone"))

    user_ids = list(dict.fromkeys(message.get("mentioned_user_ids") or message.get("mention_ids") or []))
    role_ids = list(dict.fromkeys(message.get("mentioned_role_ids") or []))

    if user_ids:
        mentioned_users = await db.users.find(
            {"id": {"$in": user_ids}},
            {"_id": 0, "password_hash": 0, "id": 1, "username": 1, "display_name": 1},
        ).to_list(len(user_ids))
        mentioned_users_by_id = {entry["id"]: sanitize_user(entry) for entry in mentioned_users}
        message["mentioned_users"] = [
            mentioned_users_by_id[user_id]
            for user_id in user_ids
            if user_id in mentioned_users_by_id
        ]
    else:
        message["mentioned_users"] = []

    if role_ids:
        mentioned_roles = await db.roles.find(
            {"id": {"$in": role_ids}},
            {"_id": 0, "id": 1, "name": 1, "color": 1, "mentionable": 1, "is_default": 1},
        ).to_list(len(role_ids))
        mentioned_roles_by_id = {entry["id"]: entry for entry in mentioned_roles}
        message["mentioned_roles"] = [
            mentioned_roles_by_id[role_id]
            for role_id in role_ids
            if role_id in mentioned_roles_by_id
        ]
    else:
        message["mentioned_roles"] = []

    return message


async def resolve_message_mentions(
    *,
    server_id: str,
    actor_id: str,
    channel: Optional[dict] = None,
    content: str,
    mentioned_user_ids: Optional[list[str]] = None,
    mentioned_role_ids: Optional[list[str]] = None,
    mentions_everyone: bool = False,
) -> dict:
    member_docs = await db.server_members.find(
        {"server_id": server_id, "is_banned": {"$ne": True}},
        {"_id": 0, "user_id": 1, "roles": 1},
    ).to_list(2000)
    member_map = {member["user_id"]: member for member in member_docs}

    can_mention_everyone = (
        await has_channel_permission(db, actor_id, channel, "mention_everyone")
        if channel is not None
        else await has_server_permission(db, actor_id, server_id, "mention_everyone")
    )

    valid_user_ids: list[str] = []
    provided_user_ids = list(dict.fromkeys(mentioned_user_ids or []))
    if provided_user_ids:
        valid_user_ids = [user_id for user_id in provided_user_ids if user_id in member_map and user_id != actor_id]
    else:
        fallback_names = re.findall(r"@(\w+)", content or "")
        if fallback_names:
            matching_users = await db.users.find(
                {"username": {"$in": [entry.lower() for entry in fallback_names]}},
                {"_id": 0, "id": 1, "username": 1},
            ).to_list(len(fallback_names))
            username_map = {entry["username"]: entry["id"] for entry in matching_users}
            valid_user_ids = [
                username_map[name.lower()]
                for name in fallback_names
                if username_map.get(name.lower()) in member_map and username_map.get(name.lower()) != actor_id
            ]
        valid_user_ids = list(dict.fromkeys(valid_user_ids))

    provided_role_ids = list(dict.fromkeys(mentioned_role_ids or []))
    valid_role_ids: list[str] = []
    if provided_role_ids:
        server_roles = await db.roles.find(
            {"server_id": server_id, "id": {"$in": provided_role_ids}},
            {"_id": 0, "id": 1, "mentionable": 1, "is_default": 1},
        ).to_list(len(provided_role_ids))
        roles_by_id = {role["id"]: role for role in server_roles}
        for role_id in provided_role_ids:
            role = roles_by_id.get(role_id)
            if not role:
                continue
            if role.get("is_default"):
                if can_mention_everyone:
                    mentions_everyone = True
                continue
            if role.get("mentionable") or can_mention_everyone:
                valid_role_ids.append(role_id)

    normalized_everyone = bool(mentions_everyone)
    lowered_content = (content or "").lower()
    if ("@everyone" in lowered_content or "@here" in lowered_content) and can_mention_everyone:
        normalized_everyone = True
    if normalized_everyone and not can_mention_everyone:
        normalized_everyone = False

    notification_targets = set(valid_user_ids)
    if valid_role_ids:
        for member in member_docs:
            if any(role_id in (member.get("roles") or []) for role_id in valid_role_ids):
                notification_targets.add(member["user_id"])
    if normalized_everyone:
        notification_targets.update(member_map.keys())
    notification_targets.discard(actor_id)

    return {
        "mentioned_user_ids": valid_user_ids,
        "mentioned_role_ids": valid_role_ids,
        "mentions_everyone": normalized_everyone,
        "notify_user_ids": list(notification_targets),
    }
