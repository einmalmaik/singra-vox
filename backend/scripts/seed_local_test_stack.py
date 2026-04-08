from __future__ import annotations

"""
Seed deterministic local fixtures for the Docker-based integration stack.

Several legacy integration suites assume concrete credentials and object ids.
The production-like Docker stack intentionally boots only infrastructure, so
this script provides the missing test baseline in a reusable way instead of
relying on ad hoc manual Mongo edits.
"""

import os
import sys
import uuid
from dataclasses import dataclass
from pathlib import Path

from pymongo import MongoClient


REPO_BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_BACKEND_ROOT))

from app.core.utils import now_utc  # noqa: E402
from app.permissions import DEFAULT_PERMISSIONS  # noqa: E402
from app.services.auth_flow import hash_pw  # noqa: E402


MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "singravox_v1_e2e")

MAIN_SERVER_ID = "03778528-7e75-4ddc-83df-f06260323967"
MAIN_TEXT_CHANNEL_ID = "bee73bda-4936-48b2-afa0-a2745ba53d26"
MAIN_VOICE_CHANNEL_ID = "79f4729e-d2f7-4f88-87e1-d5cda81d5b6b"
ALT_VOICE_CHANNEL_ID = "d0f0765a-35e1-4d3e-9acb-9f1ec22c0213"

ADMIN_ID = "56e4b9c8-184f-4c15-a9bd-5dcb625c5545"
TESTUSER_ID = "8b5675a4-33a9-47f4-a6de-e1e64411c6b7"
MAUNTING_ADMIN_ID = "76fd3ee2-3305-48d6-94aa-8c814f87f34a"

MAIN_ADMIN_ROLE_ID = "3f17a15a-2458-44ca-8a1a-d916c07850af"
MAIN_EVERYONE_ROLE_ID = "42d90595-9448-4b2f-aa8f-ae70305f5f63"
ADMIN_E2EE_ACCOUNT_ID = "4420f545-eb03-4af6-a924-bd6618a3fced"
ADMIN_E2EE_DEVICE_DOC_ID = "af2179eb-2722-4760-ae75-d7d98175429f"
ADMIN_E2EE_DEVICE_ID = "seed-admin-local-desktop"

AUX_SERVER_COUNT = 12


@dataclass(frozen=True)
class SeedUser:
    user_id: str
    email: str
    username: str
    display_name: str
    password: str


USERS = (
    SeedUser(
        user_id=ADMIN_ID,
        email="admin@singravox.local",
        username="admin",
        display_name="Admin Local",
        password="Admin1234!",
    ),
    SeedUser(
        user_id=TESTUSER_ID,
        email="testuser@singravox.local",
        username="testuser",
        display_name="Test User",
        password="TestPass123!",
    ),
    SeedUser(
        user_id=MAUNTING_ADMIN_ID,
        email="admin@mauntingstudios.de",
        username="maunting_admin",
        display_name="Admin Maunting",
        password="Admin1234!",
    ),
)


def stable_id(label: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"singravox-localtest:{label}"))


def upsert_user(db, user: SeedUser) -> None:
    now = now_utc()
    conflict_filter = {
        "$or": [
            {"email": user.email, "id": {"$ne": user.user_id}},
            {"id": user.user_id, "email": {"$ne": user.email}},
            {"username": user.username, "id": {"$ne": user.user_id}},
        ]
    }
    conflicting_ids = [doc["id"] for doc in db.users.find(conflict_filter, {"_id": 0, "id": 1})]
    if conflicting_ids:
        db.users.delete_many({"id": {"$in": conflicting_ids}})
        db.auth_sessions.delete_many({"user_id": {"$in": conflicting_ids}})
        db.email_verifications.delete_many({"user_id": {"$in": conflicting_ids}})
        db.server_members.delete_many({"user_id": {"$in": conflicting_ids}})
        db.e2ee_accounts.delete_many({"user_id": {"$in": conflicting_ids}})
        db.e2ee_devices.delete_many({"user_id": {"$in": conflicting_ids}})

    db.users.update_one(
        {"id": user.user_id},
        {
            "$set": {
                "email": user.email,
                "username": user.username,
                "display_name": user.display_name,
                "password_hash": hash_pw(user.password),
                "avatar_url": "",
                "status": "offline",
                "public_key": "",
                "role": "user",
                "instance_role": "user",
                "email_verified": True,
                "email_verified_at": now,
                "last_seen": now,
            },
            "$setOnInsert": {
                "created_at": now,
            },
        },
        upsert=True,
    )


def upsert_role(db, *, role_id: str, server_id: str, name: str, permissions: dict, position: int, is_default: bool) -> None:
    now = now_utc()
    db.roles.update_one(
        {"id": role_id},
        {
            "$set": {
                "server_id": server_id,
                "name": name,
                "color": "#99AAB5" if is_default else "#E74C3C",
                "permissions": permissions,
                "position": position,
                "is_default": is_default,
                "mentionable": False,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )


def upsert_channel(
    db,
    *,
    channel_id: str,
    server_id: str,
    name: str,
    channel_type: str,
    topic: str,
    position: int,
) -> None:
    now = now_utc()
    db.channels.update_one(
        {"id": channel_id},
        {
            "$set": {
                "server_id": server_id,
                "name": name,
                "type": channel_type,
                "topic": topic,
                "parent_id": None,
                "position": position,
                "is_private": False,
                "slowmode_seconds": 0,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )


def upsert_member(db, *, server_id: str, user_id: str, roles: list[str]) -> None:
    now = now_utc()
    db.server_members.update_one(
        {"server_id": server_id, "user_id": user_id},
        {
            "$set": {
                "roles": roles,
                "nickname": "",
                "muted_until": None,
                "is_banned": False,
                "ban_reason": "",
            },
            "$setOnInsert": {"joined_at": now},
        },
        upsert=True,
    )


def upsert_server_bundle(
    db,
    *,
    server_id: str,
    owner_id: str,
    name: str,
    description: str,
    text_channel_id: str,
    voice_channel_id: str,
    admin_role_id: str,
    everyone_role_id: str,
) -> None:
    now = now_utc()
    db.servers.update_one(
        {"id": server_id},
        {
            "$set": {
                "name": name,
                "description": description,
                "icon_url": "",
                "owner_id": owner_id,
                "settings": {
                    "default_channel_id": text_channel_id,
                    "allow_invites": True,
                    "retention_days": 0,
                },
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    upsert_channel(
        db,
        channel_id=text_channel_id,
        server_id=server_id,
        name="general",
        channel_type="text",
        topic="General discussion",
        position=0,
    )
    upsert_channel(
        db,
        channel_id=voice_channel_id,
        server_id=server_id,
        name="Voice",
        channel_type="voice",
        topic="",
        position=1,
    )
    upsert_role(
        db,
        role_id=admin_role_id,
        server_id=server_id,
        name="Admin",
        permissions={permission: True for permission in DEFAULT_PERMISSIONS},
        position=100,
        is_default=False,
    )
    upsert_role(
        db,
        role_id=everyone_role_id,
        server_id=server_id,
        name="@everyone",
        permissions=dict(DEFAULT_PERMISSIONS),
        position=0,
        is_default=True,
    )
    upsert_member(db, server_id=server_id, user_id=owner_id, roles=[admin_role_id])


def seed_main_server(db) -> None:
    upsert_server_bundle(
        db,
        server_id=MAIN_SERVER_ID,
        owner_id=ADMIN_ID,
        name="Integration Test Hub",
        description="Deterministic fixture server for local integration tests",
        text_channel_id=MAIN_TEXT_CHANNEL_ID,
        voice_channel_id=MAIN_VOICE_CHANNEL_ID,
        admin_role_id=MAIN_ADMIN_ROLE_ID,
        everyone_role_id=MAIN_EVERYONE_ROLE_ID,
    )
    upsert_channel(
        db,
        channel_id=ALT_VOICE_CHANNEL_ID,
        server_id=MAIN_SERVER_ID,
        name="Voice Stage",
        channel_type="voice",
        topic="Legacy voice token fixture",
        position=2,
    )
    upsert_member(db, server_id=MAIN_SERVER_ID, user_id=TESTUSER_ID, roles=[])
    upsert_member(db, server_id=MAIN_SERVER_ID, user_id=MAUNTING_ADMIN_ID, roles=[MAIN_ADMIN_ROLE_ID])


def seed_auxiliary_servers(db) -> None:
    for index in range(1, AUX_SERVER_COUNT + 1):
        server_id = stable_id(f"aux-server-{index}")
        text_channel_id = stable_id(f"aux-server-{index}:general")
        voice_channel_id = stable_id(f"aux-server-{index}:voice")
        admin_role_id = stable_id(f"aux-server-{index}:admin-role")
        everyone_role_id = stable_id(f"aux-server-{index}:everyone-role")
        upsert_server_bundle(
            db,
            server_id=server_id,
            owner_id=ADMIN_ID,
            name=f"Seed Server {index:02d}",
            description="Additional seeded server for legacy admin integration tests",
            text_channel_id=text_channel_id,
            voice_channel_id=voice_channel_id,
            admin_role_id=admin_role_id,
            everyone_role_id=everyone_role_id,
        )


def seed_admin_e2ee(db) -> None:
    now = now_utc()
    db.e2ee_accounts.update_one(
        {"user_id": ADMIN_ID},
        {
            "$set": {
                "id": ADMIN_E2EE_ACCOUNT_ID,
                "protocol_version": "sv-e2ee-v1",
                "recovery_public_key": "c2VlZC1hZG1pbi1yZWNvdmVyeS1wdWJsaWMta2V5",
                "encrypted_recovery_private_key": "c2VlZC1hZG1pbi1lbmNyeXB0ZWQtcmVjb3Zlcnkta2V5",
                "recovery_salt": "c2VlZC1hZG1pbi1zYWx0",
                "recovery_nonce": "c2VlZC1hZG1pbi1ub25jZQ==",
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    db.e2ee_devices.update_one(
        {"user_id": ADMIN_ID, "device_id": ADMIN_E2EE_DEVICE_ID},
        {
            "$set": {
                "id": ADMIN_E2EE_DEVICE_DOC_ID,
                "device_name": "Seed Admin Desktop",
                "public_key": "c2VlZC1hZG1pbi1wdWJsaWMta2V5",
                "verified_at": now,
                "verified_by_device_id": ADMIN_E2EE_DEVICE_ID,
                "revoked_at": None,
                "last_seen": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )


def main() -> None:
    client = MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
    try:
        db = client[DB_NAME]
        client.admin.command("ping")

        for user in USERS:
            upsert_user(db, user)

        seed_main_server(db)
        seed_auxiliary_servers(db)
        seed_admin_e2ee(db)

        admin_servers = db.server_members.count_documents({"user_id": ADMIN_ID, "is_banned": {"$ne": True}})
        print(
            f"Seeded local integration stack in '{DB_NAME}': "
            f"{len(USERS)} users, admin memberships={admin_servers}, main_server={MAIN_SERVER_ID}"
        )
    finally:
        client.close()


if __name__ == "__main__":
    main()
