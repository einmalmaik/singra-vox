# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox ID – Configuration
==============================

All identity-server settings are loaded from environment variables.
Defaults are chosen to work out-of-the-box in development, but every
value SHOULD be set explicitly in production.
"""
import os
import secrets


# ── Issuer URL ──────────────────────────────────────────────────────────────
# The canonical URL of this Singra Vox ID server.  Used in JWT `iss` claims,
# OpenID Connect discovery, and as the server identifier in federated setups.
SVID_ISSUER = os.environ.get("SVID_ISSUER", "https://voxid.mauntingstudios.de").strip()

# ── JWT Signing ─────────────────────────────────────────────────────────────
SVID_JWT_SECRET = os.environ.get("SVID_JWT_SECRET", "").strip() or secrets.token_hex(32)
SVID_JWT_ALG = "HS256"
SVID_ACCESS_TOKEN_TTL_MINUTES = int(os.environ.get("SVID_ACCESS_TOKEN_TTL_MINUTES", "30"))
SVID_REFRESH_TOKEN_TTL_DAYS = int(os.environ.get("SVID_REFRESH_TOKEN_TTL_DAYS", "30"))

# ── OAuth2 ──────────────────────────────────────────────────────────────────
SVID_OAUTH_CODE_TTL_SECONDS = 300  # 5 minutes – RFC 6749 recommendation

# ── Email Verification ──────────────────────────────────────────────────────
SVID_EMAIL_VERIFICATION_TTL_MINUTES = 15
SVID_PASSWORD_RESET_TTL_MINUTES = 15

# ── Password Policy ─────────────────────────────────────────────────────────
SVID_PASSWORD_MIN_LENGTH = 10
SVID_PASSWORD_MAX_LENGTH = 256

# ── 2FA ─────────────────────────────────────────────────────────────────────
SVID_TOTP_ISSUER_NAME = "Singra Vox ID"
SVID_TOTP_DIGITS = 6
SVID_TOTP_INTERVAL = 30  # seconds
SVID_BACKUP_CODES_COUNT = 8

# ── Username Policy ─────────────────────────────────────────────────────────
SVID_USERNAME_MIN_LENGTH = 3
SVID_USERNAME_MAX_LENGTH = 32
