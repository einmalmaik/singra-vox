from __future__ import annotations

from app.core.database import db
from app.core.utils import new_id, now_utc, sanitize_user
from app.ws import ws_mgr


async def log_status_history(user_id: str, status: str) -> None:
    await db.status_history.insert_one(
        {
            "id": new_id(),
            "user_id": user_id,
            "status": status,
            "created_at": now_utc(),
        }
    )


async def list_member_server_ids(user_id: str) -> list[str]:
    memberships = await db.server_members.find(
        {"user_id": user_id, "is_banned": {"$ne": True}},
        {"_id": 0, "server_id": 1},
    ).to_list(500)
    return [membership["server_id"] for membership in memberships]


async def broadcast_presence_update(user_id: str) -> None:
    member_user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not member_user:
        return

    payload = {
        "type": "presence_update",
        "user_id": user_id,
        "user": sanitize_user(member_user),
    }
    member_server_ids = set(await list_member_server_ids(user_id))
    if not member_server_ids:
        return

    recipient_ids = [
        uid
        for uid, server_ids in list(ws_mgr.user_servers.items())
        if member_server_ids.intersection(server_ids)
    ]
    for recipient_id in recipient_ids:
        await ws_mgr.send(recipient_id, payload)
