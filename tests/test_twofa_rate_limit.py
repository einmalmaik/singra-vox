from copy import deepcopy
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response


BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from backend.app.routes import twofa as twofa_routes


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


class FakeRateLimitCollection:
    def __init__(self):
        self.docs = []

    async def find_one_and_update(self, query, update, upsert=False, return_document=None, projection=None):
        for doc in self.docs:
            if _match(doc, query):
                doc["count"] += update.get("$inc", {}).get("count", 0)
                return {"count": doc["count"]}

        if not upsert:
            return None

        document = {
            "scope": query["scope"],
            "key_hash": query["key_hash"],
            "window_id": query["window_id"],
            "count": update.get("$inc", {}).get("count", 0),
        }
        document.update(deepcopy(update.get("$setOnInsert", {})))
        self.docs.append(document)
        return {"count": document["count"]}


def _request(ip_address="127.0.0.1"):
    return SimpleNamespace(client=SimpleNamespace(host=ip_address))


@pytest.mark.asyncio
async def test_twofa_verify_rate_limits_repeated_invalid_attempts(monkeypatch):
    fake_db = SimpleNamespace(
        totp_secrets=FakeCollection([
            {"user_id": "user-1", "confirmed": True, "secret": "secret", "backup_codes": []},
        ]),
        rate_limits=FakeRateLimitCollection(),
    )
    monkeypatch.setattr(twofa_routes, "db", fake_db)
    monkeypatch.setattr(twofa_routes, "verify_totp_code", lambda *_args, **_kwargs: False)

    request = _request()
    payload = twofa_routes.TwoFAVerifyInput(user_id="user-1", code="000000")

    for _ in range(twofa_routes.TWOFA_VERIFY_RATE_LIMIT):
        with pytest.raises(HTTPException) as exc:
            await twofa_routes.twofa_verify(payload, request, Response())
        assert exc.value.status_code == 401

    with pytest.raises(HTTPException) as exc:
        await twofa_routes.twofa_verify(payload, request, Response())

    assert exc.value.status_code == 429
    assert exc.value.detail["code"] == twofa_routes.TWOFA_VERIFY_RATE_LIMIT_CODE


@pytest.mark.asyncio
async def test_twofa_verify_rate_limit_is_scoped_per_user_and_ip(monkeypatch):
    fake_db = SimpleNamespace(
        totp_secrets=FakeCollection([
            {"user_id": "user-1", "confirmed": True, "secret": "secret", "backup_codes": []},
            {"user_id": "user-2", "confirmed": True, "secret": "secret", "backup_codes": []},
        ]),
        rate_limits=FakeRateLimitCollection(),
    )
    monkeypatch.setattr(twofa_routes, "db", fake_db)
    monkeypatch.setattr(twofa_routes, "verify_totp_code", lambda *_args, **_kwargs: False)

    for _ in range(twofa_routes.TWOFA_VERIFY_RATE_LIMIT):
        with pytest.raises(HTTPException):
            await twofa_routes.twofa_verify(
                twofa_routes.TwoFAVerifyInput(user_id="user-1", code="000000"),
                _request("127.0.0.1"),
                Response(),
            )

    with pytest.raises(HTTPException) as limited_exc:
        await twofa_routes.twofa_verify(
            twofa_routes.TwoFAVerifyInput(user_id="user-1", code="000000"),
            _request("127.0.0.1"),
            Response(),
        )
    assert limited_exc.value.status_code == 429

    with pytest.raises(HTTPException) as other_user_exc:
        await twofa_routes.twofa_verify(
            twofa_routes.TwoFAVerifyInput(user_id="user-2", code="000000"),
            _request("127.0.0.1"),
            Response(),
        )
    assert other_user_exc.value.status_code == 401

    with pytest.raises(HTTPException) as other_ip_exc:
        await twofa_routes.twofa_verify(
            twofa_routes.TwoFAVerifyInput(user_id="user-1", code="000000"),
            _request("10.0.0.2"),
            Response(),
        )
    assert other_ip_exc.value.status_code == 401
