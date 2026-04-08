from __future__ import annotations

import os
import re
import secrets
from pathlib import Path

from dotenv import load_dotenv

from app.auth_service import normalize_jwt_secret


ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

APP_NAME = "Singra Vox"
JWT_ALG = "HS256"

jwt_secret = normalize_jwt_secret(os.environ.get("JWT_SECRET", secrets.token_hex(32)))
cookie_secure = os.environ.get("COOKIE_SECURE", "false").lower() == "true"

livekit_url = os.environ.get("LIVEKIT_URL", "").strip()
livekit_api_key = os.environ.get("LIVEKIT_API_KEY", "").strip()
livekit_api_secret = os.environ.get("LIVEKIT_API_SECRET", "").strip()
livekit_public_url = os.environ.get("LIVEKIT_PUBLIC_URL", "").strip() or livekit_url

default_frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000").strip()
configured_cors = [
    origin.strip()
    for origin in os.environ.get("CORS_ORIGINS", default_frontend_url).split(",")
    if origin.strip()
]
default_dev_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
]
allow_origins = list(dict.fromkeys(configured_cors + default_dev_origins))
tauri_origin_re = re.compile(
    r"^(?:https?://(?:localhost|127\.0\.0\.1)(?::\d+)?|tauri://localhost|https://tauri\.localhost)$"
)

VOICE_CLEANUP_GRACE_SECONDS = 30

INSTANCE_SETTINGS_ID = "instance:primary"
OWNER_ROLE = "owner"
ADMIN_ROLE = "admin"
USER_ROLE = "user"

EMAIL_VERIFICATION_TTL_MINUTES = int(os.environ.get("EMAIL_VERIFICATION_TTL_MINUTES", "15"))
EMAIL_VERIFICATION_PURPOSE = "verify_email"
PASSWORD_RESET_TTL_MINUTES = int(os.environ.get("PASSWORD_RESET_TTL_MINUTES", "15"))
PASSWORD_RESET_PURPOSE = "password_reset"
EMAIL_VERIFICATION_CODE_LENGTH = 6

USERNAME_PATTERN = re.compile(r"^[a-z0-9_]{3,32}$")
