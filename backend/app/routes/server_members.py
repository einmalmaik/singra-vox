from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.database import db
from app.core.utils import sanitize_user
from app.dependencies import current_user
from app.services.server_ops import (
    build_member_payload,
    check_permission,
    clear_voice_membership,
    log_audit,
)
from app.ws import ws_mgr


router = APIRouter(prefix="/api/servers", tags=["Servers"])


@router.get("/{server_id}/members")
async def list_members(server_id: str, request: Request):
    user = await current_user(request)
    member = await db.server_members.find_one(
        {"server_id": server_id, "user_id": user["id"]},
        {"_id": 0},
    )
    if not member:
        raise HTTPException(403, "Not a member")
    members = await db.server_members.find(
        {"server_id": server_id, "is_banned": {"$ne": True}},
        {"_id": 0},
    ).to_list(500)
    result = []
    for item in members:
        member_user = await db.users.find_one(
            {"id": item["user_id"]},
            {"_id": 0, "password_hash": 0},
        )
        if member_user:
            item["user"] = sanitize_user(member_user)
            result.append(item)
    return result


@router.put("/{server_id}/members/{user_id}")
async def update_member(server_id: str, user_id: str, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "manage_members"):
        raise HTTPException(403, "No permission")

    body = await request.json()
    updates = {}
    if "roles" in body:
        updates["roles"] = body["roles"]
    if "nickname" in body:
        updates["nickname"] = body["nickname"]
    if updates:
        await db.server_members.update_one(
            {"server_id": server_id, "user_id": user_id},
            {"$set": updates},
        )
        member_payload = await build_member_payload(server_id, user_id)
        if member_payload:
            await ws_mgr.broadcast_server(
                server_id,
                {"type": "member_updated", "server_id": server_id, "member": member_payload},
            )
    return {"ok": True}


@router.delete("/{server_id}/members/{user_id}")
async def kick_member(server_id: str, user_id: str, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "kick_members"):
        raise HTTPException(403, "No permission")
    server = await db.servers.find_one({"id": server_id}, {"_id": 0, "owner_id": 1})
    if server and server.get("owner_id") == user_id:
        raise HTTPException(400, "Cannot remove the server owner")

    await clear_voice_membership(user_id, server_id=server_id, force_reason="kicked")
    await db.server_members.delete_one({"server_id": server_id, "user_id": user_id})
    ws_mgr.remove_server(user_id, server_id)
    await log_audit(server_id, actor["id"], "member_kick", "user", user_id, {})
    payload = {"type": "member_kicked", "server_id": server_id, "user_id": user_id}
    await ws_mgr.broadcast_server(server_id, payload)
    await ws_mgr.send(user_id, payload)
    return {"ok": True}
