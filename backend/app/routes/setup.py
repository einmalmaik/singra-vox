from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pymongo.errors import DuplicateKeyError

from app.core.config import INSTANCE_SETTINGS_ID, OWNER_ROLE
from app.core.database import db
from app.core.utils import new_id, now_utc
from app.dependencies import get_instance_settings
from app.schemas import BootstrapInput
from app.services.auth_flow import ensure_unique_identity, hash_pw, issue_auth_response, normalize_username


router = APIRouter(prefix="/api/setup", tags=["Setup"])


@router.get("/status")
async def setup_status():
    settings = await get_instance_settings()
    server_count = await db.servers.count_documents({})
    return {
        "initialized": settings.get("initialized", False),
        "setup_required": not settings.get("initialized", False),
        "allow_open_signup": settings.get("allow_open_signup", False),
        "community_count": server_count,
        "server_count": server_count,
        "instance_name": settings.get("instance_name", ""),
    }


@router.post("/bootstrap")
async def bootstrap(inp: BootstrapInput, request: Request, response: Response):
    existing_settings = await get_instance_settings()
    if existing_settings.get("initialized"):
        raise HTTPException(409, "Instance is already initialized")

    email = inp.owner_email.lower().strip()
    username = normalize_username(inp.owner_username)
    await ensure_unique_identity(email, username)

    try:
        await db.instance_settings.insert_one(
            {
                "id": INSTANCE_SETTINGS_ID,
                "initialized": False,
                "setup_in_progress": True,
                "instance_name": inp.instance_name.strip(),
                "allow_open_signup": bool(inp.allow_open_signup),
                "created_at": now_utc(),
            }
        )
    except DuplicateKeyError:
        claimed = await db.instance_settings.find_one({"id": INSTANCE_SETTINGS_ID}, {"_id": 0})
        if claimed and claimed.get("initialized"):
            raise HTTPException(409, "Instance is already initialized")
        raise HTTPException(409, "Setup is already in progress")

    uid = new_id()
    owner_user = {
        "id": uid,
        "email": email,
        "username": username,
        "display_name": inp.owner_display_name.strip(),
        "password_hash": hash_pw(inp.owner_password),
        "avatar_url": "",
        "status": "online",
        "public_key": "",
        "role": OWNER_ROLE,
        "instance_role": OWNER_ROLE,
        "email_verified": True,
        "email_verified_at": now_utc(),
        "created_at": now_utc(),
        "last_seen": now_utc(),
    }

    try:
        await db.users.insert_one(owner_user)
        await db.instance_settings.update_one(
            {"id": INSTANCE_SETTINGS_ID},
            {
                "$set": {
                    "initialized": True,
                    "instance_name": inp.instance_name.strip(),
                    "owner_user_id": uid,
                    "allow_open_signup": bool(inp.allow_open_signup),
                    "setup_completed_at": now_utc(),
                    "setup_in_progress": False,
                }
            },
        )
    except Exception:
        await db.instance_settings.delete_one({"id": INSTANCE_SETTINGS_ID, "initialized": False})
        await db.users.delete_one({"id": uid})
        raise

    auth_payload = await issue_auth_response(owner_user, request, response)
    return {
        **auth_payload,
        "setup": {
            "initialized": True,
            "instance_name": inp.instance_name.strip(),
            "allow_open_signup": bool(inp.allow_open_signup),
        },
    }
