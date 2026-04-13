from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.core.config import PASSWORD_RESET_PURPOSE
from app.core.database import db
from app.dependencies import current_user
from app.schemas import PasswordChangeInput, ProfileUpdateInput
from app.services.auth_flow import hash_pw, normalize_username, verify_pw
from app.services.presence import broadcast_presence_update, log_status_history


router = APIRouter(prefix="/api/users", tags=["Users"])


@router.get("/search")
async def search_users(request: Request, q: str = ""):
    await current_user(request)
    if len(q) < 2:
        return []
    return await db.users.find(
        {
            "$or": [
                {"username": {"$regex": q, "$options": "i"}},
                {"display_name": {"$regex": q, "$options": "i"}},
            ]
        },
        {"_id": 0, "password_hash": 0},
    ).to_list(20)


@router.get("/{user_id}")
async def get_user_profile(user_id: str, request: Request):
    await current_user(request)
    user = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(404, "User not found")
    return user


@router.put("/me")
async def update_profile(inp: ProfileUpdateInput, request: Request):
    user = await current_user(request)
    updates = {key: value for key, value in inp.model_dump().items() if value is not None}
    next_username = updates.pop("username", None)
    if next_username is not None:
        normalized_username = normalize_username(next_username)
        if normalized_username != user["username"]:
            existing_user = await db.users.find_one({"username": normalized_username}, {"_id": 0, "id": 1})
            if existing_user and existing_user.get("id") != user["id"]:
                raise HTTPException(400, "Username taken")
            updates["username"] = normalized_username

    if updates:
        if "status" in updates and updates["status"] != user.get("status"):
            updates["preferred_status"] = updates["status"]
            await log_status_history(user["id"], updates["status"])
        await db.users.update_one({"id": user["id"]}, {"$set": updates})
        await broadcast_presence_update(user["id"])
    return await db.users.find_one({"id": user["id"]}, {"_id": 0, "password_hash": 0})


@router.put("/me/password")
async def change_password(inp: PasswordChangeInput, request: Request):
    user = await current_user(request)
    stored_user = await db.users.find_one({"id": user["id"]}, {"_id": 0})
    if not stored_user or not verify_pw(inp.current_password, stored_user["password_hash"]):
        raise HTTPException(400, "Current password is incorrect")
    if inp.current_password == inp.new_password:
        raise HTTPException(400, "New password must be different from the current password")

    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {"password_hash": hash_pw(inp.new_password)}},
    )
    await db.email_verifications.delete_many({"user_id": user["id"], "purpose": PASSWORD_RESET_PURPOSE})
    return {"ok": True}


@router.post("/me/public-key")
async def set_public_key(request: Request):
    user = await current_user(request)
    body = await request.json()
    await db.users.update_one({"id": user["id"]}, {"$set": {"public_key": body.get("public_key", "")}})
    return {"ok": True}


@router.get("/{user_id}/public-key")
async def get_public_key(user_id: str, request: Request):
    await current_user(request)
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not user:
        raise HTTPException(404)
    return {"public_key": user.get("public_key", "")}
