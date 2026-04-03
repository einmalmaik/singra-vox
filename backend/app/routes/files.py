"""
Singra Vox – Local file-storage routes
=========================================
Replaces the legacy base-64-in-MongoDB approach with a proper
local-filesystem store.

Privacy-first design
--------------------
* Every uploaded file is stored under a UUID filename – the original
  name is **never** part of the file path, making it non-guessable.
* The content-type comes from the database record, not from the URL.
* Only authenticated users can access files.
* Avatars are flagged as ``is_public=True`` and need no extra channel
  permission check; other attachments inherit the permission of the
  channel they were uploaded in.

Storage layout
--------------
    <UPLOAD_ROOT>/<YYYY-MM>/<uuid>

The ``UPLOAD_ROOT`` defaults to  ``/app/backend/storage/uploads``
and can be overridden with the ``UPLOAD_ROOT`` environment variable.

Routes registered
-----------------
    POST   /api/upload           Upload a file (JSON or multipart).
    GET    /api/files/{file_id}  Retrieve / stream a file.
    DELETE /api/files/{file_id}  Delete own file (or admin).
"""

from __future__ import annotations

import base64
import logging
import mimetypes
import os
import pathlib
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File as FastAPIFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.auth_service import load_current_user
from app.core.database import db
from app.core.utils import now_utc, new_id
from app.core.constants import MAX_UPLOAD_BYTES, INLINE_MIME_PREFIXES

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["files"])

# ── Storage root ──────────────────────────────────────────────────────────────
UPLOAD_ROOT = pathlib.Path(
    os.environ.get("UPLOAD_ROOT", "/app/backend/storage/uploads")
)
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_content_type(raw: str | None) -> str:
    """Return a safe content-type string, defaulting to octet-stream."""
    ct = (raw or "application/octet-stream").split(";")[0].strip().lower()
    if "/" not in ct:
        return "application/octet-stream"
    return ct


def _storage_path(file_id: str, created_at: str) -> pathlib.Path:
    """Derive the on-disk path from the file ID and creation timestamp."""
    month = created_at[:7]  # "YYYY-MM"
    directory = UPLOAD_ROOT / month
    directory.mkdir(parents=True, exist_ok=True)
    return directory / file_id


async def _get_current_user(request: Request) -> dict:
    """Extract the authenticated user from the request state."""
    user, _ = await load_current_user(db, request)
    user.pop("password_hash", None)
    return user


# ── Input model ───────────────────────────────────────────────────────────────

class UploadJsonBody(BaseModel):
    """JSON upload payload (used for avatar uploads and small files)."""
    data: str           # base-64 encoded file bytes
    name: str           # original filename (stored in metadata, never in path)
    type: str           # MIME type as reported by the client
    channel_id: str | None = None  # when set, file is tied to a channel


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_file(body: UploadJsonBody, request: Request) -> dict:
    """Upload a file encoded as base-64 JSON.

    Returns the file metadata including the URL to retrieve the file.
    The original filename is stored only in the metadata record – it is
    never part of the public URL or the filesystem path.
    """
    user = await _get_current_user(request)

    raw_bytes = base64.b64decode(body.data)
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the maximum allowed size")

    content_type = _safe_content_type(body.type)
    file_id = new_id()
    created_at = now_utc()

    record = {
        "id": file_id,
        "original_name": pathlib.Path(body.name).name,  # strip any path traversal
        "content_type": content_type,
        "size_bytes": len(raw_bytes),
        "uploaded_by": user["id"],
        "channel_id": body.channel_id or None,
        "is_public": body.channel_id is None,  # avatar / profile images are public
        "created_at": created_at,
    }
    await db.files.insert_one(record)

    dest = _storage_path(file_id, created_at)
    dest.write_bytes(raw_bytes)
    log.debug("Stored %d bytes → %s (type=%s)", len(raw_bytes), dest, content_type)

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
    """Upload a file using multipart/form-data (large files, desktop app)."""
    user = await _get_current_user(request)

    raw_bytes = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File exceeds the maximum allowed size")

    content_type = _safe_content_type(file.content_type)
    file_id = new_id()
    created_at = now_utc()

    record = {
        "id": file_id,
        "original_name": pathlib.Path(file.filename or "upload").name,
        "content_type": content_type,
        "size_bytes": len(raw_bytes),
        "uploaded_by": user["id"],
        "channel_id": channel_id or None,
        "is_public": channel_id is None,
        "created_at": created_at,
    }
    await db.files.insert_one(record)

    dest = _storage_path(file_id, created_at)
    dest.write_bytes(raw_bytes)
    log.debug("Multipart %d bytes → %s (type=%s)", len(raw_bytes), dest, content_type)

    return {
        "id": file_id,
        "url": f"/api/files/{file_id}",
        "content_type": content_type,
        "size_bytes": len(raw_bytes),
    }


@router.get("/files/{file_id}")
async def get_file(file_id: str, request: Request) -> StreamingResponse:
    """Retrieve a stored file.

    Permission rules
    ----------------
    * Public files (avatars, profile assets) – any authenticated user.
    * Channel attachments – user must be able to see the channel.
    """
    user = await _get_current_user(request)

    record = await db.files.find_one({"id": file_id}, {"_id": 0})
    if not record:
        raise HTTPException(404, "File not found")

    # Permission check for private channel attachments
    if not record.get("is_public") and record.get("channel_id"):
        channel = await db.channels.find_one(
            {"id": record["channel_id"]}, {"_id": 0}
        )
        if channel and channel.get("is_private"):
            from app.permissions import has_channel_permission
            perms_ok = await has_channel_permission(
                db, user["id"], channel, "read_messages"
            )
            if not perms_ok:
                raise HTTPException(403, "You do not have access to this file")

    path = _storage_path(file_id, record["created_at"])
    if not path.exists():
        raise HTTPException(404, "File data not found on server")

    content_type: str = record.get("content_type", "application/octet-stream")
    is_inline = any(content_type.startswith(p) for p in INLINE_MIME_PREFIXES)
    disposition = "inline" if is_inline else "attachment"
    safe_name = record.get("original_name", file_id)

    def _stream():
        with path.open("rb") as fh:
            while chunk := fh.read(65_536):
                yield chunk

    return StreamingResponse(
        _stream(),
        media_type=content_type,
        headers={
            "Content-Disposition": f'{disposition}; filename="{safe_name}"',
            "Cache-Control": "private, max-age=86400",
            "Content-Length": str(record["size_bytes"]),
        },
    )


@router.delete("/files/{file_id}", status_code=204, response_model=None)
async def delete_file(file_id: str, request: Request) -> None:
    """Delete a file.  Only the uploader or an instance admin may delete."""
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
