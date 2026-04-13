from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from app.core.constants import E2EE_PROTOCOL_VERSION
from app.core.database import db
from app.core.encryption import decrypt_dm_content, encrypt_dm_content, encryption_enabled
from app.core.utils import new_id, now_utc, sanitize_user
from app.dependencies import current_user, require_verified_device
from app.pagination import clamp_page_limit
from app.schemas import DMCreateInput
from app.services.e2ee import get_e2ee_account
from app.services.notifications import send_notification as create_notification
from app.ws import ws_mgr


router = APIRouter(prefix="/api/dm", tags=["DM"])


@router.get("/conversations")
async def dm_conversations(request: Request):
    user = await current_user(request)
    pipeline = [
        {"$match": {"$or": [{"sender_id": user["id"]}, {"receiver_id": user["id"]}]}},
        {"$sort": {"created_at": -1}},
        {
            "$group": {
                "_id": {"$cond": [{"$eq": ["$sender_id", user["id"]]}, "$receiver_id", "$sender_id"]},
                "last_message": {"$first": "$$ROOT"},
                "unread_count": {
                    "$sum": {
                        "$cond": [
                            {"$and": [{"$eq": ["$receiver_id", user["id"]]}, {"$eq": ["$read", False]}]},
                            1,
                            0,
                        ]
                    }
                },
            }
        },
    ]
    conversations = await db.direct_messages.aggregate(pipeline).to_list(100)
    result = []
    for conversation in conversations:
        other_user = await db.users.find_one(
            {"id": conversation["_id"]},
            {"_id": 0, "password_hash": 0},
        )
        if not other_user:
            continue
        last_message = conversation["last_message"]
        last_message.pop("_id", None)
        result.append(
            {
                "user": sanitize_user(other_user),
                "last_message": last_message,
                "unread_count": conversation["unread_count"],
            }
        )
    return result


@router.get("/{other_user_id}")
async def get_dm_messages(other_user_id: str, request: Request, before: Optional[str] = None, limit: int = 50):
    user = await current_user(request)
    limit = clamp_page_limit(limit)
    query: dict[str, object] = {
        "$or": [
            {"sender_id": user["id"], "receiver_id": other_user_id},
            {"sender_id": other_user_id, "receiver_id": user["id"]},
        ]
    }
    if before:
        query["created_at"] = {"$lt": before}
    messages = await db.direct_messages.find(query, {"_id": 0}).sort("created_at", -1).to_list(limit)
    messages.reverse()
    await db.direct_messages.update_many(
        {"sender_id": other_user_id, "receiver_id": user["id"], "read": False},
        {"$set": {"read": True}},
    )
    for message in messages:
        sender = await db.users.find_one({"id": message["sender_id"]}, {"_id": 0, "password_hash": 0})
        message["sender"] = sanitize_user(sender) if sender else None
        if message.get("encrypted_at_rest") and not message.get("is_e2ee"):
            message["content"] = decrypt_dm_content(message["sender_id"], message["receiver_id"], message["content"])

    next_before = messages[0]["created_at"] if messages else None
    return {
        "messages": messages,
        "next_before": next_before,
        "has_more_before": len(messages) == limit,
    }


@router.post("/{other_user_id}")
async def send_dm(other_user_id: str, inp: DMCreateInput, request: Request):
    user = await current_user(request)
    other_user = await db.users.find_one({"id": other_user_id}, {"_id": 0})
    if not other_user:
        raise HTTPException(404, "User not found")

    sender_account = await get_e2ee_account(user["id"])
    receiver_account = await get_e2ee_account(other_user_id)
    use_e2ee = bool(sender_account and receiver_account)
    if use_e2ee:
        device = await require_verified_device(request, user)
        if not inp.is_e2ee or not inp.ciphertext or not inp.nonce or not inp.sender_device_id:
            raise HTTPException(
                400,
                "Direct messages require encrypted desktop payloads when both users use end-to-end encryption",
            )
        if inp.sender_device_id != device["device_id"]:
            raise HTTPException(400, "Encrypted messages must originate from the active E2EE device")

    dm_plaintext = inp.content if not use_e2ee else "[encrypted]"
    stored_content = encrypt_dm_content(user["id"], other_user_id, dm_plaintext) if not use_e2ee else dm_plaintext
    message = {
        "id": new_id(),
        "sender_id": user["id"],
        "receiver_id": other_user_id,
        "content": stored_content,
        "encrypted_content": inp.encrypted_content or inp.ciphertext or "",
        "is_encrypted": inp.is_encrypted or use_e2ee,
        "is_e2ee": use_e2ee,
        "encrypted_at_rest": encryption_enabled() and not use_e2ee,
        "nonce": inp.nonce or "",
        "attachments": inp.attachments,
        "sender_device_id": inp.sender_device_id or None,
        "protocol_version": inp.protocol_version or E2EE_PROTOCOL_VERSION,
        "message_type": inp.message_type or "text",
        "key_envelopes": inp.key_envelopes or [],
        "read": False,
        "created_at": now_utc(),
    }
    await db.direct_messages.insert_one(message)
    message.pop("_id", None)
    if message.get("encrypted_at_rest") and not message.get("is_e2ee"):
        message["content"] = decrypt_dm_content(user["id"], other_user_id, message["content"])
    message["sender"] = sanitize_user(user)
    await ws_mgr.send(other_user_id, {"type": "dm_message", "message": message})
    await create_notification(
        other_user_id,
        ntype="dm",
        title=f"DM from {user['display_name']}",
        body="[Encrypted message]" if use_e2ee or inp.is_encrypted else inp.content[:100],
        link=f"/dm/{user['id']}",
        from_user_id=user["id"],
    )
    return message
