"""
Compact end-to-end acceptance smoke for Singra Vox encryption flows.

The script exercises the real local stack instead of mocks so we can verify:
client-equivalent crypto -> API -> Mongo / MinIO -> API -> decrypt again.
"""
from __future__ import annotations

import base64
import json
import os
import random
import re
import string
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional

import boto3
import requests
from requests import Response, Session


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "tests" / "e2ee_crypto_helper.mjs"
API_BASE = os.environ.get("SINGRAVOX_API_BASE", "http://localhost:8080/api")
MAILPIT_BASE = os.environ.get("SINGRAVOX_MAILPIT_BASE", "http://localhost:8025/api/v1")
MINIO_ENDPOINT = os.environ.get("SINGRAVOX_MINIO_ENDPOINT", "http://localhost:9000")
MINIO_BUCKET = os.environ.get("SINGRAVOX_MINIO_BUCKET", "singravox-e2ee")
MINIO_ACCESS_KEY = os.environ.get("SINGRAVOX_MINIO_ACCESS_KEY", "singravox")
MINIO_SECRET_KEY = os.environ.get("SINGRAVOX_MINIO_SECRET_KEY", "singravox-secret")
DEFAULT_PASSWORD = "Password123!"
DEFAULT_PASSPHRASE = "correct horse battery staple"


def resolve_backend_env(name: str, fallback: str) -> str:
    result = subprocess.run(
        ["docker", "exec", "singravox-backend", "printenv", name],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
        check=False,
    )
    if result.returncode == 0:
        value = result.stdout.strip()
        if value:
            return value
    return os.environ.get(f"SINGRAVOX_{name}", fallback)


DB_NAME = resolve_backend_env("DB_NAME", "singravox")


def rnd(length: int = 8) -> str:
    return "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(length))


def assert_ok(response: Response, expected_status: int = 200) -> Any:
    if response.status_code != expected_status:
        raise AssertionError(
            f"{response.request.method} {response.request.url} -> "
            f"{response.status_code} {response.text}"
        )
    if not response.content:
        return None
    if "application/json" in response.headers.get("content-type", ""):
        return response.json()
    return response.content


def helper_call(command: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    result = subprocess.run(
        ["node", str(HELPER)],
        input=json.dumps({"command": command, "payload": payload}),
        text=True,
        capture_output=True,
        cwd=str(ROOT),
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or f"helper {command} failed")
    return json.loads(result.stdout)


def mongo_eval(script: str) -> str:
    result = subprocess.run(
        ["docker", "exec", "-i", "singravox-db", "mongosh", DB_NAME, "--quiet", "--eval", script],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "mongosh failed")
    return result.stdout.strip()


def mongo_one(collection: str, query: Dict[str, Any], projection: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    projection_expr = json.dumps(projection or {"_id": 0})
    output = mongo_eval(
        f"const doc = db.{collection}.findOne({json.dumps(query)}, {projection_expr}); "
        "print(EJSON.stringify(doc));"
    )
    if output in {"", "null"}:
        return None
    return json.loads(output)


def mongo_update_user(email: str, update: Dict[str, Any]) -> None:
    mongo_eval(
        f"db.users.updateOne({json.dumps({'email': email})}, "
        f"{{ $set: {json.dumps(update)} }});"
    )


def latest_mail(recipient: str, subject_contains: str, timeout_seconds: int = 20) -> Dict[str, Any]:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        payload = assert_ok(requests.get(f"{MAILPIT_BASE}/messages", timeout=10))
        for message in payload.get("messages", []):
            recipients = [entry.get("Address", "").lower() for entry in (message.get("To") or [])]
            if recipient.lower() in recipients and subject_contains.lower() in message.get("Subject", "").lower():
                return message
        time.sleep(1)
    raise TimeoutError(f"No mail for {recipient} with subject containing {subject_contains!r}")


def extract_code(message: Dict[str, Any]) -> str:
    snippet = message.get("Snippet", "")
    match = re.search(r"\b(\d{4,8})\b", snippet)
    if match:
        return match.group(1)

    detail = assert_ok(requests.get(f"{MAILPIT_BASE}/message/{message['ID']}", timeout=10))
    for candidate in (detail.get("Text", ""), detail.get("HTML", ""), detail.get("Snippet", "")):
        match = re.search(r"\b(\d{4,8})\b", candidate or "")
        if match:
            return match.group(1)
    raise ValueError("Could not extract verification/reset code from mail")


@dataclass
class ApiClient:
    email: str
    username: str
    display_name: str
    password: str = DEFAULT_PASSWORD
    session: Session = field(default_factory=Session)
    user: Optional[Dict[str, Any]] = None
    identity: Optional[Dict[str, Any]] = None

    def _headers(self, extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.identity:
            headers["X-Singra-Device-Id"] = self.identity["device_id"]
        if extra:
            headers.update(extra)
        return headers

    def get(self, path: str, **kwargs) -> Response:
        headers = kwargs.pop("headers", None)
        return self.session.get(f"{API_BASE}{path}", headers=self._headers(headers), timeout=20, **kwargs)

    def post(self, path: str, payload: Optional[Dict[str, Any]] = None, **kwargs) -> Response:
        headers = kwargs.pop("headers", None)
        return self.session.post(
            f"{API_BASE}{path}",
            headers=self._headers(headers),
            data=json.dumps(payload or {}),
            timeout=20,
            **kwargs,
        )

    def put(self, path: str, payload: Optional[Dict[str, Any]] = None, **kwargs) -> Response:
        headers = kwargs.pop("headers", None)
        return self.session.put(
            f"{API_BASE}{path}",
            headers=self._headers(headers),
            data=json.dumps(payload or {}),
            timeout=20,
            **kwargs,
        )

    def delete(self, path: str, **kwargs) -> Response:
        headers = kwargs.pop("headers", None)
        return self.session.delete(f"{API_BASE}{path}", headers=self._headers(headers), timeout=20, **kwargs)

    def register_verify_login(self) -> None:
        assert_ok(self.post("/auth/register", {
            "email": self.email,
            "username": self.username,
            "password": self.password,
            "display_name": self.display_name,
        }))
        code = extract_code(latest_mail(self.email, "Verify your email"))
        assert_ok(self.post("/auth/verify-email", {"email": self.email, "code": code}))
        login_payload = assert_ok(self.post("/auth/login", {"email": self.email, "password": self.password}))
        self.user = login_payload["user"]

    def bootstrap_e2ee(self, *, passphrase: str = DEFAULT_PASSPHRASE, device_name: str = "Desktop Alpha") -> None:
        self.identity = helper_call("bootstrap", {"deviceName": device_name, "passphrase": passphrase})
        assert_ok(self.post("/e2ee/bootstrap", {
            "device_id": self.identity["device_id"],
            "device_name": self.identity["device_name"],
            "device_public_key": self.identity["device_public_key"],
            "recovery_public_key": self.identity["recovery_public_key"],
            "encrypted_recovery_private_key": self.identity["encrypted_recovery_private_key"],
            "recovery_salt": self.identity["recovery_salt"],
            "recovery_nonce": self.identity["recovery_nonce"],
        }))

    def register_extra_device(self, device_name: str) -> Dict[str, Any]:
        device = helper_call("generate-device", {"deviceName": device_name})
        assert_ok(self.post("/e2ee/devices", {
            "device_id": device["device_id"],
            "device_name": device["device_name"],
            "device_public_key": device["device_public_key"],
        }))
        return device


def login_fresh(email: str, password: str, identity: Optional[Dict[str, Any]] = None) -> ApiClient:
    client = ApiClient(email=email, username=email.split("@")[0], display_name=email.split("@")[0], password=password)
    client.identity = identity
    login_payload = assert_ok(client.post("/auth/login", {"email": email, "password": password}))
    client.user = login_payload["user"]
    return client


def create_owner_user() -> ApiClient:
    suffix = rnd()
    owner = ApiClient(
        email=f"e2ee_owner_{suffix}@example.com",
        username=f"e2eeowner{suffix}",
        display_name="E2EE Owner",
    )
    owner.register_verify_login()
    owner.bootstrap_e2ee(device_name="Owner Desktop")
    mongo_update_user(owner.email, {"instance_role": "owner", "role": "owner", "email_verified": True})
    return login_fresh(owner.email, owner.password, owner.identity)


def create_standard_user(label: str) -> ApiClient:
    suffix = rnd()
    user = ApiClient(
        email=f"{label}_{suffix}@example.com",
        username=f"{label}{suffix}",
        display_name=label.title(),
    )
    user.register_verify_login()
    user.bootstrap_e2ee(device_name=f"{label.title()} Desktop")
    return login_fresh(user.email, user.password, user.identity)


def encrypt_attachment(plaintext: bytes, *, name: str, content_type: str) -> Dict[str, Any]:
    return helper_call("encrypt-binary", {
        "plaintext_b64": base64.b64encode(plaintext).decode("ascii"),
        "name": name,
        "size_bytes": len(plaintext),
        "content_type": content_type,
    })


def decrypt_attachment(ciphertext: bytes, manifest: Dict[str, Any]) -> bytes:
    payload = helper_call("decrypt-binary", {
        "ciphertext_b64": base64.b64encode(ciphertext).decode("ascii"),
        "manifest": manifest,
    })
    return base64.b64decode(payload["plaintext_b64"])


def decrypt_message_payload(identity: Dict[str, Any], user_id: str, message: Dict[str, Any]) -> Dict[str, Any]:
    result = helper_call("decrypt-message", {
        "identity": identity,
        "user_id": user_id,
        "message": message,
    })
    if not result.get("ok"):
        raise AssertionError(f"Could not decrypt message: {result}")
    return result["payload"]


def upload_encrypted_attachment(
    client: ApiClient,
    *,
    scope_kind: str,
    scope_id: str,
    participant_user_ids: list[str],
    plaintext: bytes,
    name: str,
    content_type: str,
) -> Dict[str, Any]:
    init_payload = assert_ok(client.post("/e2ee/blobs/init", {
        "scope_kind": scope_kind,
        "scope_id": scope_id,
        "participant_user_ids": participant_user_ids,
    }))
    encrypted = encrypt_attachment(plaintext, name=name, content_type=content_type)
    assert_ok(client.put(f"/e2ee/blobs/{init_payload['upload_id']}/content", {
        "ciphertext_b64": encrypted["ciphertext_b64"],
        "sha256": encrypted["sha256"],
        "size_bytes": encrypted["ciphertext_size_bytes"],
        "content_type": "application/octet-stream",
    }))
    blob_record = assert_ok(client.post(f"/e2ee/blobs/{init_payload['upload_id']}/complete"))
    manifest = {**encrypted["manifest"], "blob_id": blob_record["id"], "url": blob_record["url"]}
    return {"blob": blob_record, "manifest": manifest}


def send_encrypted_dm(sender: ApiClient, receiver: ApiClient, text: str, attachment_plaintext: bytes) -> Dict[str, Any]:
    recipients = assert_ok(sender.get(f"/e2ee/dm/{receiver.user['id']}/recipients"))
    attachment = upload_encrypted_attachment(
        sender,
        scope_kind="dm",
        scope_id=receiver.user["id"],
        participant_user_ids=sorted([sender.user["id"], receiver.user["id"]]),
        plaintext=attachment_plaintext,
        name="dm-secret.txt",
        content_type="text/plain",
    )
    encrypted_message = helper_call("encrypt-message", {
        "identity": sender.identity,
        "recipients": recipients,
        "structuredPayload": {"text": text, "attachments": [attachment["manifest"]]},
    })
    message = assert_ok(sender.post(f"/dm/{receiver.user['id']}", {
        "content": "[Encrypted message]",
        "attachments": [attachment["blob"]],
        "message_type": "text",
        **encrypted_message,
    }))
    return {"message": message, "attachment": attachment}


def send_encrypted_channel_message(
    sender: ApiClient,
    channel_id: str,
    text: str,
    attachment_plaintext: bytes,
    participant_user_ids: list[str],
) -> Dict[str, Any]:
    recipients = assert_ok(sender.get(f"/e2ee/channels/{channel_id}/recipients"))
    attachment = upload_encrypted_attachment(
        sender,
        scope_kind="channel",
        scope_id=channel_id,
        participant_user_ids=participant_user_ids,
        plaintext=attachment_plaintext,
        name="channel-secret.txt",
        content_type="text/plain",
    )
    encrypted_message = helper_call("encrypt-message", {
        "identity": sender.identity,
        "recipients": recipients,
        "structuredPayload": {"text": text, "attachments": [attachment["manifest"]]},
    })
    message = assert_ok(sender.post(f"/channels/{channel_id}/messages", {
        "content": "[Encrypted message]",
        "attachments": [attachment["blob"]],
        "message_type": "text",
        **encrypted_message,
    }))
    return {"message": message, "attachment": attachment}


def create_public_attachment_message(owner: ApiClient, channel_id: str, plaintext: bytes) -> Dict[str, Any]:
    encoded = base64.b64encode(plaintext).decode("ascii")
    attachment = assert_ok(owner.post("/upload", {
        "name": "public.txt",
        "type": "text/plain",
        "data": encoded,
    }))
    message = assert_ok(owner.post(f"/channels/{channel_id}/messages", {
        "content": "public attachment",
        "attachments": [attachment],
    }))
    return {"message": message, "attachment": attachment}


def fetch_minio_ciphertext(blob_id: str) -> bytes:
    s3 = boto3.client(
        "s3",
        endpoint_url=MINIO_ENDPOINT,
        region_name="us-east-1",
        aws_access_key_id=MINIO_ACCESS_KEY,
        aws_secret_access_key=MINIO_SECRET_KEY,
    )
    db_blob = mongo_one("e2ee_blobs", {"id": blob_id})
    if not db_blob:
        raise AssertionError(f"Blob {blob_id} not found in Mongo")
    response = s3.get_object(Bucket=MINIO_BUCKET, Key=db_blob["object_key"])
    return response["Body"].read()


def assert_contains_bytes(haystack: bytes, needle: bytes, should_contain: bool, context: str) -> None:
    contains = needle in haystack
    if contains != should_contain:
        expectation = "contain" if should_contain else "not contain"
        raise AssertionError(f"{context} should {expectation} {needle!r}")


def restart_stack() -> None:
    subprocess.run(
        ["docker", "compose", "-f", "deploy/docker-compose.yml", "restart", "backend", "frontend", "proxy"],
        cwd=str(ROOT),
        check=True,
        capture_output=True,
        text=True,
    )
    deadline = time.time() + 60
    while time.time() < deadline:
        try:
            if requests.get(f"{API_BASE}/health", timeout=5).status_code == 200:
                return
        except Exception:
            pass
        time.sleep(2)
    raise TimeoutError("Stack did not become healthy again after restart")


def run_acceptance() -> Dict[str, Any]:
    summary: Dict[str, Any] = {"checks": []}
    owner = create_owner_user()
    member = create_standard_user("e2ee_member")
    summary["owner_email"] = owner.email
    summary["member_email"] = member.email

    extra_device = owner.register_extra_device("Owner Laptop")
    devices = assert_ok(owner.get("/e2ee/state"))["devices"]
    if next(device for device in devices if device["device_id"] == extra_device["device_id"]).get("verified_at"):
        raise AssertionError("Fresh secondary device should start untrusted")
    assert_ok(owner.post(f"/e2ee/devices/{extra_device['device_id']}/approve"))
    summary["checks"].append("device-approval")

    server = assert_ok(owner.post("/servers", {"name": f"E2EE Test {rnd(4)}", "description": "E2EE acceptance"}))
    channels = assert_ok(owner.get(f"/servers/{server['id']}/channels"))
    general_channel = next(channel for channel in channels if channel["type"] == "text" and not channel.get("is_private"))
    private_text = assert_ok(owner.post(f"/servers/{server['id']}/channels", {"name": "private-text", "type": "text", "is_private": True}))
    private_voice = assert_ok(owner.post(f"/servers/{server['id']}/channels", {"name": "private-voice", "type": "voice", "is_private": True}))

    invite = assert_ok(owner.post(f"/servers/{server['id']}/invites", {"max_uses": 0, "expires_hours": 24}))
    joined = assert_ok(member.post(f"/invites/{invite['code']}/accept"))
    if joined["server_id"] != server["id"]:
        raise AssertionError("Invite accept did not return the expected server")
    access_payload = {"user_ids": [owner.user["id"], member.user["id"]], "role_ids": []}
    assert_ok(owner.put(f"/channels/{private_text['id']}/access", access_payload))
    assert_ok(owner.put(f"/channels/{private_voice['id']}/access", access_payload))
    summary["checks"].append("server-join")

    public_plaintext = b"public-file-visible-to-members"
    public_message = create_public_attachment_message(owner, general_channel["id"], public_plaintext)
    member_messages = assert_ok(member.get(f"/channels/{general_channel['id']}/messages"))
    if not any(message["id"] == public_message["message"]["id"] for message in member_messages):
        raise AssertionError("Member could not see the public attachment message")
    public_file = assert_ok(member.get(public_message["attachment"]["url"].replace("/api", "")))
    assert_contains_bytes(public_file, public_plaintext, True, "Public attachment")
    summary["checks"].append("public-attachment")

    dm_text = "dm secret message"
    dm_attachment_plaintext = b"dm-secret-attachment"
    dm_result = send_encrypted_dm(owner, member, dm_text, dm_attachment_plaintext)
    dm_doc = mongo_one("direct_messages", {"id": dm_result["message"]["id"]})
    if dm_doc["content"] != "[encrypted]":
        raise AssertionError("Encrypted DM stored plaintext content in Mongo")
    assert_contains_bytes(json.dumps(dm_doc).encode("utf-8"), dm_text.encode("utf-8"), False, "Encrypted DM Mongo document")
    member_dm = next(message for message in assert_ok(member.get(f"/dm/{owner.user['id']}")) if message["id"] == dm_result["message"]["id"])
    decrypted_dm = decrypt_message_payload(member.identity, member.user["id"], member_dm)
    if decrypted_dm["text"] != dm_text:
        raise AssertionError("Recipient could not decrypt the DM text")
    dm_blob_bytes = fetch_minio_ciphertext(dm_result["attachment"]["blob"]["id"])
    assert_contains_bytes(dm_blob_bytes, dm_attachment_plaintext, False, "Encrypted DM blob")
    downloaded_dm_blob = assert_ok(member.get(dm_result["attachment"]["blob"]["url"].replace("/api", ""), headers={"Accept": "application/octet-stream"}))
    if decrypt_attachment(downloaded_dm_blob, decrypted_dm["attachments"][0]) != dm_attachment_plaintext:
        raise AssertionError("Recipient could not decrypt the DM attachment")
    summary["checks"].append("encrypted-dm")

    private_text_plaintext = "private channel secret"
    private_attachment_plaintext = b"private-channel-attachment"
    channel_result = send_encrypted_channel_message(owner, private_text["id"], private_text_plaintext, private_attachment_plaintext, [owner.user["id"], member.user["id"]])
    private_doc = mongo_one("messages", {"id": channel_result["message"]["id"]})
    assert_contains_bytes(json.dumps(private_doc).encode("utf-8"), private_text_plaintext.encode("utf-8"), False, "Encrypted private-channel Mongo document")
    private_message = next(message for message in assert_ok(member.get(f"/channels/{private_text['id']}/messages")) if message["id"] == channel_result["message"]["id"])
    decrypted_private = decrypt_message_payload(member.identity, member.user["id"], private_message)
    if decrypted_private["text"] != private_text_plaintext:
        raise AssertionError("Recipient could not decrypt the private channel text")
    private_blob = fetch_minio_ciphertext(channel_result["attachment"]["blob"]["id"])
    assert_contains_bytes(private_blob, private_attachment_plaintext, False, "Encrypted private-channel blob")
    downloaded_private_blob = assert_ok(member.get(channel_result["attachment"]["blob"]["url"].replace("/api", ""), headers={"Accept": "application/octet-stream"}))
    if decrypt_attachment(downloaded_private_blob, decrypted_private["attachments"][0]) != private_attachment_plaintext:
        raise AssertionError("Recipient could not decrypt the private channel attachment")
    summary["checks"].append("encrypted-private-channel")

    assert_ok(owner.post(f"/messages/{channel_result['message']['id']}/pin"))
    pinned_message = next(message for message in assert_ok(member.get(f"/channels/{private_text['id']}/pins")) if message["id"] == channel_result["message"]["id"])
    if decrypt_message_payload(member.identity, member.user["id"], pinned_message)["text"] != private_text_plaintext:
        raise AssertionError("Pinned encrypted message could not be decrypted")

    thread_recipients = assert_ok(owner.get(f"/e2ee/channels/{private_text['id']}/recipients"))
    encrypted_reply = helper_call("encrypt-message", {"identity": owner.identity, "recipients": thread_recipients, "structuredPayload": {"text": "encrypted thread reply", "attachments": []}})
    thread_reply = assert_ok(owner.post(f"/channels/{private_text['id']}/messages/{channel_result['message']['id']}/reply", {"content": "[Encrypted message]", "attachments": [], "message_type": "thread_reply", **encrypted_reply}))
    reply_entry = next(reply for reply in assert_ok(member.get(f"/messages/{channel_result['message']['id']}/thread"))["replies"] if reply["id"] == thread_reply["id"])
    if decrypt_message_payload(member.identity, member.user["id"], reply_entry)["text"] != "encrypted thread reply":
        raise AssertionError("Encrypted thread reply could not be decrypted")
    summary["checks"].append("pins-and-threads")

    restart_stack()
    member_after_restart = login_fresh(member.email, member.password, member.identity)
    restart_message = next(message for message in assert_ok(member_after_restart.get(f"/channels/{private_text['id']}/messages")) if message["id"] == channel_result["message"]["id"])
    if decrypt_message_payload(member_after_restart.identity, member.user["id"], restart_message)["text"] != private_text_plaintext:
        raise AssertionError("Encrypted private-channel message could not be decrypted after restart")
    summary["checks"].append("restart-persistence")

    media_recipients = assert_ok(owner.get(f"/e2ee/channels/{private_voice['id']}/recipients"))
    assert_ok(owner.post(f"/servers/{server['id']}/voice/{private_voice['id']}/join"))
    owner_only_package = helper_call("build-media-package", {"identity": owner.identity, "recipients": media_recipients, "participant_user_ids": [owner.user["id"]], "key_version": f"{int(time.time())}-owner-only"})
    assert_ok(owner.post(f"/e2ee/media/channels/{private_voice['id']}/rotate", owner_only_package))
    current_owner_package = assert_ok(owner.get(f"/e2ee/media/channels/{private_voice['id']}/current"))
    if not helper_call("open-media-package", {"identity": owner.identity, "key_package": current_owner_package["key_package"]}).get("ok"):
        raise AssertionError("Owner could not open the current media key package")
    if member.get(f"/e2ee/media/channels/{private_voice['id']}/current").status_code != 403:
        raise AssertionError("Non-participant should not fetch encrypted media keys")

    assert_ok(member.post(f"/servers/{server['id']}/voice/{private_voice['id']}/join"))
    both_package = helper_call("build-media-package", {"identity": owner.identity, "recipients": media_recipients, "participant_user_ids": [owner.user["id"], member.user["id"]], "key_version": f"{int(time.time())}-owner-member"})
    assert_ok(owner.post(f"/e2ee/media/channels/{private_voice['id']}/rotate", both_package))
    current_member_package = assert_ok(member.get(f"/e2ee/media/channels/{private_voice['id']}/current"))
    if not helper_call("open-media-package", {"identity": member.identity, "key_package": current_member_package["key_package"]}).get("ok"):
        raise AssertionError("Joined participant could not open the current media key")

    assert_ok(member.post(f"/servers/{server['id']}/voice/{private_voice['id']}/leave"))
    after_leave = helper_call("build-media-package", {"identity": owner.identity, "recipients": media_recipients, "participant_user_ids": [owner.user["id"]], "key_version": f"{int(time.time())}-after-leave"})
    assert_ok(owner.post(f"/e2ee/media/channels/{private_voice['id']}/rotate", after_leave))
    if member.get(f"/e2ee/media/channels/{private_voice['id']}/current").status_code != 403:
        raise AssertionError("User who left voice should not fetch the rotated media key")

    assert_ok(member.post(f"/servers/{server['id']}/voice/{private_voice['id']}/join"))
    before_kick = helper_call("build-media-package", {"identity": owner.identity, "recipients": media_recipients, "participant_user_ids": [owner.user["id"], member.user["id"]], "key_version": f"{int(time.time())}-before-kick"})
    assert_ok(owner.post(f"/e2ee/media/channels/{private_voice['id']}/rotate", before_kick))
    assert_ok(owner.delete(f"/servers/{server['id']}/members/{member.user['id']}"))
    after_kick = helper_call("build-media-package", {"identity": owner.identity, "recipients": media_recipients, "participant_user_ids": [owner.user["id"]], "key_version": f"{int(time.time())}-after-kick"})
    assert_ok(owner.post(f"/e2ee/media/channels/{private_voice['id']}/rotate", after_kick))
    if member.get(f"/e2ee/media/channels/{private_voice['id']}/current").status_code != 403:
        raise AssertionError("Kicked user should not fetch the rotated media key")

    assert_ok(member.post(f"/invites/{invite['code']}/accept"))
    assert_ok(owner.put(f"/channels/{private_text['id']}/access", access_payload))
    assert_ok(owner.put(f"/channels/{private_voice['id']}/access", access_payload))
    assert_ok(member.post(f"/servers/{server['id']}/voice/{private_voice['id']}/join"))
    before_ban = helper_call("build-media-package", {"identity": owner.identity, "recipients": media_recipients, "participant_user_ids": [owner.user["id"], member.user["id"]], "key_version": f"{int(time.time())}-before-ban"})
    assert_ok(owner.post(f"/e2ee/media/channels/{private_voice['id']}/rotate", before_ban))
    assert_ok(owner.post(f"/servers/{server['id']}/moderation/ban", {"user_id": member.user["id"], "reason": "acceptance"}))
    after_ban = helper_call("build-media-package", {"identity": owner.identity, "recipients": media_recipients, "participant_user_ids": [owner.user["id"]], "key_version": f"{int(time.time())}-after-ban"})
    assert_ok(owner.post(f"/e2ee/media/channels/{private_voice['id']}/rotate", after_ban))
    if member.get(f"/e2ee/media/channels/{private_voice['id']}/current").status_code != 403:
        raise AssertionError("Banned user should not fetch the rotated media key")
    summary["checks"].append("encrypted-media-rotation")

    assert_ok(owner.post(f"/e2ee/devices/{extra_device['device_id']}/revoke"))
    refreshed_recipients = assert_ok(member.get(f"/e2ee/dm/{owner.user['id']}/recipients"))
    post_revoke = helper_call("encrypt-message", {"identity": member.identity, "recipients": refreshed_recipients, "structuredPayload": {"text": "post revoke secret", "attachments": []}})
    revoked_dm = assert_ok(member.post(f"/dm/{owner.user['id']}", {"content": "[Encrypted message]", "attachments": [], "message_type": "text", **post_revoke}))
    if helper_call("decrypt-message", {"identity": extra_device, "user_id": "__revoked_device__", "message": revoked_dm}).get("ok"):
        raise AssertionError("Revoked device should not decrypt fresh encrypted DMs")
    summary["checks"].append("device-revoke")

    recovery_device = helper_call("generate-device", {"deviceName": "Recovery Device"})
    recovery_client = login_fresh(owner.email, owner.password, recovery_device)
    assert_ok(recovery_client.post("/e2ee/devices", {"device_id": recovery_device["device_id"], "device_name": recovery_device["device_name"], "device_public_key": recovery_device["device_public_key"]}))
    recovery_bundle = assert_ok(recovery_client.get("/e2ee/recovery/account"))
    recovery_device["recovery_public_key"] = recovery_bundle["recovery_public_key"]
    recovery_device["recovery_private_key"] = owner.identity["recovery_private_key"]
    assert_ok(recovery_client.post(f"/e2ee/devices/{recovery_device['device_id']}/verify-recovery"))
    recovered_dm = next(message for message in assert_ok(recovery_client.get(f"/dm/{member.user['id']}")) if message["id"] == dm_result["message"]["id"])
    if decrypt_message_payload(recovery_device, owner.user["id"], recovered_dm)["text"] != dm_text:
        raise AssertionError("Recovery-verified device could not decrypt historical encrypted DMs")
    summary["checks"].append("recovery-decrypts-history")
    return summary


if __name__ == "__main__":
    print(json.dumps(run_acceptance(), indent=2))
