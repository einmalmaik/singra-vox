"""
Singra Vox – Notification routes
===================================
Manages in-app and Web-Push notifications.

Routes
------
    GET    /api/notifications
    POST   /api/notifications/{id}/read
    POST   /api/notifications/read-all
    DELETE /api/notifications/{id}
    GET    /api/notifications/vapid-public-key
    GET    /api/users/me/notifications/preferences
    PUT    /api/users/me/notifications/preferences
    POST   /api/users/me/notifications/subscriptions
    GET    /api/users/{user_id}/status/history
"""
from __future__ import annotations

import os

from fastapi import APIRouter, Request
from pydantic import BaseModel

from app.auth_service import load_current_user
from app.core.database import db
from app.core.utils import now_utc

router = APIRouter(prefix="/api", tags=["notifications"])

_VAPID_PUBLIC_KEY: str | None = os.environ.get("VAPID_PUBLIC_KEY") or None


async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


# ── Input models ──────────────────────────────────────────────────────────────

class PushSubscriptionInput(BaseModel):
    subscription: dict   # W3C PushSubscription JSON
    platform: str        # "web" | "desktop"


class NotificationPreferenceInput(BaseModel):
    web_push_enabled: bool = True
    desktop_push_enabled: bool = True


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/notifications")
async def list_notifications(
    request: Request, limit: int = 50, unread_only: bool = False
) -> dict:
    """Return the current user's notifications, newest first."""
    user = await _current_user(request)
    query: dict = {"user_id": user["id"]}
    if unread_only:
        query["read"] = False

    notifications = await db.notifications.find(
        query, {"_id": 0}
    ).sort("created_at", -1).to_list(limit)

    for n in notifications:
        if n.get("from_user_id"):
            n["from_user"] = await db.users.find_one(
                {"id": n["from_user_id"]}, {"_id": 0, "password_hash": 0}
            )

    unread_count = await db.notifications.count_documents(
        {"user_id": user["id"], "read": False}
    )
    return {"notifications": notifications, "unread_count": unread_count}


@router.post("/notifications/{notif_id}/read")
async def mark_notification_read(notif_id: str, request: Request) -> dict:
    user = await _current_user(request)
    await db.notifications.update_one(
        {"id": notif_id, "user_id": user["id"]}, {"$set": {"read": True}}
    )
    return {"ok": True}


@router.post("/notifications/read-all")
async def mark_all_notifications_read(request: Request) -> dict:
    user = await _current_user(request)
    await db.notifications.update_many(
        {"user_id": user["id"], "read": False}, {"$set": {"read": True}}
    )
    return {"ok": True}


@router.delete("/notifications/{notif_id}")
async def delete_notification(notif_id: str, request: Request) -> dict:
    user = await _current_user(request)
    await db.notifications.delete_one({"id": notif_id, "user_id": user["id"]})
    return {"ok": True}


@router.get("/notifications/vapid-public-key")
async def get_vapid_public_key() -> dict:
    """Return the server's VAPID public key for Web-Push subscriptions."""
    return {"publicKey": _VAPID_PUBLIC_KEY}


@router.get("/users/me/notifications/preferences")
async def get_notification_preferences(request: Request) -> dict:
    user = await _current_user(request)
    return user.get("notification_preferences") or {
        "web_push_enabled": True,
        "desktop_push_enabled": True,
    }


@router.put("/users/me/notifications/preferences")
async def update_notification_preferences(
    inp: NotificationPreferenceInput, request: Request
) -> dict:
    user = await _current_user(request)
    prefs = inp.model_dump()
    await db.users.update_one(
        {"id": user["id"]}, {"$set": {"notification_preferences": prefs}}
    )
    return prefs


@router.post("/users/me/notifications/subscriptions")
async def register_push_subscription(inp: PushSubscriptionInput, request: Request) -> dict:
    """Register or refresh a Web-Push subscription endpoint."""
    user = await _current_user(request)
    endpoint = inp.subscription.get("endpoint")
    await db.push_subscriptions.update_one(
        {"user_id": user["id"], "subscription.endpoint": endpoint},
        {
            "$set": {
                "subscription": inp.subscription,
                "platform": inp.platform,
                "updated_at": now_utc(),
            }
        },
        upsert=True,
    )
    return {"ok": True}


@router.get("/users/{user_id}/status/history")
async def get_status_history(user_id: str, request: Request) -> list:
    """Return recent presence-status history for a user."""
    await _current_user(request)
    return await db.status_history.find(
        {"user_id": user_id}
    ).sort("created_at", -1).to_list(50)
