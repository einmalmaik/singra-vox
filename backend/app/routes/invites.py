from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from pymongo import ReturnDocument

from app.core.database import db
from app.core.utils import now_utc, sanitize_user
from app.dependencies import current_user
from app.rate_limits import enforce_fixed_window_rate_limit
from app.services.server_ops import build_member_payload
from app.ws import ws_mgr


router = APIRouter(prefix="/api/invites", tags=["Invites"])


def invite_is_expired(invite: dict) -> bool:
    expires_at = invite.get("expires_at")
    return bool(expires_at and datetime.fromisoformat(expires_at) < datetime.now(timezone.utc))


def invite_is_exhausted(invite: dict) -> bool:
    max_uses = int(invite.get("max_uses") or 0)
    if max_uses <= 0:
        return False
    return int(invite.get("uses") or 0) >= max_uses


@router.get("/{code}")
async def get_invite(code: str):
    invite = await db.invites.find_one({"code": code}, {"_id": 0})
    if not invite:
        raise HTTPException(404, "Invite not found")
    if invite_is_expired(invite):
        raise HTTPException(410, "Invite expired")
    if invite_is_exhausted(invite):
        raise HTTPException(410, "Invite exhausted")
    server = await db.servers.find_one({"id": invite["server_id"]}, {"_id": 0})
    return {"invite": invite, "server": server}


@router.post("/{code}/accept")
async def accept_invite(code: str, request: Request):
    user = await current_user(request)
    await enforce_fixed_window_rate_limit(
        db,
        scope="invites.accept",
        key=f"{user['id']}:{code}",
        limit=15,
        window_seconds=10 * 60,
        error_message="Too many invite accept attempts. Try again later.",
        code="invite_accept_rate_limited",
    )

    invite = await db.invites.find_one({"code": code}, {"_id": 0})
    if not invite:
        raise HTTPException(404, "Invite not found")
    if invite_is_expired(invite):
        raise HTTPException(410, "Invite expired")

    existing = await db.server_members.find_one(
        {"server_id": invite["server_id"], "user_id": user["id"]},
        {"_id": 0},
    )
    if existing:
        if existing.get("is_banned"):
            raise HTTPException(403, "You are banned")
        return {"ok": True, "server_id": invite["server_id"]}
    if invite_is_exhausted(invite):
        raise HTTPException(410, "Invite exhausted")

    await db.server_members.insert_one(
        {
            "server_id": invite["server_id"],
            "user_id": user["id"],
            "roles": [],
            "nickname": "",
            "joined_at": now_utc(),
            "muted_until": None,
            "is_banned": False,
            "ban_reason": "",
        }
    )
    usage_query: dict[str, object] = {"code": code}
    if invite.get("max_uses"):
        usage_query["uses"] = {"$lt": invite["max_uses"]}
    invite_after_increment = await db.invites.find_one_and_update(
        usage_query,
        {"$inc": {"uses": 1}},
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0},
    )
    if not invite_after_increment:
        await db.server_members.delete_one({"server_id": invite["server_id"], "user_id": user["id"]})
        raise HTTPException(410, "Invite exhausted")

    ws_mgr.add_server(user["id"], invite["server_id"])
    member_payload = await build_member_payload(invite["server_id"], user["id"])
    await ws_mgr.broadcast_server(
        invite["server_id"],
        {
            "type": "member_joined",
            "server_id": invite["server_id"],
            "member": member_payload,
            "user": sanitize_user(user),
        },
    )
    return {"ok": True, "server_id": invite["server_id"]}
