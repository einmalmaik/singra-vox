# Singra Vox - Singra-ID linking unit tests
from copy import deepcopy
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from backend.app.identity import routes as identity_routes
from backend.app.identity.models import SvidRegisterInput
from backend.app.services.svid_linking import link_local_user_to_svid, resolve_linked_svid_account


def _match(doc, query):
    for key, value in query.items():
        current = doc.get(key)
        if isinstance(value, dict):
            if "$ne" in value and current == value["$ne"]:
                return False
            continue
        if current != value:
            return False
    return True


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [deepcopy(doc) for doc in (docs or [])]

    async def find_one(self, query, projection=None):
        for doc in self.docs:
            if _match(doc, query):
                return deepcopy(doc)
        return None

    async def update_one(self, query, update):
        for doc in self.docs:
            if _match(doc, query):
                if "$set" in update:
                    doc.update(deepcopy(update["$set"]))
                return

    async def insert_one(self, doc):
        self.docs.append(deepcopy(doc))


@pytest.mark.asyncio
async def test_link_local_user_to_svid_updates_both_records():
    db = SimpleNamespace(
        users=FakeCollection([
            {"id": "local-1", "email": "user@example.com", "username": "alice"},
        ]),
        svid_accounts=FakeCollection([
            {"id": "svid-1", "email": "user@example.com", "username": "alice_global"},
        ]),
    )

    updated_user, linked_account = await link_local_user_to_svid(
        db,
        local_user={"id": "local-1", "email": "user@example.com", "username": "alice"},
        svid_account={"id": "svid-1", "email": "user@example.com", "username": "alice_global"},
        svid_issuer="https://id.example.com",
        disable_local_password_login=True,
    )

    assert updated_user["svid_account_id"] == "svid-1"
    assert updated_user["svid_server"] == "https://id.example.com"
    assert updated_user["local_login_disabled"] is True
    assert linked_account["linked_user_id"] == "local-1"


@pytest.mark.asyncio
async def test_resolve_linked_svid_account_prefers_direct_user_link():
    db = SimpleNamespace(
        svid_accounts=FakeCollection([
            {"id": "svid-1", "linked_user_id": "legacy-user"},
            {"id": "svid-2", "linked_user_id": "local-1"},
        ]),
    )

    account = await resolve_linked_svid_account(
        db,
        local_user={"id": "local-1", "svid_account_id": "svid-2"},
    )

    assert account["id"] == "svid-2"


@pytest.mark.asyncio
async def test_link_local_user_to_svid_rejects_conflicting_link():
    db = SimpleNamespace(
        users=FakeCollection([
            {"id": "local-1", "email": "one@example.com"},
            {"id": "local-2", "email": "two@example.com", "svid_account_id": "svid-1"},
        ]),
        svid_accounts=FakeCollection([
            {"id": "svid-1", "email": "user@example.com", "linked_user_id": "local-2"},
        ]),
    )

    with pytest.raises(HTTPException) as exc:
        await link_local_user_to_svid(
            db,
            local_user={"id": "local-1", "email": "one@example.com"},
            svid_account={"id": "svid-1", "email": "user@example.com"},
            svid_issuer="https://id.example.com",
            disable_local_password_login=True,
        )

    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_link_local_user_to_svid_rejects_relink_for_other_svid_account():
    db = SimpleNamespace(
        users=FakeCollection([
            {"id": "local-1", "email": "user@example.com", "svid_account_id": "svid-old"},
        ]),
        svid_accounts=FakeCollection([
            {"id": "svid-old", "email": "old@example.com", "linked_user_id": "local-1"},
            {"id": "svid-new", "email": "new@example.com"},
        ]),
    )

    with pytest.raises(HTTPException) as exc:
        await link_local_user_to_svid(
            db,
            local_user={"id": "local-1", "email": "user@example.com", "svid_account_id": "svid-old"},
            svid_account={"id": "svid-new", "email": "new@example.com"},
            svid_issuer="https://id.example.com",
            disable_local_password_login=True,
        )

    assert exc.value.status_code == 409
    original_account = await db.svid_accounts.find_one({"id": "svid-old"})
    relink_target = await db.svid_accounts.find_one({"id": "svid-new"})
    assert original_account["linked_user_id"] == "local-1"
    assert relink_target.get("linked_user_id") is None


@pytest.mark.asyncio
async def test_link_local_user_to_svid_rejects_legacy_link_conflict():
    db = SimpleNamespace(
        users=FakeCollection([
            {"id": "local-1", "email": "user@example.com"},
        ]),
        svid_accounts=FakeCollection([
            {"id": "svid-old", "email": "old@example.com", "linked_user_id": "local-1"},
            {"id": "svid-new", "email": "new@example.com"},
        ]),
    )

    with pytest.raises(HTTPException) as exc:
        await link_local_user_to_svid(
            db,
            local_user={"id": "local-1", "email": "user@example.com"},
            svid_account={"id": "svid-new", "email": "new@example.com"},
            svid_issuer="https://id.example.com",
            disable_local_password_login=True,
        )

    assert exc.value.status_code == 409
    original_account = await db.svid_accounts.find_one({"id": "svid-old"})
    relink_target = await db.svid_accounts.find_one({"id": "svid-new"})
    assert original_account["linked_user_id"] == "local-1"
    assert relink_target.get("linked_user_id") is None


@pytest.mark.asyncio
async def test_svid_register_fails_closed_when_mail_delivery_breaks(monkeypatch):
    db = SimpleNamespace(
        svid_accounts=FakeCollection([]),
        svid_sessions=FakeCollection([]),
    )

    monkeypatch.setattr(identity_routes, "_db", db)

    async def fail_issue_auth_code_email(**_kwargs):
        raise RuntimeError("smtp unavailable")

    monkeypatch.setattr(identity_routes, "_issue_auth_code_email", fail_issue_auth_code_email)

    with pytest.raises(HTTPException) as exc:
        await identity_routes.svid_register(
            SvidRegisterInput(
                email="new@example.com",
                username="new_user",
                password="C0mpl3x!Passw0rd",
                display_name="New User",
            )
        )

    assert exc.value.status_code == 503
    stored_account = await db.svid_accounts.find_one({"email": "new@example.com"})
    assert stored_account["email_verified"] is False
    assert db.svid_sessions.docs == []


@pytest.mark.asyncio
async def test_svid_register_existing_unverified_account_stays_unverified_when_mail_fails(monkeypatch):
    db = SimpleNamespace(
        svid_accounts=FakeCollection([
            {
                "id": "svid-1",
                "email": "existing@example.com",
                "username": "legacy_name",
                "display_name": "Legacy User",
                "password_hash": "old-hash",
                "email_verified": False,
                "email_verified_at": None,
            }
        ]),
        svid_sessions=FakeCollection([]),
    )

    monkeypatch.setattr(identity_routes, "_db", db)

    async def fail_issue_auth_code_email(**_kwargs):
        raise RuntimeError("smtp unavailable")

    monkeypatch.setattr(identity_routes, "_issue_auth_code_email", fail_issue_auth_code_email)

    with pytest.raises(HTTPException) as exc:
        await identity_routes.svid_register(
            SvidRegisterInput(
                email="existing@example.com",
                username="fresh_name",
                password="An0ther!StrongPass",
                display_name="Fresh User",
            )
        )

    assert exc.value.status_code == 503
    stored_account = await db.svid_accounts.find_one({"email": "existing@example.com"})
    assert stored_account["username"] == "fresh_name"
    assert stored_account["display_name"] == "Fresh User"
    assert stored_account["email_verified"] is False
    assert db.svid_sessions.docs == []
