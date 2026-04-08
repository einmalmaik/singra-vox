from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request

from app.core.database import db
from app.core.utils import now_utc
from app.dependencies import current_user
from app.schemas import InviteCreateInput
from app.services.server_ops import check_permission


router = APIRouter(prefix="/api/servers", tags=["Servers"])


@router.get("/{server_id}/invites")
async def list_invites(server_id: str, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_server"):
        raise HTTPException(403, "No permission")
    return await db.invites.find({"server_id": server_id}, {"_id": 0}).sort("created_at", -1).to_list(50)


@router.post("/{server_id}/invites")
async def create_invite(server_id: str, inp: InviteCreateInput, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "create_invites"):
        raise HTTPException(403, "No permission")

    code = secrets.token_urlsafe(8)
    invite = {
        "code": code,
        "server_id": server_id,
        "creator_id": user["id"],
        "uses": 0,
        "max_uses": inp.max_uses,
        "expires_at": (
            datetime.now(timezone.utc) + timedelta(hours=inp.expires_hours)
        ).isoformat()
        if inp.expires_hours
        else None,
        "created_at": now_utc(),
    }
    await db.invites.insert_one(invite)
    invite.pop("_id", None)
    return invite
