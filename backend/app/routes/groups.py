"""
Singra Vox – Group-DM routes
===============================
Manages group conversations (multi-user direct message threads) and
their E2EE-capable messages.

Routes
------
    POST  /api/groups
    GET   /api/groups
    GET   /api/groups/{group_id}/messages
    POST  /api/groups/{group_id}/messages
    PUT   /api/groups/{group_id}/members
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.auth_service import load_current_user
from app.core.database import db
from app.core.utils import now_utc, new_id
from app.core.constants import E2EE_DEVICE_HEADER
from app.pagination import clamp_page_limit

router = APIRouter(prefix="/api", tags=["groups"])


async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


async def _require_verified_device(request: Request, user: dict) -> dict:
    device_id = (request.headers.get(E2EE_DEVICE_HEADER) or "").strip() or None
    if not device_id:
        raise HTTPException(400, "E2EE device header required")
    device = await db.e2ee_devices.find_one(
        {"user_id": user["id"], "device_id": device_id}, {"_id": 0}
    )
    if not device or device.get("revoked_at") or not device.get("verified_at"):
        raise HTTPException(403, "E2EE device is not trusted")
    return device


# ── Input models ──────────────────────────────────────────────────────────────

class GroupCreateInput(BaseModel):
    name: str = ""
    member_ids: list[str]


class GroupMessageInput(BaseModel):
    content: str = ""
    encrypted_content: Optional[str] = None
    is_encrypted: bool = False
    attachments: list[dict] = []
    nonce: Optional[str] = None
    sender_device_id: Optional[str] = None
    protocol_version: str = "sv-e2ee-v1"
    key_envelopes: list[dict] = []


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/groups")
async def create_group(inp: GroupCreateInput, request: Request) -> dict:
    """Create a new group conversation."""
    user = await _current_user(request)
    members = list(set([user["id"]] + inp.member_ids))

    group = {
        "id": new_id(),
        "name": inp.name or "Group",
        "members": members,
        "created_by": user["id"],
        "created_at": now_utc(),
    }
    await db.group_conversations.insert_one(group)
    group.pop("_id", None)

    members_info = []
    for mid in members:
        u = await db.users.find_one({"id": mid}, {"_id": 0, "password_hash": 0})
        if u:
            members_info.append(u)
    group["members_info"] = members_info
    return group


@router.get("/groups")
async def list_groups(request: Request) -> list:
    """List all group conversations the current user belongs to."""
    user = await _current_user(request)
    groups = await db.group_conversations.find(
        {"members": user["id"]}, {"_id": 0}
    ).to_list(50)

    for group in groups:
        members_info = []
        for mid in group.get("members", []):
            u = await db.users.find_one({"id": mid}, {"_id": 0, "password_hash": 0})
            if u:
                members_info.append(u)
        group["members_info"] = members_info
        group["last_message"] = await db.group_messages.find_one(
            {"group_id": group["id"]}, {"_id": 0}, sort=[("created_at", -1)]
        )
    return groups


@router.get("/groups/{group_id}/messages")
async def list_group_messages(
    group_id: str, request: Request, before: str | None = None, limit: int = 50
) -> dict:
    """Paginate messages in a group conversation (newest-first)."""
    user = await _current_user(request)
    group = await db.group_conversations.find_one(
        {"id": group_id, "members": user["id"]}, {"_id": 0}
    )
    if not group:
        raise HTTPException(404, "Group not found")

    limit = clamp_page_limit(limit)
    query: dict = {"group_id": group_id}
    if before:
        query["created_at"] = {"$lt": before}

    messages = await db.group_messages.find(
        query, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)
    messages.reverse()

    for msg in messages:
        msg["sender"] = await db.users.find_one(
            {"id": msg["sender_id"]}, {"_id": 0, "password_hash": 0}
        )

    return {
        "messages": messages,
        "next_before": messages[0]["created_at"] if messages else None,
        "has_more_before": len(messages) == limit,
    }


@router.post("/groups/{group_id}/messages")
async def send_group_message(group_id: str, inp: GroupMessageInput, request: Request) -> dict:
    """Send a message to a group conversation."""
    user = await _current_user(request)
    group = await db.group_conversations.find_one(
        {"id": group_id, "members": user["id"]}, {"_id": 0}
    )
    if not group:
        raise HTTPException(404, "Group not found")

    if inp.is_encrypted:
        device = await _require_verified_device(request, user)
        if not inp.encrypted_content or not inp.nonce or not inp.sender_device_id:
            raise HTTPException(400, "Encrypted messages require a full E2EE payload")
        if inp.sender_device_id != device["device_id"]:
            raise HTTPException(400, "Encrypted messages must originate from the active E2EE device")

    msg = {
        "id": new_id(),
        "group_id": group_id,
        "sender_id": user["id"],
        "content": inp.content if not inp.is_encrypted else "[encrypted]",
        "encrypted_content": inp.encrypted_content or "",
        "is_encrypted": inp.is_encrypted,
        "attachments": inp.attachments,
        "nonce": inp.nonce or "",
        "sender_device_id": inp.sender_device_id or "",
        "protocol_version": inp.protocol_version,
        "key_envelopes": inp.key_envelopes,
        "created_at": now_utc(),
    }
    await db.group_messages.insert_one(msg)
    msg.pop("_id", None)
    msg["sender"] = {k: v for k, v in user.items()}
    return msg


@router.put("/groups/{group_id}/members")
async def update_group_members(group_id: str, request: Request) -> dict:
    """Add or remove a user from a group conversation."""
    user = await _current_user(request)
    body = await request.json()
    group = await db.group_conversations.find_one(
        {"id": group_id, "members": user["id"]}, {"_id": 0}
    )
    if not group:
        raise HTTPException(404, "Group not found")

    action = body.get("action")
    target_user_id = body.get("user_id")

    if action == "add":
        await db.group_conversations.update_one(
            {"id": group_id}, {"$addToSet": {"members": target_user_id}}
        )
    elif action == "remove":
        await db.group_conversations.update_one(
            {"id": group_id}, {"$pull": {"members": target_user_id}}
        )
    else:
        raise HTTPException(400, "action must be 'add' or 'remove'")

    return {"ok": True}
