from __future__ import annotations

from fastapi import HTTPException, Request

from app.auth_service import load_current_user
from app.core.config import ADMIN_ROLE, INSTANCE_SETTINGS_ID, OWNER_ROLE
from app.core.constants import E2EE_DEVICE_HEADER
from app.core.database import db
from app.core.utils import sanitize_user
from app.services.e2ee import get_device_record


async def current_user(request: Request) -> dict:
    user, _session = await load_current_user(db, request)
    return sanitize_user(user)


async def get_instance_settings() -> dict:
    settings = await db.instance_settings.find_one({"id": INSTANCE_SETTINGS_ID}, {"_id": 0})
    if settings:
        return settings
    return {
        "id": INSTANCE_SETTINGS_ID,
        "initialized": False,
        "instance_name": "",
        "owner_user_id": None,
        "allow_open_signup": False,
        "server_count": 0,
    }


async def require_instance_initialized() -> dict:
    settings = await get_instance_settings()
    if not settings.get("initialized"):
        raise HTTPException(409, "Instance setup required")
    return settings


async def require_instance_admin(user: dict) -> dict:
    if user.get("instance_role") not in {OWNER_ROLE, ADMIN_ROLE}:
        raise HTTPException(403, "Instance admin required")
    return user


async def require_instance_owner(user: dict) -> dict:
    if user.get("instance_role") != OWNER_ROLE:
        raise HTTPException(403, "Instance owner required")
    return user


def request_device_id(request: Request) -> str | None:
    return (request.headers.get(E2EE_DEVICE_HEADER) or "").strip() or None


async def require_verified_device(request: Request, user: dict) -> dict:
    device_id = request_device_id(request)
    if not device_id:
        raise HTTPException(428, "E2EE device header required for end-to-end encryption")
    device = await get_device_record(user["id"], device_id)
    if not device or device.get("revoked_at"):
        raise HTTPException(428, "Verified desktop device required for end-to-end encryption")
    if not device.get("verified_at"):
        raise HTTPException(428, "This E2EE device is not verified yet")
    return device
