"""
Singra Vox – Webhook routes
==============================
Allows external services to post messages to channels via a
secret-token webhook URL.

Security
--------
* Tokens are 32-byte URL-safe random strings (`secrets.token_urlsafe`).
* The execution endpoint requires no authentication – the token IS the
  credential.  Tokens must therefore be kept secret by the server owner.
* Rate limit: 30 requests per minute per webhook to prevent abuse.

Routes
------
    POST   /api/servers/{server_id}/webhooks
    GET    /api/servers/{server_id}/webhooks
    PUT    /api/servers/{server_id}/webhooks/{webhook_id}
    DELETE /api/servers/{server_id}/webhooks/{webhook_id}
    POST   /api/webhooks/exec/{token}     (no auth, token-secured)
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request

from app.core.database import db
from app.core.utils import now_utc, new_id
from app.auth_service import load_current_user
from app.permissions import has_server_permission

router = APIRouter(prefix="/api", tags=["webhooks"])

_RATE_LIMIT_WINDOW_SECS = 60
_RATE_LIMIT_MAX_CALLS = 30


async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


async def _can_manage_webhooks(user_id: str, server_id: str) -> bool:
    return await has_server_permission(
        db, user_id, server_id, "manage_webhooks"
    ) or await has_server_permission(db, user_id, server_id, "manage_server")


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/servers/{server_id}/webhooks")
async def create_webhook(server_id: str, request: Request) -> dict:
    """Create a new incoming webhook for a channel."""
    user = await _current_user(request)
    if not await _can_manage_webhooks(user["id"], server_id):
        raise HTTPException(403, "No permission to manage webhooks")

    body = await request.json()
    if not body.get("channel_id"):
        raise HTTPException(400, "channel_id is required")

    token = secrets.token_urlsafe(32)
    webhook = {
        "id": new_id(),
        "server_id": server_id,
        "channel_id": body["channel_id"],
        "name": body.get("name", "Webhook"),
        "avatar_url": body.get("avatar_url", ""),
        "token": token,
        "enabled": True,
        "created_by": user["id"],
        "created_at": now_utc(),
        "last_used": None,
        "use_count": 0,
    }
    await db.webhooks.insert_one(webhook)
    webhook.pop("_id", None)
    return webhook


@router.get("/servers/{server_id}/webhooks")
async def list_webhooks(server_id: str, request: Request) -> list:
    user = await _current_user(request)
    if not await _can_manage_webhooks(user["id"], server_id):
        raise HTTPException(403, "No permission to manage webhooks")
    return await db.webhooks.find({"server_id": server_id}, {"_id": 0}).to_list(50)


@router.put("/servers/{server_id}/webhooks/{webhook_id}")
async def update_webhook(server_id: str, webhook_id: str, request: Request) -> dict | None:
    user = await _current_user(request)
    if not await _can_manage_webhooks(user["id"], server_id):
        raise HTTPException(403, "No permission to manage webhooks")

    body = await request.json()
    updates = {
        k: v for k, v in body.items()
        if k in ("name", "avatar_url", "enabled", "channel_id")
    }
    if updates:
        await db.webhooks.update_one(
            {"id": webhook_id, "server_id": server_id}, {"$set": updates}
        )
    return await db.webhooks.find_one({"id": webhook_id}, {"_id": 0})


@router.delete("/servers/{server_id}/webhooks/{webhook_id}")
async def delete_webhook(server_id: str, webhook_id: str, request: Request) -> dict:
    user = await _current_user(request)
    if not await _can_manage_webhooks(user["id"], server_id):
        raise HTTPException(403, "No permission to manage webhooks")
    await db.webhooks.delete_one({"id": webhook_id, "server_id": server_id})
    return {"ok": True}


@router.post("/webhooks/exec/{token}")
async def execute_webhook(token: str, request: Request) -> dict:
    """Execute a webhook (post a message).  Authentication = token."""
    webhook = await db.webhooks.find_one({"token": token}, {"_id": 0})
    if not webhook:
        raise HTTPException(404, "Webhook not found")
    if not webhook.get("enabled"):
        raise HTTPException(403, "Webhook is disabled")

    # Rate limit: max 30 calls per 60 seconds per webhook
    window_start = (
        datetime.now(timezone.utc) - timedelta(seconds=_RATE_LIMIT_WINDOW_SECS)
    ).isoformat()
    recent = await db.webhook_logs.count_documents({
        "webhook_id": webhook["id"],
        "created_at": {"$gt": window_start},
    })
    if recent >= _RATE_LIMIT_MAX_CALLS:
        raise HTTPException(429, f"Rate limit exceeded ({_RATE_LIMIT_MAX_CALLS}/min)")

    body = await request.json()
    content = body.get("content", "").strip()
    if not content:
        raise HTTPException(400, "content is required")

    msg = {
        "id": new_id(),
        "channel_id": webhook["channel_id"],
        "author_id": f"webhook:{webhook['id']}",
        "content": content,
        "type": "webhook",
        "attachments": body.get("attachments", []),
        "edited_at": None,
        "is_deleted": False,
        "reactions": {},
        "reply_to_id": None,
        "mention_ids": [],
        "thread_id": None,
        "thread_count": 0,
        "webhook_name": body.get("username") or webhook.get("name", "Webhook"),
        "webhook_avatar": body.get("avatar_url") or webhook.get("avatar_url", ""),
        "created_at": now_utc(),
    }
    await db.messages.insert_one(msg)
    msg.pop("_id", None)
    await db.webhooks.update_one(
        {"id": webhook["id"]},
        {"$set": {"last_used": now_utc()}, "$inc": {"use_count": 1}},
    )
    await db.webhook_logs.insert_one({"webhook_id": webhook["id"], "created_at": now_utc()})
    return {"ok": True, "message_id": msg["id"]}
