# Singra Vox - Permission centralization regression tests
from copy import deepcopy
from pathlib import Path
import sys
from types import SimpleNamespace
import types

import pytest
from fastapi import HTTPException

BACKEND_ROOT = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


class _FakePyotpTotp:
    def __init__(self, *_args, **_kwargs):
        pass

    def provisioning_uri(self, **_kwargs):
        return "otpauth://stub"

    def verify(self, *_args, **_kwargs):
        return True


sys.modules.setdefault(
    "pyotp",
    types.SimpleNamespace(
        random_base32=lambda: "BASE32SECRET",
        TOTP=_FakePyotpTotp,
    ),
)

from app.routes import channels as channels_routes
from app.routes import messages as messages_routes
from app.routes import server_moderation as moderation_routes
from app.routes import voice as voice_routes
from app.schemas import MessageCreateInput
from app.services import e2ee as e2ee_service
from app.services import message_mentions as mention_service


def _match(doc, query):
    for key, value in query.items():
        current = doc.get(key)
        if isinstance(value, dict):
            if "$ne" in value and current == value["$ne"]:
                return False
            if "$in" in value and current not in value["$in"]:
                return False
            continue
        if current != value:
            return False
    return True


class FakeCursor:
    def __init__(self, docs):
        self.docs = [deepcopy(doc) for doc in docs]

    def sort(self, *_args, **_kwargs):
        return self

    async def to_list(self, _limit):
        return [deepcopy(doc) for doc in self.docs]


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = [deepcopy(doc) for doc in (docs or [])]

    async def find_one(self, query, projection=None, sort=None):
        matches = [doc for doc in self.docs if _match(doc, query)]
        if not matches:
            return None
        if sort:
            key, direction = sort[0]
            matches = sorted(matches, key=lambda doc: doc.get(key), reverse=direction < 0)
        return deepcopy(matches[0])

    def find(self, query, projection=None):
        return FakeCursor([doc for doc in self.docs if _match(doc, query)])

    async def update_one(self, query, update):
        for doc in self.docs:
            if _match(doc, query):
                if "$set" in update:
                    doc.update(deepcopy(update["$set"]))
                return

    async def update_many(self, query, update):
        for doc in self.docs:
            if _match(doc, query):
                if "$set" in update:
                    doc.update(deepcopy(update["$set"]))

    async def delete_one(self, query):
        self.docs = [doc for doc in self.docs if not _match(doc, query)]

    async def insert_one(self, doc):
        self.docs.append(deepcopy(doc))


def _request(headers=None):
    return SimpleNamespace(headers=headers or {})


@pytest.mark.asyncio
async def test_get_messages_blocks_when_channel_permission_denies(monkeypatch):
    fake_db = SimpleNamespace(
        channels=FakeCollection([
            {"id": "channel-1", "server_id": "server-1", "type": "text"},
        ]),
    )
    monkeypatch.setattr(channels_routes, "db", fake_db)
    async def fake_current_user(_request):
        return {"id": "user-1"}

    monkeypatch.setattr(channels_routes, "current_user", fake_current_user)

    async def deny_read(*_args, **_kwargs):
        raise HTTPException(403, "No permission")

    monkeypatch.setattr(channels_routes, "assert_channel_permission", deny_read)

    with pytest.raises(HTTPException) as exc:
        await channels_routes.get_messages("channel-1", _request())

    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_send_message_checks_attachment_permission_via_central_assert(monkeypatch):
    permission_calls = []
    fake_db = SimpleNamespace(
        channels=FakeCollection([
            {"id": "channel-1", "server_id": "server-1", "type": "text", "is_private": False},
        ]),
        server_members=FakeCollection([]),
    )
    monkeypatch.setattr(channels_routes, "db", fake_db)
    async def fake_current_user(_request):
        return {"id": "user-1", "display_name": "User 1"}

    async def fake_private_access(*_args, **_kwargs):
        return None

    async def fake_mentions(**_kwargs):
        return {
            "mentioned_user_ids": [],
            "mentioned_role_ids": [],
            "mentions_everyone": False,
            "notify_user_ids": [],
        }

    monkeypatch.setattr(channels_routes, "current_user", fake_current_user)
    monkeypatch.setattr(channels_routes, "ensure_private_channel_member_access", fake_private_access)
    monkeypatch.setattr(channels_routes, "resolve_message_mentions", fake_mentions)

    async def permission_gate(_db, _user_id, _channel, permission, detail=None):
        permission_calls.append((permission, detail))
        if permission == "attach_files":
            raise HTTPException(403, detail or "No permission")

    monkeypatch.setattr(channels_routes, "assert_channel_permission", permission_gate)

    with pytest.raises(HTTPException) as exc:
        await channels_routes.send_message(
            "channel-1",
            MessageCreateInput(content="Hello", attachments=[{"id": "attachment-1"}]),
            _request(),
        )

    assert exc.value.status_code == 403
    assert permission_calls == [
        ("send_messages", "No permission"),
        ("attach_files", "No permission to upload files"),
    ]


@pytest.mark.asyncio
async def test_delete_message_keeps_moderator_path_with_has_channel_permission(monkeypatch):
    fake_db = SimpleNamespace(
        messages=FakeCollection([
            {"id": "message-1", "author_id": "author-1", "channel_id": "channel-1", "content": "hello", "is_deleted": False},
        ]),
        channels=FakeCollection([
            {"id": "channel-1", "server_id": "server-1", "type": "text"},
        ]),
    )
    monkeypatch.setattr(messages_routes, "db", fake_db)
    async def fake_current_user(_request):
        return {"id": "mod-1"}

    monkeypatch.setattr(messages_routes, "current_user", fake_current_user)

    async def allow_manage(*_args, **_kwargs):
        return True

    async def noop_broadcast(*_args, **_kwargs):
        return None

    monkeypatch.setattr(messages_routes, "has_channel_permission", allow_manage)
    monkeypatch.setattr(messages_routes.ws_mgr, "broadcast_server", noop_broadcast)

    response = await messages_routes.delete_message("message-1", _request())

    assert response == {"ok": True}
    stored = await fake_db.messages.find_one({"id": "message-1"})
    assert stored["is_deleted"] is True
    assert stored["content"] == "[deleted]"


@pytest.mark.asyncio
async def test_voice_context_uses_single_channel_permission_snapshot(monkeypatch):
    fake_db = SimpleNamespace(
        channels=FakeCollection([
            {"id": "voice-1", "server_id": "server-1", "type": "voice", "is_private": False},
        ]),
    )
    monkeypatch.setattr(voice_routes, "db", fake_db)
    async def fake_current_user(_request):
        return {"id": "user-1", "display_name": "User 1"}

    async def fake_permissions(*_args, **_kwargs):
        return {
            "join_voice": True,
            "speak": False,
            "stream": True,
        }

    async def fake_private_access(*_args, **_kwargs):
        return None

    monkeypatch.setattr(voice_routes, "current_user", fake_current_user)
    monkeypatch.setattr(voice_routes, "get_channel_permissions", fake_permissions)
    monkeypatch.setattr(voice_routes, "ensure_private_channel_member_access", fake_private_access)
    monkeypatch.setattr(voice_routes, "livekit_url", "wss://livekit.example.com")
    monkeypatch.setattr(voice_routes, "livekit_api_key", "key")
    monkeypatch.setattr(voice_routes, "livekit_api_secret", "secret")

    context = await voice_routes._resolve_voice_channel_context(_request(), "server-1", "voice-1")

    assert context["can_join"] is True
    assert context["can_speak"] is False
    assert context["can_stream"] is True


@pytest.mark.asyncio
async def test_list_bans_allows_manage_members_without_ban_members(monkeypatch):
    fake_db = SimpleNamespace(
        server_members=FakeCollection([
            {"server_id": "server-1", "user_id": "user-2", "is_banned": True, "ban_reason": "spam"},
        ]),
        users=FakeCollection([
            {"id": "user-2", "username": "user2", "display_name": "User Two"},
        ]),
    )
    monkeypatch.setattr(moderation_routes, "db", fake_db)
    async def fake_current_user(_request):
        return {"id": "mod-1"}

    monkeypatch.setattr(moderation_routes, "current_user", fake_current_user)

    async def permission_lookup(_db, _user_id, _server_id, permission):
        return permission == "manage_members"

    monkeypatch.setattr(moderation_routes, "has_server_permission", permission_lookup)

    result = await moderation_routes.list_bans("server-1", _request())

    assert len(result) == 1
    assert result[0]["user"]["display_name"] == "User Two"


@pytest.mark.asyncio
async def test_message_mentions_require_permission_for_everyone(monkeypatch):
    fake_db = SimpleNamespace(
        server_members=FakeCollection([
            {"server_id": "server-1", "user_id": "actor-1", "roles": []},
            {"server_id": "server-1", "user_id": "user-2", "roles": []},
        ]),
        users=FakeCollection([]),
        roles=FakeCollection([]),
    )
    monkeypatch.setattr(mention_service, "db", fake_db)

    async def deny_everyone(*_args, **_kwargs):
        return False

    async def allow_everyone(*_args, **_kwargs):
        return True

    monkeypatch.setattr(mention_service, "has_server_permission", deny_everyone)
    denied = await mention_service.resolve_message_mentions(
        server_id="server-1",
        actor_id="actor-1",
        content="@everyone hi",
    )
    assert denied["mentions_everyone"] is False

    monkeypatch.setattr(mention_service, "has_server_permission", allow_everyone)
    allowed = await mention_service.resolve_message_mentions(
        server_id="server-1",
        actor_id="actor-1",
        content="@everyone hi",
    )
    assert allowed["mentions_everyone"] is True
    assert "user-2" in allowed["notify_user_ids"]


@pytest.mark.asyncio
async def test_authorize_blob_access_channel_path_uses_channel_assert(monkeypatch):
    fake_db = SimpleNamespace(
        channels=FakeCollection([
            {"id": "channel-1", "server_id": "server-1", "type": "text", "is_private": False},
        ]),
    )
    permission_calls = []
    monkeypatch.setattr(e2ee_service, "db", fake_db)

    async def fake_assert(_db, _user_id, _channel, permission, detail=None):
        permission_calls.append((permission, detail))

    async def fake_private_access(*_args, **_kwargs):
        return None

    monkeypatch.setattr(e2ee_service, "assert_channel_permission", fake_assert)
    monkeypatch.setattr(e2ee_service, "ensure_private_channel_member_access", fake_private_access)

    await e2ee_service.authorize_blob_access(
        {"id": "user-1"},
        {"scope_kind": "channel", "scope_id": "channel-1"},
    )

    assert permission_calls == [("read_messages", "No access to this encrypted attachment")]
