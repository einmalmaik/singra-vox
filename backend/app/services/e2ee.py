from __future__ import annotations

import base64
import binascii
from typing import Optional

from fastapi import HTTPException

from app.core.constants import E2EE_PROTOCOL_VERSION
from app.core.database import db
from app.permissions import assert_channel_permission, has_channel_permission


def decode_base64_bytes(value: str, *, field_name: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(400, f"Invalid base64 payload for {field_name}") from exc


async def get_e2ee_account(user_id: str) -> Optional[dict]:
    return await db.e2ee_accounts.find_one({"user_id": user_id}, {"_id": 0})


async def get_device_record(user_id: str, device_id: str) -> Optional[dict]:
    return await db.e2ee_devices.find_one(
        {"user_id": user_id, "device_id": device_id},
        {"_id": 0},
    )


def sanitize_device_record(device: dict | None) -> dict | None:
    if not device:
        return None
    safe = dict(device)
    safe.pop("_id", None)
    return safe


async def build_e2ee_state(user_id: str, current_device_id: Optional[str]) -> dict:
    account = await get_e2ee_account(user_id)
    devices = await db.e2ee_devices.find({"user_id": user_id}, {"_id": 0}).sort("created_at", 1).to_list(50)
    current_device = None
    if current_device_id:
        current_device = next((device for device in devices if device["device_id"] == current_device_id), None)
    return {
        "enabled": bool(account),
        "account": account,
        "devices": [sanitize_device_record(device) for device in devices],
        "current_device": sanitize_device_record(current_device),
    }


async def list_channel_recipient_user_ids(channel: dict) -> list[str]:
    members = await db.server_members.find(
        {"server_id": channel["server_id"], "is_banned": {"$ne": True}},
        {"_id": 0, "user_id": 1, "roles": 1},
    ).to_list(500)
    access_entries = await db.channel_access.find({"channel_id": channel["id"]}, {"_id": 0}).to_list(500)

    if not channel.get("is_private") or not access_entries:
        return [member["user_id"] for member in members]

    allowed_users = set()
    allowed_roles = {
        entry["target_id"]
        for entry in access_entries
        if entry.get("type") == "role"
    }
    for entry in access_entries:
        if entry.get("type") == "user":
            allowed_users.add(entry["target_id"])

    for member in members:
        if member["user_id"] in allowed_users:
            continue
        if allowed_roles.intersection(member.get("roles") or []):
            allowed_users.add(member["user_id"])

    server = await db.servers.find_one({"id": channel["server_id"]}, {"_id": 0, "owner_id": 1})
    if server and server.get("owner_id"):
        allowed_users.add(server["owner_id"])

    return list(allowed_users)


async def list_active_voice_participant_user_ids(channel_id: str) -> list[str]:
    states = await db.voice_states.find({"channel_id": channel_id}, {"_id": 0, "user_id": 1}).to_list(200)
    return sorted({state["user_id"] for state in states if state.get("user_id")})


async def ensure_private_channel_member_access(user_id: str, channel: dict) -> None:
    if not channel.get("is_private"):
        return
    required_permission = "join_voice" if channel.get("type") == "voice" else "read_messages"
    if not await has_channel_permission(db, user_id, channel, required_permission):
        raise HTTPException(403, "No access to this private channel")


async def list_group_recipient_user_ids(group_id: str) -> list[str]:
    group = await db.group_conversations.find_one({"id": group_id}, {"_id": 0, "members": 1})
    if not group:
        raise HTTPException(404, "Group conversation not found")
    return list(group.get("members") or [])


async def build_e2ee_recipient_payload(user_ids: list[str]) -> dict:
    normalized_ids = sorted({user_id for user_id in user_ids if user_id})
    recipients = []
    for recipient_id in normalized_ids:
        account = await get_e2ee_account(recipient_id)
        devices = await db.e2ee_devices.find(
            {
                "user_id": recipient_id,
                "verified_at": {"$ne": None},
                "revoked_at": None,
            },
            {"_id": 0},
        ).to_list(50)
        recipients.append(
            {
                "user_id": recipient_id,
                "recovery_public_key": account.get("recovery_public_key") if account else None,
                "devices": [
                    {
                        "device_id": device["device_id"],
                        "device_name": device.get("device_name", ""),
                        "public_key": device["public_key"],
                        "verified_at": device.get("verified_at"),
                    }
                    for device in devices
                ],
            }
        )
    return {
        "protocol_version": E2EE_PROTOCOL_VERSION,
        "recipients": recipients,
    }


async def authorize_blob_access(user: dict, blob_record: dict) -> None:
    scope_kind = blob_record.get("scope_kind")
    scope_id = blob_record.get("scope_id")

    if scope_kind == "dm":
        participants = blob_record.get("participant_user_ids") or []
        if user["id"] not in participants:
            raise HTTPException(403, "No access to this encrypted attachment")
        return

    if scope_kind == "group":
        participants = await list_group_recipient_user_ids(scope_id)
        if user["id"] not in participants:
            raise HTTPException(403, "No access to this encrypted attachment")
        return

    if scope_kind == "channel":
        channel = await db.channels.find_one({"id": scope_id}, {"_id": 0})
        if not channel:
            raise HTTPException(404, "Channel not found")
        await assert_channel_permission(
            db,
            user["id"],
            channel,
            "read_messages",
            "No access to this encrypted attachment",
        )
        await ensure_private_channel_member_access(user["id"], channel)
        return

    raise HTTPException(400, "Unsupported encrypted attachment scope")
