from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.database import db
from app.core.utils import new_id, now_utc
from app.dependencies import current_user
from app.permissions import DEFAULT_PERMISSIONS, assert_server_permission
from app.schemas import RoleCreateInput
from app.ws import ws_mgr


router = APIRouter(prefix="/api/servers", tags=["Servers"])


@router.get("/{server_id}/roles")
async def list_roles(server_id: str, request: Request):
    await current_user(request)
    roles = await db.roles.find({"server_id": server_id}, {"_id": 0}).sort("position", -1).to_list(50)
    for role in roles:
        role.setdefault("hoist", False)
    return roles


@router.post("/{server_id}/roles")
async def create_role(server_id: str, inp: RoleCreateInput, request: Request):
    user = await current_user(request)
    await assert_server_permission(db, user["id"], server_id, "manage_roles", "No permission")

    role = {
        "id": new_id(),
        "server_id": server_id,
        "name": inp.name,
        "color": inp.color,
        "permissions": {**DEFAULT_PERMISSIONS, **inp.permissions},
        "position": await db.roles.count_documents({"server_id": server_id}),
        "is_default": False,
        "mentionable": bool(inp.mentionable),
        "hoist": bool(inp.hoist),
        "created_at": now_utc(),
    }
    await db.roles.insert_one(role)
    role.pop("_id", None)
    await ws_mgr.broadcast_server(server_id, {"type": "role_created", "server_id": server_id, "role": role})
    return role


@router.put("/{server_id}/roles/{role_id}")
async def update_role(server_id: str, role_id: str, request: Request):
    user = await current_user(request)
    await assert_server_permission(db, user["id"], server_id, "manage_roles", "No permission")

    role = await db.roles.find_one({"id": role_id, "server_id": server_id}, {"_id": 0})
    if not role:
        raise HTTPException(404, "Role not found")

    body = await request.json()
    allowed_keys = (
        ("permissions",)
        if role.get("is_default")
        else ("name", "color", "permissions", "position", "mentionable", "hoist")
    )
    updates = {key: value for key, value in body.items() if key in allowed_keys}
    if "permissions" in updates:
        updates["permissions"] = {**DEFAULT_PERMISSIONS, **updates["permissions"]}
    if role.get("is_default"):
        updates["name"] = "@everyone"
        updates["mentionable"] = False
    if updates:
        await db.roles.update_one({"id": role_id, "server_id": server_id}, {"$set": updates})
    updated_role = await db.roles.find_one({"id": role_id}, {"_id": 0})
    if updated_role:
        await ws_mgr.broadcast_server(
            server_id,
            {"type": "role_updated", "server_id": server_id, "role": updated_role},
        )
    return updated_role


@router.delete("/{server_id}/roles/{role_id}")
async def delete_role(server_id: str, role_id: str, request: Request):
    user = await current_user(request)
    await assert_server_permission(db, user["id"], server_id, "manage_roles", "No permission")

    role = await db.roles.find_one({"id": role_id}, {"_id": 0})
    if role and role.get("is_default"):
        raise HTTPException(400, "Cannot delete default role")
    await db.roles.delete_one({"id": role_id})
    await ws_mgr.broadcast_server(
        server_id,
        {"type": "role_deleted", "server_id": server_id, "role_id": role_id},
    )
    return {"ok": True}
