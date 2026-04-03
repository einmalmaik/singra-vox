"""
Singra Vox – Application-wide constants
==========================================
Single source of truth for magic strings and configuration defaults.
"""

import os

# ── E2EE ──────────────────────────────────────────────────────────────────────
#: HTTP request header carrying the active device ID for E2EE operations.
E2EE_DEVICE_HEADER: str = "X-Singra-Device-Id"
#: Encryption protocol version tag embedded in every encrypted message.
E2EE_PROTOCOL_VERSION: str = "sv-e2ee-v1"
#: Maximum size in bytes for an encrypted blob attachment (default 50 MB).
MAX_E2EE_BLOB_BYTES: int = int(os.environ.get("MAX_E2EE_BLOB_BYTES", 52_428_800))

# ── Uploads ───────────────────────────────────────────────────────────────────
#: Maximum unencrypted file size (default 50 MB).
MAX_UPLOAD_BYTES: int = 52_428_800
#: MIME types that are served inline (displayed in-browser / in-app).
INLINE_MIME_PREFIXES: tuple[str, ...] = ("image/", "video/", "audio/")

# ── Client platforms ──────────────────────────────────────────────────────────
#: Header used to identify the client platform (web / desktop).
CLIENT_PLATFORM_HEADER: str = "X-Singra-Client-Platform"
