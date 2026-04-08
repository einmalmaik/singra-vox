from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.config import ADMIN_ROLE, OWNER_ROLE, USER_ROLE
from app.core.database import db
from app.core.utils import sanitize_user
from app.dependencies import current_user, require_instance_admin, require_instance_owner
from app.schemas import InstanceAdminUpdateInput


router = APIRouter(prefix="/api/instance", tags=["Instance"])


@router.get("/admins")
async def list_instance_admins(request: Request):
    user = await current_user(request)
    await require_instance_admin(user)
    admins = await db.users.find(
        {"instance_role": {"$in": [OWNER_ROLE, ADMIN_ROLE]}},
        {"_id": 0, "password_hash": 0},
    ).sort("created_at", 1).to_list(100)
    return [sanitize_user(admin) for admin in admins]


@router.post("/admins")
async def promote_instance_admin(inp: InstanceAdminUpdateInput, request: Request):
    user = await current_user(request)
    await require_instance_owner(user)
    target = await db.users.find_one({"id": inp.user_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("instance_role") == OWNER_ROLE:
        return sanitize_user(target)
    await db.users.update_one(
        {"id": inp.user_id},
        {"$set": {"instance_role": ADMIN_ROLE, "role": ADMIN_ROLE}},
    )
    updated = await db.users.find_one({"id": inp.user_id}, {"_id": 0, "password_hash": 0})
    return sanitize_user(updated)


@router.delete("/admins/{user_id}")
async def demote_instance_admin(user_id: str, request: Request):
    user = await current_user(request)
    await require_instance_owner(user)
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(404, "User not found")
    if target.get("instance_role") == OWNER_ROLE:
        raise HTTPException(400, "Owner cannot be demoted")
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"instance_role": USER_ROLE, "role": USER_ROLE}},
    )
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    return sanitize_user(updated)
