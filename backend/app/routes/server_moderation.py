from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request

from app.core.database import db
from app.core.encryption import decrypt_metadata
from app.core.utils import sanitize_user
from app.dependencies import current_user
from app.rate_limits import enforce_fixed_window_rate_limit
from app.schemas import ModerationInput
from app.services.server_ops import (
    build_member_payload,
    check_permission,
    clear_voice_membership,
    get_server_member,
    log_audit,
)
from app.ws import ws_mgr


router = APIRouter(prefix="/api/servers", tags=["Servers"])


@router.get("/{server_id}/moderation/bans")
async def list_bans(server_id: str, request: Request):
    actor = await current_user(request)
    if not (
        await check_permission(actor["id"], server_id, "ban_members")
        or await check_permission(actor["id"], server_id, "manage_members")
    ):
        raise HTTPException(403, "No permission")

    banned_members = await db.server_members.find(
        {"server_id": server_id, "is_banned": True},
        {"_id": 0},
    ).to_list(500)
    result = []
    for member in banned_members:
        banned_user = await db.users.find_one(
            {"id": member["user_id"]},
            {"_id": 0, "password_hash": 0},
        )
        if banned_user:
            member["user"] = sanitize_user(banned_user)
            result.append(member)
    return result


@router.post("/{server_id}/moderation/ban")
async def ban_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "ban_members"):
        raise HTTPException(403, "No permission")
    await enforce_fixed_window_rate_limit(
        db,
        scope="moderation.ban",
        key=f"{server_id}:{actor['id']}",
        limit=20,
        window_seconds=10 * 60,
        error_message="Too many moderation actions. Try again later.",
        code="moderation_rate_limited",
    )
    server = await db.servers.find_one({"id": server_id}, {"_id": 0, "owner_id": 1})
    if server and server.get("owner_id") == inp.user_id:
        raise HTTPException(400, "Cannot ban the server owner")
    await clear_voice_membership(inp.user_id, server_id=server_id, force_reason="banned")
    await db.server_members.update_one(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"is_banned": True, "ban_reason": inp.reason}},
    )
    ws_mgr.remove_server(inp.user_id, server_id)
    await log_audit(server_id, actor["id"], "member_ban", "user", inp.user_id, {"reason": inp.reason})
    payload = {"type": "member_banned", "server_id": server_id, "user_id": inp.user_id}
    await ws_mgr.broadcast_server(server_id, payload)
    await ws_mgr.send(inp.user_id, payload)
    return {"ok": True}


@router.post("/{server_id}/moderation/unban")
async def unban_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "ban_members"):
        raise HTTPException(403, "No permission")
    await enforce_fixed_window_rate_limit(
        db,
        scope="moderation.unban",
        key=f"{server_id}:{actor['id']}",
        limit=20,
        window_seconds=10 * 60,
        error_message="Too many moderation actions. Try again later.",
        code="moderation_rate_limited",
    )
    membership = await get_server_member(server_id, inp.user_id)
    if not membership or not membership.get("is_banned"):
        raise HTTPException(404, "Banned member not found")

    await db.server_members.update_one(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"is_banned": False, "ban_reason": ""}},
    )
    ws_mgr.add_server(inp.user_id, server_id)
    member_payload = await build_member_payload(server_id, inp.user_id)
    await log_audit(server_id, actor["id"], "member_unban", "user", inp.user_id, {})
    payload = {
        "type": "member_unbanned",
        "server_id": server_id,
        "user_id": inp.user_id,
        "member": member_payload,
    }
    await ws_mgr.broadcast_server(server_id, payload)
    await ws_mgr.send(inp.user_id, payload)
    return {"ok": True}


@router.post("/{server_id}/moderation/mute")
async def mute_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "mute_members"):
        raise HTTPException(403, "No permission")
    await enforce_fixed_window_rate_limit(
        db,
        scope="moderation.mute",
        key=f"{server_id}:{actor['id']}",
        limit=40,
        window_seconds=10 * 60,
        error_message="Too many moderation actions. Try again later.",
        code="moderation_rate_limited",
    )
    muted_until = (datetime.now(timezone.utc) + timedelta(minutes=inp.duration_minutes or 10)).isoformat()
    await db.server_members.update_one(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"muted_until": muted_until}},
    )
    await log_audit(
        server_id,
        actor["id"],
        "member_mute",
        "user",
        inp.user_id,
        {"duration": inp.duration_minutes},
    )
    return {"ok": True}


@router.post("/{server_id}/moderation/unmute")
async def unmute_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "mute_members"):
        raise HTTPException(403, "No permission")
    await enforce_fixed_window_rate_limit(
        db,
        scope="moderation.unmute",
        key=f"{server_id}:{actor['id']}",
        limit=40,
        window_seconds=10 * 60,
        error_message="Too many moderation actions. Try again later.",
        code="moderation_rate_limited",
    )
    await db.server_members.update_one(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"muted_until": None}},
    )
    return {"ok": True}


@router.post("/{server_id}/moderation/deafen")
async def deafen_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "deafen_members"):
        raise HTTPException(403, "No permission")
    await enforce_fixed_window_rate_limit(
        db,
        scope="moderation.deafen",
        key=f"{server_id}:{actor['id']}",
        limit=40,
        window_seconds=10 * 60,
        error_message="Too many moderation actions. Try again later.",
        code="moderation_rate_limited",
    )

    await db.voice_states.update_many(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"is_deafened": True}},
    )
    updated_states = await db.voice_states.find(
        {"server_id": server_id, "user_id": inp.user_id},
        {"_id": 0},
    ).to_list(20)
    for state in updated_states:
        await ws_mgr.broadcast_server(
            server_id,
            {
                "type": "voice_state_update",
                "channel_id": state["channel_id"],
                "user_id": inp.user_id,
                "state": state,
            },
        )
    await log_audit(server_id, actor["id"], "member_deafen", "user", inp.user_id, {})
    return {"ok": True}


@router.post("/{server_id}/moderation/undeafen")
async def undeafen_member(server_id: str, inp: ModerationInput, request: Request):
    actor = await current_user(request)
    if not await check_permission(actor["id"], server_id, "deafen_members"):
        raise HTTPException(403, "No permission")
    await enforce_fixed_window_rate_limit(
        db,
        scope="moderation.undeafen",
        key=f"{server_id}:{actor['id']}",
        limit=40,
        window_seconds=10 * 60,
        error_message="Too many moderation actions. Try again later.",
        code="moderation_rate_limited",
    )

    await db.voice_states.update_many(
        {"server_id": server_id, "user_id": inp.user_id},
        {"$set": {"is_deafened": False}},
    )
    updated_states = await db.voice_states.find(
        {"server_id": server_id, "user_id": inp.user_id},
        {"_id": 0},
    ).to_list(20)
    for state in updated_states:
        await ws_mgr.broadcast_server(
            server_id,
            {
                "type": "voice_state_update",
                "channel_id": state["channel_id"],
                "user_id": inp.user_id,
                "state": state,
            },
        )
    await log_audit(server_id, actor["id"], "member_undeafen", "user", inp.user_id, {})
    return {"ok": True}


@router.get("/{server_id}/moderation/audit-log")
async def get_audit_log(server_id: str, request: Request):
    user = await current_user(request)
    if not await check_permission(user["id"], server_id, "manage_server"):
        raise HTTPException(403, "No permission")
    logs = await db.audit_log.find({"server_id": server_id}, {"_id": 0}).sort("created_at", -1).to_list(100)
    for log_entry in logs:
        actor = await db.users.find_one(
            {"id": log_entry.get("actor_id")},
            {"_id": 0, "password_hash": 0},
        )
        log_entry["actor"] = sanitize_user(actor) if actor else None
        if log_entry.get("encrypted_at_rest") and log_entry.get("details"):
            try:
                decrypted = decrypt_metadata(f"audit:{server_id}", log_entry["details"])
                log_entry["details"] = json.loads(decrypted)
            except Exception:
                log_entry["details"] = {}
    return logs
