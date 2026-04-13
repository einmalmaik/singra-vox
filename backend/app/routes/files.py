# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox – Local file-storage routes
=========================================

Privacy-first Design
--------------------
* Jede hochgeladene Datei wird unter einem UUID-Dateinamen gespeichert –
  der Originalname ist NIEMALS Teil des Pfads.
* Dateien werden auf dem Dateisystem AES-256-GCM verschlüsselt gespeichert.
* Metadaten (Originalname, Content-Type) werden in der DB verschlüsselt.
* Es werden nur die absolut notwendigen Metadaten gespeichert.
* Nur authentifizierte Benutzer mit entsprechender Berechtigung können
  auf Dateien zugreifen.

Speicher-Layout
---------------
    <UPLOAD_ROOT>/<YYYY-MM>/<uuid>   (verschlüsselte Bytes)

Verschlüsselungs-Schichten
---------------------------
    1. Datei-Bytes → encrypt_file_bytes(file_id, bytes) → Disk
    2. Originalname → encrypt_metadata("file_meta:<id>", name) → MongoDB
    3. Content-Type → encrypt_metadata("file_ct:<id>", ct) → MongoDB
    4. Klartext existiert NUR im RAM während der Verarbeitung

Routes
------
    POST   /api/upload           Datei hochladen (JSON, base64)
    POST   /api/upload/multipart Datei hochladen (Multipart, große Dateien)
    GET    /api/files/{file_id}  Datei abrufen / streamen
    DELETE /api/files/{file_id}  Eigene Datei löschen (oder Admin)
"""

from __future__ import annotations

import base64
import logging
import pathlib

from fastapi import APIRouter, HTTPException, Request, UploadFile, File as FastAPIFile
from fastapi.responses import Response
from pydantic import BaseModel

from app.auth_service import load_current_user
from app.core.config import UPLOAD_ROOT
from app.core.database import db
from app.core.utils import now_utc, new_id
from app.core.constants import MAX_UPLOAD_BYTES, INLINE_MIME_PREFIXES
from app.core.encryption import (
    encryption_enabled,
    encrypt_file_bytes,
    decrypt_file_bytes,
    encrypt_metadata,
    decrypt_metadata,
)
from app.permissions import assert_channel_permission

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["files"])

# ── Storage root ──────────────────────────────────────────────────────────────
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_content_type(raw: str | None) -> str:
    """Sicherer Content-Type, Standard ist octet-stream."""
    ct = (raw or "application/octet-stream").split(";")[0].strip().lower()
    if "/" not in ct:
        return "application/octet-stream"
    return ct


def _storage_path(file_id: str, created_at: str) -> pathlib.Path:
    """Ableitung des Speicherpfads aus File-ID und Erstellungsdatum."""
    month = created_at[:7]
    directory = UPLOAD_ROOT / month
    directory.mkdir(parents=True, exist_ok=True)
    return directory / file_id


async def _get_current_user(request: Request) -> dict:
    """Authentifizierten User aus dem Request extrahieren."""
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


def _encrypt_file_record(file_id: str, original_name: str, content_type: str) -> tuple[str, str]:
    """
    Verschlüsselt sensible Metadaten einer Datei für die DB-Speicherung.

    Returns:
        (verschlüsselter_name, verschlüsselter_content_type)
    """
    enc_name = encrypt_metadata(f"file_meta:{file_id}", original_name)
    enc_ct = encrypt_metadata(f"file_ct:{file_id}", content_type)
    return enc_name, enc_ct


def _decrypt_file_record(file_id: str, stored_name: str, stored_ct: str) -> tuple[str, str]:
    """
    Entschlüsselt Datei-Metadaten aus der DB.

    Returns:
        (klartext_name, klartext_content_type)
    """
    name = decrypt_metadata(f"file_meta:{file_id}", stored_name)
    ct = decrypt_metadata(f"file_ct:{file_id}", stored_ct)
    return name, ct


# ── Input model ───────────────────────────────────────────────────────────────

class UploadJsonBody(BaseModel):
    """JSON Upload-Payload (für Avatare und kleine Dateien)."""
    data: str
    name: str
    type: str
    channel_id: str | None = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_file(body: UploadJsonBody, request: Request) -> dict:
    """Datei hochladen (Base64-JSON).

    Ablauf:
        1. Authentifizierung + Berechtigungsprüfung
        2. Base64 dekodieren → Rohe Bytes im RAM
        3. Bytes verschlüsseln → Verschlüsselte Bytes auf Disk
        4. Metadaten verschlüsseln → Verschlüsselter Record in MongoDB
        5. Klartext existiert nur temporär im RAM
    """
    user = await _get_current_user(request)

    if body.channel_id:
        channel = await db.channels.find_one({"id": body.channel_id}, {"_id": 0})
        if channel:
            await assert_channel_permission(
                db, user["id"], channel, "attach_files",
                "Keine Berechtigung, Dateien in diesem Kanal hochzuladen"
            )

    raw_bytes = base64.b64decode(body.data)
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the maximum allowed size")

    content_type = _safe_content_type(body.type)
    file_id = new_id()
    created_at = now_utc()
    safe_name = pathlib.Path(body.name).name

    # Verschlüsseln: Bytes für Disk, Metadaten für DB
    encrypted_bytes = encrypt_file_bytes(file_id, raw_bytes)
    enc_name, enc_ct = _encrypt_file_record(file_id, safe_name, content_type)

    record = {
        "id": file_id,
        "original_name": enc_name,
        "content_type": enc_ct,
        "size_bytes": len(raw_bytes),
        "encrypted_size_bytes": len(encrypted_bytes),
        "uploaded_by": user["id"],
        "channel_id": body.channel_id or None,
        "is_public": body.channel_id is None,
        "encrypted_at_rest": encryption_enabled(),
        "created_at": created_at,
    }
    await db.files.insert_one(record)

    dest = _storage_path(file_id, created_at)
    dest.write_bytes(encrypted_bytes)
    log.debug("Stored %d bytes (enc: %d) → %s", len(raw_bytes), len(encrypted_bytes), dest)

    return {
        "id": file_id,
        "url": f"/api/files/{file_id}",
        "content_type": content_type,
        "size_bytes": len(raw_bytes),
    }


@router.post("/upload/multipart")
async def upload_multipart(
    request: Request,
    file: UploadFile = FastAPIFile(...),
    channel_id: str | None = None,
) -> dict:
    """Datei hochladen (Multipart, für große Dateien und Desktop-App)."""
    user = await _get_current_user(request)

    if channel_id:
        channel = await db.channels.find_one({"id": channel_id}, {"_id": 0})
        if channel:
            await assert_channel_permission(
                db, user["id"], channel, "attach_files",
                "Keine Berechtigung, Dateien in diesem Kanal hochzuladen"
            )

    raw_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the maximum allowed size")

    content_type = _safe_content_type(file.content_type)
    file_id = new_id()
    created_at = now_utc()
    safe_name = pathlib.Path(file.filename or "upload").name

    # Verschlüsseln
    encrypted_bytes = encrypt_file_bytes(file_id, raw_bytes)
    enc_name, enc_ct = _encrypt_file_record(file_id, safe_name, content_type)

    record = {
        "id": file_id,
        "original_name": enc_name,
        "content_type": enc_ct,
        "size_bytes": len(raw_bytes),
        "encrypted_size_bytes": len(encrypted_bytes),
        "uploaded_by": user["id"],
        "channel_id": channel_id or None,
        "is_public": channel_id is None,
        "encrypted_at_rest": encryption_enabled(),
        "created_at": created_at,
    }
    await db.files.insert_one(record)

    dest = _storage_path(file_id, created_at)
    dest.write_bytes(encrypted_bytes)
    log.debug("Multipart %d bytes (enc: %d) → %s", len(raw_bytes), len(encrypted_bytes), dest)

    return {
        "id": file_id,
        "url": f"/api/files/{file_id}",
        "content_type": content_type,
        "size_bytes": len(raw_bytes),
    }


@router.get("/files/{file_id}")
async def get_file(file_id: str, request: Request) -> Response:
    """Datei abrufen – entschlüsselt und mit korrektem Content-Type.

    Berechtigungsregeln:
        - Öffentliche Dateien (Avatare): jeder authentifizierte User
        - Kanal-Anhänge: User braucht read_messages im Kanal
    """
    user = await _get_current_user(request)

    record = await db.files.find_one({"id": file_id}, {"_id": 0})
    if not record:
        raise HTTPException(404, "File not found")

    # Berechtigungsprüfung
    if not record.get("is_public") and record.get("channel_id"):
        channel = await db.channels.find_one(
            {"id": record["channel_id"]}, {"_id": 0}
        )
        if channel:
            await assert_channel_permission(
                db, user["id"], channel, "read_messages",
                "Keine Berechtigung, Dateien aus diesem Kanal abzurufen"
            )

    path = _storage_path(file_id, record["created_at"])
    if not path.exists():
        raise HTTPException(404, "File data not found on server")

    # Lesen und entschlüsseln
    encrypted_bytes = path.read_bytes()
    if record.get("encrypted_at_rest"):
        decrypted_bytes = decrypt_file_bytes(file_id, encrypted_bytes)
    else:
        decrypted_bytes = encrypted_bytes

    # Metadaten entschlüsseln
    if record.get("encrypted_at_rest"):
        original_name, content_type = _decrypt_file_record(
            file_id,
            record.get("original_name", "file"),
            record.get("content_type", "application/octet-stream"),
        )
    else:
        original_name = record.get("original_name", "file")
        content_type = record.get("content_type", "application/octet-stream")

    is_inline = any(content_type.startswith(p) for p in INLINE_MIME_PREFIXES)
    disposition = "inline" if is_inline else "attachment"

    return Response(
        content=decrypted_bytes,
        media_type=content_type,
        headers={
            "Content-Disposition": f'{disposition}; filename="{original_name}"',
            "Cache-Control": "private, no-store",
            "Content-Length": str(len(decrypted_bytes)),
        },
    )


@router.delete("/files/{file_id}", status_code=204, response_model=None)
async def delete_file(file_id: str, request: Request) -> None:
    """Datei löschen – nur Uploader oder Instanz-Admin."""
    user = await _get_current_user(request)

    record = await db.files.find_one({"id": file_id}, {"_id": 0})
    if not record:
        raise HTTPException(404, "File not found")

    is_owner = record.get("uploaded_by") == user["id"]
    is_admin = user.get("instance_role") in ("admin", "owner")
    if not is_owner and not is_admin:
        raise HTTPException(403, "Cannot delete this file")

    path = _storage_path(file_id, record["created_at"])
    if path.exists():
        path.unlink()

    await db.files.delete_one({"id": file_id})
