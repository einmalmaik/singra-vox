# Singra Vox - Singra-ID linking unit tests
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.app.services.svid_linking import link_local_user_to_svid, resolve_linked_svid_account


def _match(doc, query):
    return all(doc.get(key) == value for key, value in query.items())


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
