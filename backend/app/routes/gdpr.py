# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox – GDPR / privacy routes
======================================
Implements the right to data portability (DSGVO Art. 15 & 20) and the
right to erasure (DSGVO Art. 17).

Privacy-first design
--------------------
* Data export returns the minimum fields needed to be useful.
* Account deletion anonymises messages instead of deleting them so that
  conversation threads remain coherent for other participants.
* E2EE keys and push subscriptions are deleted entirely.

Routes
------
    GET    /api/users/me/export     → JSON data package (DSGVO Art. 20)
    DELETE /api/users/me            → Account deletion  (DSGVO Art. 17)
"""
from __future__ import annotations

from fastapi import APIRouter, Request

from app.auth_service import load_current_user
from app.core.database import db
from app.core.utils import now_utc
from app.core.encryption import (
    decrypt_channel_content,
    decrypt_dm_content,
    decrypt_group_content,
    decrypt_metadata,
)

router = APIRouter(prefix="/api", tags=["gdpr"])


async def _current_user(request: Request) -> dict:
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/users/me/export")
async def export_user_data(request: Request) -> dict:
    """Return a machine-readable export of all data the server holds for the
    requesting user (DSGVO Art. 15 / Art. 20 – right to portability)."""
    user = await _current_user(request)
    uid = user["id"]

    profile = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})

    messages = await db.messages.find(
        {"author_id": uid, "is_deleted": {"$ne": True}}, {"_id": 0}
    ).to_list(10_000)
    # Entschlüsseln für Export
    for msg in messages:
        if msg.get("encrypted_at_rest") and not msg.get("is_e2ee") and msg.get("channel_id"):
            msg["content"] = decrypt_channel_content(msg["channel_id"], msg.get("content", ""))

    dms_sent = await db.direct_messages.find({"sender_id": uid}, {"_id": 0}).to_list(10_000)
    dms_received = await db.direct_messages.find({"receiver_id": uid}, {"_id": 0}).to_list(10_000)
    # DMs entschlüsseln
    for dm in dms_sent + dms_received:
        if dm.get("encrypted_at_rest") and not dm.get("is_encrypted"):
            other = dm.get("receiver_id") if dm.get("sender_id") == uid else dm.get("sender_id")
            dm["content"] = decrypt_dm_content(uid, other, dm.get("content", ""))

    memberships = await db.server_members.find({"user_id": uid}, {"_id": 0}).to_list(100)
    for m in memberships:
        srv = await db.servers.find_one({"id": m["server_id"]}, {"_id": 0, "name": 1})
        m["server_name"] = srv["name"] if srv else "?"

    group_conversations = await db.group_conversations.find(
        {"members": uid}, {"_id": 0}
    ).to_list(100)
    group_messages = await db.group_messages.find(
        {"sender_id": uid}, {"_id": 0}
    ).to_list(10_000)
    # Gruppen-Nachrichten entschlüsseln
    for gm in group_messages:
        if gm.get("encrypted_at_rest") and not gm.get("is_encrypted") and gm.get("group_id"):
            gm["content"] = decrypt_group_content(gm["group_id"], gm.get("content", ""))

    read_states = await db.read_states.find({"user_id": uid}, {"_id": 0}).to_list(500)

    # File metadata only – not the binary content (to keep response manageable)
    files = await db.files.find(
        {"uploaded_by": uid}, {"_id": 0, "original_name": 1, "content_type": 1, "size_bytes": 1, "created_at": 1, "id": 1, "encrypted_at_rest": 1}
    ).to_list(500)
    # Datei-Metadaten entschlüsseln
    for f in files:
        if f.get("encrypted_at_rest"):
            f["original_name"] = decrypt_metadata(f"file_meta:{f['id']}", f.get("original_name", ""))
            f["content_type"] = decrypt_metadata(f"file_ct:{f['id']}", f.get("content_type", ""))
        f.pop("encrypted_at_rest", None)

    return {
        "export_date": now_utc(),
        "profile": profile,
        "server_memberships": memberships,
        "channel_messages": messages,
        "direct_messages_sent": dms_sent,
        "direct_messages_received": dms_received,
        "group_conversations": group_conversations,
        "group_messages_sent": group_messages,
        "read_states": read_states,
        "files": files,
        "_note": "File binary content excluded. Retrieve individual files via GET /api/files/{id}.",
    }


@router.delete("/users/me")
async def delete_account(request: Request) -> dict:
    """Permanently delete the current user's account.

    Deletion policy (DSGVO Art. 17)
    --------------------------------
    * Profile: deleted.
    * Channel messages: author anonymised, content cleared.
    * Direct messages: deleted in full (privacy of conversation partner).
    * Server memberships: removed.
    * Voice / read / session state: deleted.
    * E2EE keys & devices: deleted.
    * Uploaded files: deleted from disk and database.
    * Group conversations: user removed from member list.
    * Audit log entries: actor_id anonymised.
    """
    user = await _current_user(request)
    uid = user["id"]

    # 1. Anonymise channel messages
    await db.messages.update_many(
        {"author_id": uid},
        {"$set": {"author_id": "[deleted]", "content": "[account deleted]", "is_deleted": True, "attachments": []}},
    )

    # 2. Remove direct messages in both directions
    await db.direct_messages.delete_many({"$or": [{"sender_id": uid}, {"receiver_id": uid}]})

    # 3. Remove server memberships
    await db.server_members.delete_many({"user_id": uid})

    # 4. Clean up voice, read, and revision data
    await db.voice_states.delete_many({"user_id": uid})
    await db.read_states.delete_many({"user_id": uid})
    await db.message_revisions.update_many(
        {"editor_id": uid}, {"$set": {"editor_id": "[deleted]"}}
    )

    # 5. Remove all E2EE keys and sessions
    for coll in ("key_bundles", "e2ee_accounts", "e2ee_devices", "e2ee_blob_uploads", "e2ee_blobs"):
        await db[coll].delete_many({"user_id": uid})

    # 6. Delete uploaded files (metadata + disk)
    import pathlib
    import os
    upload_root = pathlib.Path(os.environ.get("UPLOAD_ROOT", "/app/backend/storage/uploads"))
    file_records = await db.files.find({"uploaded_by": uid}, {"_id": 0}).to_list(500)
    for rec in file_records:
        month = rec.get("created_at", "")[:7]
        path = upload_root / month / rec["id"]
        if path.exists():
            path.unlink()
    await db.files.delete_many({"uploaded_by": uid})

    # Legacy base64-in-DB file uploads (from before local-FS storage)
    await db.file_uploads.delete_many({"user_id": uid})
    await db.email_verifications.delete_many({"user_id": uid})

    # 7. Remove from group conversations
    await db.group_conversations.update_many({"members": uid}, {"$pull": {"members": uid}})
    await db.group_messages.update_many(
        {"sender_id": uid},
        {"$set": {"sender_id": "[deleted]", "content": "[account deleted]"}},
    )

    # 8. Anonymise audit log entries
    await db.audit_log.update_many({"actor_id": uid}, {"$set": {"actor_id": "[deleted]"}})

    # 9. Delete login-attempt records tied to this account
    if user.get("email"):
        await db.login_attempts.delete_many(
            {"identifier": {"$regex": user["email"]}}
        )

    # 10. Delete TOTP / 2FA secrets and backup codes
    await db.totp_secrets.delete_many({"user_id": uid})

    # 11. Delete sessions (auth_sessions is the actual collection name)
    await db.auth_sessions.delete_many({"user_id": uid})

    # 12. Delete push notification subscriptions
    await db.push_subscriptions.delete_many({"user_id": uid})

    # 13. Delete notifications
    await db.notifications.delete_many({"user_id": uid})

    # 14. Delete SVID-related data (cross-instance links)
    await db.svid_links.delete_many({"user_id": uid})
    await db.svid_email_codes.delete_many({"user_id": uid})
    await db.svid_invites.delete_many({"$or": [{"from_user_id": uid}, {"to_user_id": uid}]})

    # 15. Delete status history
    await db.status_history.delete_many({"user_id": uid})

    # 16. Delete password reset tokens
    await db.password_resets.delete_many({"user_id": uid})

    # 16b. Delete rate limit records tied to this user's email
    if user.get("email"):
        await db.rate_limits.delete_many(
            {"key": {"$regex": user["email"]}}
        )

    # 17. Delete the user record itself (MUST be last)
    await db.users.delete_one({"id": uid})

    # 18. Send account deletion confirmation email (non-critical)
    try:
        from app.email_templates import render_security_alert_email
        from app.emailing import send_email
        email = user.get("email", "")
        if email:
            subj, txt, htm = render_security_alert_email(
                app_name="Singra Vox",
                instance_name="",
                alert_type="Account deleted",
                details="Your Singra Vox account has been permanently deleted. All data has been removed from our servers.",
            )
            await send_email(to_email=email, subject=subj, text_body=txt, html_body=htm)
    except Exception:
        pass  # Non-critical

    return {
        "ok": True,
        "deleted": {
            "profile": True,
            "messages": "anonymised",
            "direct_messages": "deleted",
            "memberships": "removed",
            "voice_states": "deleted",
            "e2ee_keys": "deleted",
            "files": "deleted",
            "totp_2fa": "deleted",
            "sessions": "deleted",
            "push_subscriptions": "deleted",
            "notifications": "deleted",
            "svid_links": "deleted",
            "status_history": "deleted",
            "rate_limits": "deleted",
            "audit_log": "anonymised",
        },
    }
