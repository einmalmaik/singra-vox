from __future__ import annotations

import logging

from fastapi import FastAPI

from app.blob_storage import ensure_bucket
from app.core.config import ADMIN_ROLE, APP_NAME, INSTANCE_SETTINGS_ID, MEMORY_DIR, OWNER_ROLE, USER_ROLE
from app.core.database import close as close_database
from app.core.database import db
from app.core.utils import now_utc
from app.permissions import DEFAULT_PERMISSIONS


logger = logging.getLogger(__name__)


async def migrate_legacy_instance_state() -> None:
    settings = await db.instance_settings.find_one({"id": INSTANCE_SETTINGS_ID}, {"_id": 0})
    if settings:
        return

    legacy_users = await db.users.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    if not legacy_users:
        return

    owner = next((user for user in legacy_users if user.get("role") in {OWNER_ROLE, ADMIN_ROLE}), legacy_users[0])
    await db.instance_settings.insert_one(
        {
            "id": INSTANCE_SETTINGS_ID,
            "initialized": True,
            "instance_name": APP_NAME,
            "owner_user_id": owner["id"],
            "allow_open_signup": True,
            "created_at": owner.get("created_at", now_utc()),
            "setup_completed_at": now_utc(),
            "migrated_from_legacy": True,
        }
    )
    for legacy_user in legacy_users:
        instance_role = USER_ROLE
        if legacy_user["id"] == owner["id"]:
            instance_role = OWNER_ROLE
        elif legacy_user.get("role") == ADMIN_ROLE:
            instance_role = ADMIN_ROLE
        await db.users.update_one(
            {"id": legacy_user["id"]},
            {"$set": {"instance_role": instance_role, "role": instance_role}},
        )
    logger.info("Migrated legacy instance state into instance_settings")


async def migrate_default_roles() -> None:
    default_roles = await db.roles.find({"is_default": True}, {"_id": 0}).to_list(500)
    for role in default_roles:
        await db.roles.update_one(
            {"id": role["id"]},
            {
                "$set": {
                    "name": "@everyone",
                    "mentionable": False,
                    "permissions": {**DEFAULT_PERMISSIONS, **(role.get("permissions") or {})},
                }
            },
        )
        await db.server_members.update_many(
            {"server_id": role["server_id"], "roles": role["id"]},
            {"$pull": {"roles": role["id"]}},
        )
    if default_roles:
        logger.info("Normalized default roles to @everyone")


async def migrate_email_verification_state() -> None:
    result = await db.users.update_many(
        {"email_verified": {"$exists": False}},
        {"$set": {"email_verified": True, "email_verified_at": now_utc()}},
    )
    if result.modified_count:
        logger.info("Marked %s legacy users as email verified", result.modified_count)


async def migrate_role_hoist_state() -> None:
    result = await db.roles.update_many(
        {"hoist": {"$exists": False}},
        {"$set": {"hoist": False}},
    )
    if result.modified_count:
        logger.info("Backfilled hoist=false for %s legacy roles", result.modified_count)


def register_lifecycle_handlers(app: FastAPI) -> None:
    @app.on_event("startup")
    async def startup() -> None:
        await db.users.create_index("email", unique=True)
        await db.users.create_index("username")
        await db.users.create_index("id", unique=True)
        await db.users.create_index("instance_role")
        await db.instance_settings.create_index("id", unique=True)
        await db.servers.create_index("id", unique=True)
        await db.channels.create_index("id", unique=True)
        await db.channels.create_index("server_id")
        await db.messages.create_index("id", unique=True)
        await db.messages.create_index([("channel_id", 1), ("created_at", -1)])
        await db.direct_messages.create_index("id", unique=True)
        await db.direct_messages.create_index([("sender_id", 1), ("receiver_id", 1), ("created_at", -1)])
        await db.server_members.create_index([("server_id", 1), ("user_id", 1)], unique=True)
        await db.roles.create_index("id", unique=True)
        await db.invites.create_index("code", unique=True)
        await db.email_verifications.create_index([("user_id", 1), ("purpose", 1)], unique=True)
        await db.email_verifications.create_index("expires_at")
        await db.voice_states.create_index("user_id")
        await db.audit_log.create_index([("server_id", 1), ("created_at", -1)])
        await db.auth_sessions.create_index("session_id", unique=True)
        await db.auth_sessions.create_index([("user_id", 1), ("issued_at", -1)])
        await db.auth_sessions.create_index("refresh_token_hash", unique=True)
        await db.auth_sessions.create_index("expires_at")
        await db.rate_limits.create_index([("scope", 1), ("key_hash", 1), ("window_id", 1)], unique=True)
        await db.rate_limits.create_index("expires_at")
        await db.e2ee_accounts.create_index("user_id", unique=True)
        await db.e2ee_devices.create_index([("user_id", 1), ("device_id", 1)], unique=True)
        await db.e2ee_devices.create_index([("user_id", 1), ("verified_at", 1), ("revoked_at", 1)])
        await db.e2ee_blob_uploads.create_index("id", unique=True)
        await db.e2ee_blobs.create_index("id", unique=True)
        await db.e2ee_blobs.create_index([("scope_kind", 1), ("scope_id", 1), ("created_at", -1)])
        await db.e2ee_media_keys.create_index([("channel_id", 1), ("created_at", -1)])
        await db.push_subscriptions.create_index([("user_id", 1), ("subscription.endpoint", 1)], unique=True)
        await db.status_history.create_index([("user_id", 1), ("created_at", -1)])
        await db.read_states.create_index([("user_id", 1), ("channel_id", 1)], unique=True)
        await db.message_revisions.create_index("message_id")
        await db.channel_overrides.create_index([("channel_id", 1), ("target_type", 1), ("target_id", 1)])
        await db.channel_access.create_index("channel_id")
        await db.group_conversations.create_index("id", unique=True)
        await db.group_messages.create_index([("group_id", 1), ("created_at", -1)])
        await db.key_bundles.create_index("user_id", unique=True)
        await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
        await db.notifications.create_index("id", unique=True)
        await db.server_emojis.create_index([("server_id", 1), ("name", 1)], unique=True)
        await db.server_emojis.create_index("id", unique=True)
        await db.webhooks.create_index("id", unique=True)
        await db.webhooks.create_index("token", unique=True)
        await db.webhook_logs.create_index([("webhook_id", 1), ("created_at", -1)])
        await db.bot_tokens.create_index("id", unique=True)
        await db.bot_tokens.create_index("token", unique=True)
        await db.files.create_index("id", unique=True)
        await db.files.create_index([("uploaded_by", 1), ("created_at", -1)])

        try:
            await ensure_bucket()
        except Exception as exc:  # noqa: BLE001
            logger.warning("S3/MinIO Bucket-Initialisierung fehlgeschlagen (E2EE-Blobs deaktiviert): %s", exc)

        await migrate_legacy_instance_state()
        await migrate_default_roles()
        await migrate_email_verification_state()
        await migrate_role_hoist_state()

        MEMORY_DIR.mkdir(parents=True, exist_ok=True)
        with open(MEMORY_DIR / "test_credentials.md", "w", encoding="utf-8") as handle:
            handle.write("# Singra Vox Setup\n\n")
            handle.write("- Open `/setup` on the instance after the first start.\n")
            handle.write("- The first admin is created through the setup wizard.\n\n")
            handle.write("## Auth Endpoints\n")
            handle.write("- POST /api/setup/bootstrap\n")
            handle.write("- POST /api/auth/register\n")
            handle.write("- POST /api/auth/verify-email\n")
            handle.write("- POST /api/auth/resend-verification\n")
            handle.write("- POST /api/auth/forgot-password\n")
            handle.write("- POST /api/auth/reset-password\n")
            handle.write("- POST /api/auth/login\n")
            handle.write("- POST /api/auth/logout\n")
            handle.write("- POST /api/auth/logout-all\n")
            handle.write("- GET /api/auth/me\n")
            handle.write("- GET /api/auth/sessions\n")
            handle.write("- DELETE /api/auth/sessions/{id}\n")
            handle.write("- POST /api/auth/refresh\n")

        logger.info("Singra Vox backend started")

    @app.on_event("shutdown")
    async def shutdown() -> None:
        close_database()
