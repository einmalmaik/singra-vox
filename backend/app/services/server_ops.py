from __future__ import annotations

import json
from typing import Optional

from app.core.database import db
from app.core.encryption import encrypt_metadata, encryption_enabled
from app.core.utils import new_id, now_utc, sanitize_user
from app.permissions import DEFAULT_PERMISSIONS
from app.ws import ws_mgr


async def check_permission(user_id: str, server_id: str, permission: str, *, channel: Optional[dict] = None) -> bool:
    from app.permissions import has_channel_permission, has_server_permission

    if channel is not None:
        return await has_channel_permission(db, user_id, channel, permission)
    return await has_server_permission(db, user_id, server_id, permission)


async def get_message_history_cutoff(
    user_id: str,
    server_id: str,
    *,
    channel: Optional[dict] = None,
) -> Optional[str]:
    from app.permissions import get_message_history_cutoff as get_permission_history_cutoff

    return await get_permission_history_cutoff(db, user_id, server_id, channel=channel)


async def log_audit(server_id, actor_id, action, target_type, target_id, details) -> None:
    details_str = json.dumps(details) if details else ""
    if details_str:
        details_str = encrypt_metadata(f"audit:{server_id}", details_str)
    await db.audit_log.insert_one(
        {
            "id": new_id(),
            "server_id": server_id,
            "actor_id": actor_id,
            "action": action,
            "target_type": target_type,
            "target_id": target_id,
            "details": details_str,
            "encrypted_at_rest": encryption_enabled(),
            "created_at": now_utc(),
        }
    )


async def get_server_member(server_id: str, user_id: str) -> Optional[dict]:
    return await db.server_members.find_one(
        {"server_id": server_id, "user_id": user_id},
        {"_id": 0},
    )


async def build_member_payload(server_id: str, user_id: str) -> Optional[dict]:
    member = await db.server_members.find_one(
        {"server_id": server_id, "user_id": user_id, "is_banned": {"$ne": True}},
        {"_id": 0},
    )
    if not member:
        return None

    member_user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not member_user:
        return None

    member["user"] = sanitize_user(member_user)
    return member


async def delete_server_cascade(server_id: str) -> None:
    channels = await db.channels.find({"server_id": server_id}, {"_id": 0, "id": 1}).to_list(2000)
    channel_ids = [channel["id"] for channel in channels]

    if channel_ids:
        messages = await db.messages.find({"channel_id": {"$in": channel_ids}}, {"_id": 0, "id": 1}).to_list(5000)
        message_ids = [message["id"] for message in messages]
        if message_ids:
            await db.message_revisions.delete_many({"message_id": {"$in": message_ids}})
        await db.messages.delete_many({"channel_id": {"$in": channel_ids}})
        await db.channel_access.delete_many({"channel_id": {"$in": channel_ids}})
        await db.channel_overrides.delete_many({"channel_id": {"$in": channel_ids}})
        await db.voice_states.delete_many({"channel_id": {"$in": channel_ids}})
        await db.read_states.delete_many({"channel_id": {"$in": channel_ids}})
        await db.webhooks.delete_many({"channel_id": {"$in": channel_ids}})
        await db.webhook_logs.delete_many({"channel_id": {"$in": channel_ids}})

    await db.audit_log.delete_many({"server_id": server_id})
    await db.notifications.delete_many({"server_id": server_id})
    await db.server_emojis.delete_many({"server_id": server_id})
    await db.bot_tokens.delete_many({"server_id": server_id})
    await db.invites.delete_many({"server_id": server_id})
    await db.roles.delete_many({"server_id": server_id})
    await db.server_members.delete_many({"server_id": server_id})
    await db.channels.delete_many({"server_id": server_id})
    await db.servers.delete_one({"id": server_id})


async def create_default_server(owner: dict, name: str, description: str = "") -> dict:
    sid = new_id()
    general_channel_id = new_id()
    voice_channel_id = new_id()
    server = {
        "id": sid,
        "name": name,
        "description": description or "",
        "icon_url": "",
        "owner_id": owner["id"],
        "created_at": now_utc(),
        "settings": {
            "default_channel_id": general_channel_id,
            "allow_invites": True,
            "retention_days": 0,
        },
    }
    await db.servers.insert_one(server)
    await db.channels.insert_many(
        [
            {
                "id": general_channel_id,
                "server_id": sid,
                "name": "general",
                "type": "text",
                "topic": "General discussion",
                "parent_id": None,
                "position": 0,
                "is_private": False,
                "slowmode_seconds": 0,
                "created_at": now_utc(),
            },
            {
                "id": voice_channel_id,
                "server_id": sid,
                "name": "Voice",
                "type": "voice",
                "topic": "",
                "parent_id": None,
                "position": 1,
                "is_private": False,
                "slowmode_seconds": 0,
                "created_at": now_utc(),
            },
        ]
    )
    admin_role_id = new_id()
    member_role_id = new_id()
    await db.roles.insert_many(
        [
            {
                "id": admin_role_id,
                "server_id": sid,
                "name": "Admin",
                "color": "#E74C3C",
                "permissions": {key: True for key in DEFAULT_PERMISSIONS},
                "position": 100,
                "is_default": False,
                "mentionable": False,
                "created_at": now_utc(),
            },
            {
                "id": member_role_id,
                "server_id": sid,
                "name": "@everyone",
                "color": "#99AAB5",
                "permissions": DEFAULT_PERMISSIONS,
                "position": 0,
                "is_default": True,
                "mentionable": False,
                "created_at": now_utc(),
            },
        ]
    )
    await db.server_members.insert_one(
        {
            "server_id": sid,
            "user_id": owner["id"],
            "roles": [admin_role_id],
            "nickname": "",
            "joined_at": now_utc(),
            "muted_until": None,
            "is_banned": False,
            "ban_reason": "",
        }
    )
    return server


async def clear_voice_membership(
    user_id: str,
    *,
    server_id: Optional[str] = None,
    channel_id: Optional[str] = None,
    force_reason: Optional[str] = None,
) -> None:
    query = {"user_id": user_id}
    if server_id:
        query["server_id"] = server_id
    if channel_id:
        query["channel_id"] = channel_id

    states = await db.voice_states.find(query, {"_id": 0}).to_list(20)
    if not states:
        return

    await db.voice_states.delete_many(query)
    for state in states:
        await ws_mgr.broadcast_server(
            state["server_id"],
            {
                "type": "voice_leave",
                "server_id": state["server_id"],
                "channel_id": state["channel_id"],
                "user_id": user_id,
            },
        )

    if force_reason:
        await ws_mgr.send(
            user_id,
            {
                "type": "voice_force_leave",
                "server_id": server_id or states[0]["server_id"],
                "channel_id": channel_id or states[0]["channel_id"],
                "reason": force_reason,
            },
        )
