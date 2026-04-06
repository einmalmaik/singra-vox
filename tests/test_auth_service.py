# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
from copy import deepcopy
from types import SimpleNamespace

import bcrypt
import pytest
from fastapi import HTTPException

from backend.app.auth_service import (
    AuthConfig,
    create_auth_session,
    hash_password,
    load_current_user,
    normalize_jwt_secret,
    refresh_auth_session,
    verify_password,
)


def _match(doc, query):
    return all(doc.get(key) == value for key, value in query.items())


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [deepcopy(doc) for doc in (docs or [])]

    async def insert_one(self, doc):
        self.docs.append(deepcopy(doc))

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
                break

    async def update_many(self, query, update):
        for doc in self.docs:
            if _match(doc, query):
                if "$set" in update:
                    doc.update(deepcopy(update["$set"]))


def _request(*, auth_config, headers=None, cookies=None, host="127.0.0.1"):
    return SimpleNamespace(
        headers=headers or {},
        cookies=cookies or {},
        client=SimpleNamespace(host=host),
        app=SimpleNamespace(state=SimpleNamespace(auth_config=auth_config)),
    )


@pytest.mark.asyncio
async def test_refresh_rotation_revokes_old_session_and_loads_new_one():
    auth_config = AuthConfig(jwt_secret="test-secret")
    user = {"id": "user-1", "email": "user@example.com", "password_hash": hash_password("Password123!")}
    db = SimpleNamespace(
        auth_sessions=FakeCollection(),
        users=FakeCollection([user]),
    )

    session, access_token, refresh_token = await create_auth_session(
        db,
        user=user,
        request=_request(
            auth_config=auth_config,
            headers={"user-agent": "pytest", "X-Singra-Client-Platform": "desktop"},
        ),
        auth_config=auth_config,
        device_id="device-1",
    )

    loaded_user, loaded_session = await load_current_user(
        db,
        _request(
            auth_config=auth_config,
            headers={"Authorization": f"Bearer {access_token}"},
        ),
    )
    assert loaded_user["id"] == user["id"]
    assert loaded_session["session_id"] == session["session_id"]

    refreshed_user, new_session, new_access_token, new_refresh_token = await refresh_auth_session(
        db,
        refresh_token=refresh_token,
        request=_request(
            auth_config=auth_config,
            headers={"user-agent": "pytest-2", "X-Singra-Client-Platform": "desktop"},
        ),
        auth_config=auth_config,
    )

    assert refreshed_user["id"] == user["id"]
    assert new_session["session_id"] != session["session_id"]
    assert new_refresh_token != refresh_token
    assert new_access_token != access_token

    revoked_session = await db.auth_sessions.find_one({"session_id": session["session_id"]})
    assert revoked_session["revoked_at"] is not None
    assert revoked_session["replaced_by"] == new_session["session_id"]

    _, rotated_session = await load_current_user(
        db,
        _request(
            auth_config=auth_config,
            headers={"Authorization": f"Bearer {new_access_token}"},
        ),
    )
    assert rotated_session["session_id"] == new_session["session_id"]


@pytest.mark.asyncio
async def test_refresh_reuse_revokes_entire_session_family():
    auth_config = AuthConfig(jwt_secret="test-secret")
    user = {"id": "user-1", "email": "user@example.com", "password_hash": hash_password("Password123!")}
    db = SimpleNamespace(
        auth_sessions=FakeCollection(),
        users=FakeCollection([user]),
    )

    session, _access_token, refresh_token = await create_auth_session(
        db,
        user=user,
        request=_request(auth_config=auth_config, headers={"X-Singra-Client-Platform": "web"}),
        auth_config=auth_config,
    )
    _user, new_session, _new_access, _new_refresh = await refresh_auth_session(
        db,
        refresh_token=refresh_token,
        request=_request(auth_config=auth_config, headers={"X-Singra-Client-Platform": "web"}),
        auth_config=auth_config,
    )

    with pytest.raises(HTTPException) as exc:
        await refresh_auth_session(
            db,
            refresh_token=refresh_token,
            request=_request(auth_config=auth_config, headers={"X-Singra-Client-Platform": "web"}),
            auth_config=auth_config,
        )

    assert exc.value.status_code == 401
    assert exc.value.detail["code"] == "refresh_token_reused"

    old_session = await db.auth_sessions.find_one({"session_id": session["session_id"]})
    rotated_session = await db.auth_sessions.find_one({"session_id": new_session["session_id"]})
    assert old_session["revoked_at"] is not None
    assert rotated_session["revoked_at"] is not None


def test_verify_password_marks_bcrypt_hashes_for_rehash():
    legacy_hash = bcrypt.hashpw("Password123!".encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    valid, needs_rehash = verify_password("Password123!", legacy_hash)
    assert valid is True
    assert needs_rehash is True


def test_auth_config_normalizes_short_jwt_secrets():
    auth_config = AuthConfig(jwt_secret="test-secret")
    assert auth_config.jwt_secret == normalize_jwt_secret("test-secret")
    assert len(auth_config.jwt_secret.encode("utf-8")) >= 32
