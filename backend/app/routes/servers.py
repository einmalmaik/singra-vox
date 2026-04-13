from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.database import db
from app.dependencies import current_user, require_instance_owner
from app.permissions import assert_server_permission, build_viewer_context
from app.schemas import OwnershipTransferInput, ServerCreateInput
from app.services.server_ops import (
    clear_voice_membership,
    create_default_server,
    delete_server_cascade,
    get_server_member,
    log_audit,
)
from app.ws import ws_mgr


router = APIRouter(prefix="/api/servers", tags=["Servers"])


@router.get("")
async def list_servers(request: Request):
    user = await current_user(request)
    memberships = await db.server_members.find(
        {"user_id": user["id"], "is_banned": {"$ne": True}},
        {"_id": 0, "server_id": 1},
    ).to_list(100)
    server_ids = [membership["server_id"] for membership in memberships]
    if not server_ids:
        return []
    return await db.servers.find({"id": {"$in": server_ids}}, {"_id": 0}).to_list(100)


@router.post("")
async def create_server(inp: ServerCreateInput, request: Request):
    user = await current_user(request)
    await require_instance_owner(user)
    server = await create_default_server(user, inp.name, inp.description)
    ws_mgr.add_server(user["id"], server["id"])
    server.pop("_id", None)
    return server


@router.get("/{server_id}")
async def get_server(server_id: str, request: Request):
    user = await current_user(request)
    member = await db.server_members.find_one(
        {"server_id": server_id, "user_id": user["id"]},
        {"_id": 0},
    )
    if not member or member.get("is_banned"):
        raise HTTPException(403, "Not a member")
    server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if not server:
        raise HTTPException(404, "Server not found")
    return server


@router.put("/{server_id}")
async def update_server(server_id: str, request: Request):
    user = await current_user(request)
    await assert_server_permission(db, user["id"], server_id, "manage_server", "No permission")
    body = await request.json()
    updates = {
        key: value
        for key, value in body.items()
        if key in {"name", "description", "icon_url"} and value is not None
    }
    if updates:
        await db.servers.update_one({"id": server_id}, {"$set": updates})
    server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if server:
        await ws_mgr.broadcast_server(server_id, {"type": "server_updated", "server": server})
    return server


@router.delete("/{server_id}")
async def delete_server(server_id: str, request: Request):
    actor = await current_user(request)
    server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if not server:
        raise HTTPException(404, "Server not found")
    if server.get("owner_id") != actor["id"]:
        raise HTTPException(403, "Only the current server owner can delete this server")

    memberships = await db.server_members.find(
        {"server_id": server_id},
        {"_id": 0, "user_id": 1},
    ).to_list(1000)
    member_ids = sorted(
        membership["user_id"] for membership in memberships if membership.get("user_id")
    )
    for member_id in member_ids:
        await clear_voice_membership(member_id, server_id=server_id, force_reason="deleted")

    await delete_server_cascade(server_id)

    for member_id in member_ids:
        ws_mgr.remove_server(member_id, server_id)
        await ws_mgr.send(member_id, {"type": "server_deleted", "server_id": server_id})

    return {"ok": True}


@router.post("/{server_id}/ownership/transfer")
async def transfer_server_ownership(server_id: str, inp: OwnershipTransferInput, request: Request):
    actor = await current_user(request)
    server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if not server:
        raise HTTPException(404, "Server not found")
    if server.get("owner_id") != actor["id"]:
        raise HTTPException(403, "Only the current server owner can transfer ownership")
    if inp.user_id == actor["id"]:
        raise HTTPException(400, "You already own this server")

    target_member = await get_server_member(server_id, inp.user_id)
    if not target_member or target_member.get("is_banned"):
        raise HTTPException(404, "Target member not found")

    await db.servers.update_one({"id": server_id}, {"$set": {"owner_id": inp.user_id}})
    updated_server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    await log_audit(
        server_id,
        actor["id"],
        "ownership_transfer",
        "server",
        server_id,
        {"from_user_id": actor["id"], "to_user_id": inp.user_id},
    )
    await ws_mgr.broadcast_server(server_id, {"type": "server_updated", "server": updated_server})
    return updated_server


@router.post("/{server_id}/leave")
async def leave_server(server_id: str, request: Request):
    user = await current_user(request)
    server = await db.servers.find_one({"id": server_id}, {"_id": 0})
    if not server:
        raise HTTPException(404, "Server not found")

    membership = await get_server_member(server_id, user["id"])
    if not membership or membership.get("is_banned"):
        raise HTTPException(403, "Not a member")
    if server.get("owner_id") == user["id"]:
        raise HTTPException(400, "Transfer ownership before leaving this server")

    await clear_voice_membership(user["id"], server_id=server_id, force_reason="left")
    await db.server_members.delete_one({"server_id": server_id, "user_id": user["id"]})
    ws_mgr.remove_server(user["id"], server_id)
    await log_audit(server_id, user["id"], "member_leave", "user", user["id"], {})
    payload = {"type": "member_left", "server_id": server_id, "user_id": user["id"]}
    await ws_mgr.broadcast_server(server_id, payload)
    await ws_mgr.send(
        user["id"],
        {"type": "server_left", "server_id": server_id, "user_id": user["id"]},
    )
    return {"ok": True}


@router.get("/{server_id}/viewer-context")
async def get_server_viewer_context(server_id: str, request: Request):
    user = await current_user(request)
    member = await db.server_members.find_one(
        {"server_id": server_id, "user_id": user["id"]},
        {"_id": 0},
    )
    if not member or member.get("is_banned"):
        raise HTTPException(403, "Not a member")
    return await build_viewer_context(db, user["id"], server_id)
