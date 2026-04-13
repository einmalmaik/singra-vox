from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response as RawResponse

from app.blob_storage import get_blob, put_blob
from app.core.constants import E2EE_PROTOCOL_VERSION
from app.core.database import db
from app.core.utils import new_id, now_utc
from app.dependencies import current_user, request_device_id, require_verified_device
from app.permissions import assert_channel_permission
from app.schemas import (
    E2EEBootstrapInput,
    E2EEDeviceInput,
    EncryptedBlobContentInput,
    EncryptedBlobInitInput,
    EncryptedMediaKeyInput,
)
from app.services.e2ee import (
    authorize_blob_access,
    build_e2ee_recipient_payload,
    build_e2ee_state,
    decode_base64_bytes,
    ensure_private_channel_member_access,
    get_device_record,
    get_e2ee_account,
    list_active_voice_participant_user_ids,
    list_channel_recipient_user_ids,
    list_group_recipient_user_ids,
)


router = APIRouter(prefix="/api/e2ee", tags=["E2EE"])


@router.get("/state")
async def get_e2ee_state(request: Request):
    user = await current_user(request)
    return await build_e2ee_state(user["id"], request_device_id(request))


@router.get("/recovery/account")
async def get_recovery_bundle(request: Request):
    user = await current_user(request)
    account = await get_e2ee_account(user["id"])
    if not account:
        raise HTTPException(404, "End-to-end encryption is not configured for this account")
    return {
        "enabled": True,
        "recovery_public_key": account.get("recovery_public_key"),
        "encrypted_recovery_private_key": account.get("encrypted_recovery_private_key"),
        "recovery_salt": account.get("recovery_salt"),
        "recovery_nonce": account.get("recovery_nonce"),
        "protocol_version": account.get("protocol_version", E2EE_PROTOCOL_VERSION),
    }


@router.post("/bootstrap")
async def bootstrap_e2ee(inp: E2EEBootstrapInput, request: Request):
    user = await current_user(request)
    existing_account = await get_e2ee_account(user["id"])
    if existing_account:
        raise HTTPException(409, "End-to-end encryption is already configured for this account")

    header_device_id = request_device_id(request)
    if header_device_id and header_device_id != inp.device_id:
        raise HTTPException(400, "Desktop device id header does not match the bootstrap payload")

    created_at = now_utc()
    account_doc = {
        "id": new_id(),
        "user_id": user["id"],
        "protocol_version": E2EE_PROTOCOL_VERSION,
        "recovery_public_key": inp.recovery_public_key,
        "encrypted_recovery_private_key": inp.encrypted_recovery_private_key,
        "recovery_salt": inp.recovery_salt,
        "recovery_nonce": inp.recovery_nonce,
        "created_at": created_at,
        "updated_at": created_at,
    }
    device_doc = {
        "id": new_id(),
        "user_id": user["id"],
        "device_id": inp.device_id,
        "device_name": inp.device_name,
        "public_key": inp.device_public_key,
        "verified_at": created_at,
        "verified_by_device_id": inp.device_id,
        "revoked_at": None,
        "created_at": created_at,
        "last_seen": created_at,
    }
    await db.e2ee_accounts.insert_one(account_doc)
    await db.e2ee_devices.insert_one(device_doc)
    return await build_e2ee_state(user["id"], inp.device_id)


@router.post("/devices")
async def register_e2ee_device(inp: E2EEDeviceInput, request: Request):
    user = await current_user(request)
    account = await get_e2ee_account(user["id"])
    if not account:
        raise HTTPException(409, "Configure end-to-end encryption first (Settings > Privacy)")

    existing = await get_device_record(user["id"], inp.device_id)
    created_at = now_utc()
    if existing:
        if existing.get("revoked_at"):
            raise HTTPException(409, "This device was revoked and cannot be reused")
        await db.e2ee_devices.update_one(
            {"user_id": user["id"], "device_id": inp.device_id},
            {"$set": {"device_name": inp.device_name, "public_key": inp.device_public_key, "last_seen": created_at}},
        )
    else:
        await db.e2ee_devices.insert_one(
            {
                "id": new_id(),
                "user_id": user["id"],
                "device_id": inp.device_id,
                "device_name": inp.device_name,
                "public_key": inp.device_public_key,
                "verified_at": None,
                "verified_by_device_id": None,
                "revoked_at": None,
                "created_at": created_at,
                "last_seen": created_at,
            }
        )

    return await build_e2ee_state(user["id"], inp.device_id)


@router.post("/devices/{device_id}/approve")
async def approve_e2ee_device(device_id: str, request: Request):
    user = await current_user(request)
    actor_device = await require_verified_device(request, user)
    target = await get_device_record(user["id"], device_id)
    if not target:
        raise HTTPException(404, "Device not found")
    if target.get("revoked_at"):
        raise HTTPException(409, "Revoked devices cannot be approved")
    if target["device_id"] == actor_device["device_id"]:
        raise HTTPException(400, "This device is already trusted")

    verified_at = now_utc()
    await db.e2ee_devices.update_one(
        {"user_id": user["id"], "device_id": device_id},
        {"$set": {"verified_at": verified_at, "verified_by_device_id": actor_device["device_id"], "last_seen": verified_at}},
    )
    return await build_e2ee_state(user["id"], request_device_id(request))


@router.post("/devices/{device_id}/verify-recovery")
async def verify_device_via_recovery(device_id: str, request: Request):
    user = await current_user(request)
    target = await get_device_record(user["id"], device_id)
    if not target:
        raise HTTPException(404, "Device not found")
    if target.get("revoked_at"):
        raise HTTPException(409, "Revoked devices cannot be recovered")
    verified_at = now_utc()
    await db.e2ee_devices.update_one(
        {"user_id": user["id"], "device_id": device_id},
        {"$set": {"verified_at": verified_at, "verified_by_device_id": "recovery", "last_seen": verified_at}},
    )
    return await build_e2ee_state(user["id"], device_id)


@router.post("/devices/{device_id}/revoke")
async def revoke_e2ee_device(device_id: str, request: Request):
    user = await current_user(request)
    actor_device = await require_verified_device(request, user)
    target = await get_device_record(user["id"], device_id)
    if not target:
        raise HTTPException(404, "Device not found")
    if target["device_id"] == actor_device["device_id"]:
        raise HTTPException(400, "Revoke this device from another trusted device")
    await db.e2ee_devices.update_one(
        {"user_id": user["id"], "device_id": device_id},
        {"$set": {"revoked_at": now_utc()}},
    )
    return await build_e2ee_state(user["id"], actor_device["device_id"])


@router.get("/dm/{other_user_id}/recipients")
async def dm_recipients(other_user_id: str, request: Request):
    user = await current_user(request)
    other = await db.users.find_one({"id": other_user_id}, {"_id": 0, "id": 1})
    if not other:
        raise HTTPException(404, "User not found")
    return await build_e2ee_recipient_payload([user["id"], other_user_id])


@router.get("/groups/{group_id}/recipients")
async def group_recipients(group_id: str, request: Request):
    user = await current_user(request)
    recipients = await list_group_recipient_user_ids(group_id)
    if user["id"] not in recipients:
        raise HTTPException(403, "No access to this group conversation")
    return await build_e2ee_recipient_payload(recipients)


@router.get("/channels/{channel_id}/recipients")
async def channel_recipients(channel_id: str, request: Request):
    user = await current_user(request)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not channel.get("is_private"):
        raise HTTPException(400, "Only private channels use the end-to-end recipient API")
    await assert_channel_permission(db, user["id"], channel, "read_messages", "No permission")
    await ensure_private_channel_member_access(user["id"], channel)
    recipients = await list_channel_recipient_user_ids(channel)
    return await build_e2ee_recipient_payload(recipients)


@router.post("/blobs/init")
async def init_encrypted_blob(inp: EncryptedBlobInitInput, request: Request):
    user = await current_user(request)
    device = await require_verified_device(request, user)
    scope_kind = (inp.scope_kind or "").strip().lower()
    participant_user_ids = sorted(set(inp.participant_user_ids or []))

    if scope_kind == "dm":
        if user["id"] not in participant_user_ids or len(participant_user_ids) != 2:
            raise HTTPException(400, "Encrypted DM uploads require both DM participants")
    elif scope_kind == "group":
        group_users = sorted(await list_group_recipient_user_ids(inp.scope_id))
        if participant_user_ids != group_users:
            raise HTTPException(400, "Encrypted group upload recipients do not match the group members")
    elif scope_kind == "channel":
        channel = await db.channels.find_one({"id": inp.scope_id}, {"_id": 0})
        if not channel:
            raise HTTPException(404, "Channel not found")
        if not channel.get("is_private"):
            raise HTTPException(400, "Only private channels support encrypted blob uploads")
        allowed_users = sorted(await list_channel_recipient_user_ids(channel))
        if sorted(participant_user_ids) != allowed_users:
            raise HTTPException(400, "Encrypted channel upload recipients do not match the channel audience")
    else:
        raise HTTPException(400, "Unsupported encrypted blob scope")

    upload_id = new_id()
    object_key = f"ciphertext/{scope_kind}/{inp.scope_id}/{upload_id}"
    await db.e2ee_blob_uploads.insert_one(
        {
            "id": upload_id,
            "user_id": user["id"],
            "device_id": device["device_id"],
            "scope_kind": scope_kind,
            "scope_id": inp.scope_id,
            "participant_user_ids": participant_user_ids,
            "object_key": object_key,
            "status": "pending",
            "created_at": now_utc(),
        }
    )
    return {"upload_id": upload_id, "protocol_version": E2EE_PROTOCOL_VERSION}


@router.put("/blobs/{upload_id}/content")
async def upload_encrypted_blob_content(upload_id: str, inp: EncryptedBlobContentInput, request: Request):
    user = await current_user(request)
    await require_verified_device(request, user)
    upload = await db.e2ee_blob_uploads.find_one({"id": upload_id, "user_id": user["id"]}, {"_id": 0})
    if not upload or upload.get("status") != "pending":
        raise HTTPException(404, "Encrypted upload not found")

    ciphertext = decode_base64_bytes(inp.ciphertext_b64, field_name="ciphertext_b64")
    if len(ciphertext) != inp.size_bytes:
        raise HTTPException(400, "Encrypted blob size does not match the declared ciphertext size")
    await put_blob(object_key=upload["object_key"], data=ciphertext, content_type=inp.content_type)
    await db.e2ee_blob_uploads.update_one(
        {"id": upload_id},
        {
            "$set": {
                "status": "uploaded",
                "sha256": inp.sha256,
                "size_bytes": inp.size_bytes,
                "content_type": inp.content_type,
                "uploaded_at": now_utc(),
            }
        },
    )
    return {"ok": True}


@router.post("/blobs/{upload_id}/complete")
async def finalize_encrypted_blob(upload_id: str, request: Request):
    user = await current_user(request)
    device = await require_verified_device(request, user)
    upload = await db.e2ee_blob_uploads.find_one({"id": upload_id, "user_id": user["id"]}, {"_id": 0})
    if not upload or upload.get("status") != "uploaded":
        raise HTTPException(404, "Encrypted upload is not ready to finalize")

    blob_id = new_id()
    blob_record = {
        "id": blob_id,
        "scope_kind": upload["scope_kind"],
        "scope_id": upload["scope_id"],
        "participant_user_ids": upload.get("participant_user_ids") or [],
        "object_key": upload["object_key"],
        "sha256": upload.get("sha256"),
        "size_bytes": upload.get("size_bytes"),
        "content_type": upload.get("content_type", "application/octet-stream"),
        "uploader_user_id": user["id"],
        "uploaded_by_device_id": device["device_id"],
        "created_at": now_utc(),
    }
    await db.e2ee_blobs.insert_one(blob_record)
    await db.e2ee_blob_uploads.delete_one({"id": upload_id})
    return {
        "id": blob_id,
        "size_bytes": blob_record["size_bytes"],
        "content_type": blob_record["content_type"],
        "url": f"/api/e2ee/blobs/{blob_id}",
    }


@router.get("/blobs/{blob_id}")
async def fetch_encrypted_blob(blob_id: str, request: Request):
    user = await current_user(request)
    blob_record = await db.e2ee_blobs.find_one({"id": blob_id}, {"_id": 0})
    if not blob_record:
        raise HTTPException(404, "Encrypted attachment not found")
    await authorize_blob_access(user, blob_record)
    blob_bytes = await get_blob(object_key=blob_record["object_key"])
    return RawResponse(content=blob_bytes, media_type=blob_record.get("content_type", "application/octet-stream"))


@router.get("/media/channels/{channel_id}/current")
async def get_current_media_key(channel_id: str, request: Request):
    user = await current_user(request)
    device = await require_verified_device(request, user)
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not channel.get("is_private") or channel.get("type") != "voice":
        raise HTTPException(400, "Only private voice channels use encrypted media keys")
    await assert_channel_permission(db, user["id"], channel, "join_voice", "No permission")
    await ensure_private_channel_member_access(user["id"], channel)
    active_voice_user_ids = await list_active_voice_participant_user_ids(channel_id)
    if user["id"] not in active_voice_user_ids:
        raise HTTPException(403, "You are not an active participant in this encrypted voice channel")

    media_key = await db.e2ee_media_keys.find_one(
        {"channel_id": channel_id},
        {"_id": 0},
        sort=[("created_at", -1)],
    )
    if not media_key:
        return {"key_package": None}

    matching_envelopes = [
        envelope
        for envelope in media_key.get("key_envelopes", [])
        if envelope.get("recipient_device_id") == device["device_id"]
    ]
    return {"key_package": {**media_key, "key_envelopes": matching_envelopes}}


@router.post("/media/channels/{channel_id}/rotate")
async def rotate_media_key(channel_id: str, inp: EncryptedMediaKeyInput, request: Request):
    user = await current_user(request)
    device = await require_verified_device(request, user)
    if inp.sender_device_id != device["device_id"]:
        raise HTTPException(400, "Encrypted media payload must originate from the current desktop device")
    channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
    if not channel:
        raise HTTPException(404, "Channel not found")
    if not channel.get("is_private") or channel.get("type") != "voice":
        raise HTTPException(400, "Only private voice channels use encrypted media keys")
    await assert_channel_permission(db, user["id"], channel, "join_voice", "No permission")
    await ensure_private_channel_member_access(user["id"], channel)

    participant_user_ids = sorted({participant_id for participant_id in (inp.participant_user_ids or []) if participant_id})
    active_voice_user_ids = await list_active_voice_participant_user_ids(channel_id)
    if participant_user_ids != active_voice_user_ids:
        raise HTTPException(400, "Encrypted media rotation recipients must match the active voice participants")
    if user["id"] not in participant_user_ids:
        raise HTTPException(400, "Encrypted media rotation must include the rotating participant")

    record = {
        "id": new_id(),
        "channel_id": channel_id,
        "sender_user_id": user["id"],
        "sender_device_id": inp.sender_device_id,
        "key_version": inp.key_version,
        "participant_user_ids": participant_user_ids,
        "key_envelopes": inp.key_envelopes,
        "created_at": now_utc(),
    }
    await db.e2ee_media_keys.insert_one(record)
    return {"ok": True, "key_package": {**record, "_id": None}}
