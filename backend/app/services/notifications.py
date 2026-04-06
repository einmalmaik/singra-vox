# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox – Notification service
====================================
Central place for creating in-app and Web-Push notifications.

Call :func:`send_notification` from any route module that needs to
notify a user.  The function:
  1. Persists the notification in MongoDB (in-app centre).
  2. Delivers it over WebSocket for real-time display.
  3. Sends a Web-Push message when the user has no active web connection.
"""

from __future__ import annotations

import json
import logging
import os

from app.core.database import db
from app.core.utils import now_utc, new_id
from app.ws import ws_mgr

log = logging.getLogger(__name__)

# ── VAPID configuration (set in backend/.env) ─────────────────────────────────
_VAPID_PRIVATE_KEY: str | None = os.environ.get("VAPID_PRIVATE_KEY") or None
_VAPID_PUBLIC_KEY: str | None = os.environ.get("VAPID_PUBLIC_KEY") or None
_VAPID_CLAIMS: dict = {
    "sub": f"mailto:{os.environ.get('VAPID_EMAIL', 'admin@singravox.local')}"
}

try:
    from pywebpush import webpush as _webpush, WebPushException as _WebPushException
    _WEB_PUSH_AVAILABLE = True
except ImportError:
    _webpush = None  # type: ignore[assignment]
    _WebPushException = Exception  # type: ignore[assignment,misc]
    _WEB_PUSH_AVAILABLE = False


async def send_notification(
    user_id: str,
    *,
    ntype: str,
    title: str,
    body: str,
    link: str | None = None,
    from_user_id: str | None = None,
) -> None:
    """Create and deliver a notification to *user_id*.

    Parameters
    ----------
    user_id:        Recipient user UUID.
    ntype:          Short notification type tag (e.g. ``"mention"``).
    title:          Notification title shown in the UI.
    body:           Notification body text.
    link:           Optional deep-link URL inside the app.
    from_user_id:   Optional actor user UUID (sender of the message, etc.).
    """
    notification = {
        "id": new_id(),
        "user_id": user_id,
        "type": ntype,
        "title": title,
        "body": body,
        "link": link or "",
        "from_user_id": from_user_id,
        "read": False,
        "created_at": now_utc(),
    }
    await db.notifications.insert_one(notification)
    notification.pop("_id", None)

    # Hydrate the actor for the WebSocket payload
    if from_user_id:
        actor = await db.users.find_one(
            {"id": from_user_id}, {"_id": 0, "password_hash": 0}
        )
        notification["from_user"] = actor

    # Skip push/real-time if the user has Do Not Disturb active
    user = await db.users.find_one(
        {"id": user_id}, {"_id": 0, "status": 1, "notification_preferences": 1}
    )
    if not user or user.get("status") == "dnd":
        return

    # Real-time delivery via WebSocket
    await ws_mgr.send(user_id, {"type": "notification", "notification": notification})

    # Web-Push fallback when the user has no active web connection
    if "web" not in ws_mgr.get_platforms(user_id) and _WEB_PUSH_AVAILABLE:
        prefs = user.get("notification_preferences") or {"web_push_enabled": True}
        if prefs.get("web_push_enabled") and _VAPID_PRIVATE_KEY:
            subs = await db.push_subscriptions.find(
                {"user_id": user_id, "platform": "web"}
            ).to_list(10)
            for sub in subs:
                try:
                    _webpush(
                        subscription_info=sub["subscription"],
                        data=json.dumps(
                            {"title": title, "body": body, "url": link or "/", "icon": "/logo192.png"}
                        ),
                        vapid_private_key=_VAPID_PRIVATE_KEY,
                        vapid_claims=_VAPID_CLAIMS,
                    )
                except Exception as exc:  # noqa: BLE001
                    log.debug("Web-Push delivery failed for sub %s: %s", sub.get("id"), exc)
