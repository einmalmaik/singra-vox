# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox ID – TOTP Two-Factor Authentication
================================================

Implements Time-based One-Time Passwords (RFC 6238) for optional 2FA.

Usage:
    1. User calls POST /api/id/2fa/setup  → receives secret + QR URI
    2. User scans QR with Google Authenticator / Authy
    3. User confirms with POST /api/id/2fa/confirm {code: "123456"}
    4. From now on, login requires password + TOTP code
    5. Backup codes are provided for recovery

Security:
    - TOTP secrets are stored encrypted-at-rest (if DB encryption is enabled)
    - Each backup code is single-use and bcrypt-hashed
    - Clock drift tolerance: ±1 interval (30 seconds)
"""
import secrets
import string

import pyotp

from app.identity.config import (
    SVID_BACKUP_CODES_COUNT,
    SVID_TOTP_DIGITS,
    SVID_TOTP_INTERVAL,
    SVID_TOTP_ISSUER_NAME,
)


def generate_totp_secret() -> str:
    """Generate a new base32-encoded TOTP secret."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str) -> str:
    """
    Build an otpauth:// URI suitable for QR code scanning.

    Compatible with Google Authenticator, Authy, 1Password, Bitwarden, etc.
    """
    totp = pyotp.TOTP(secret, digits=SVID_TOTP_DIGITS, interval=SVID_TOTP_INTERVAL)
    return totp.provisioning_uri(name=email, issuer_name=SVID_TOTP_ISSUER_NAME)


def verify_totp_code(secret: str, code: str) -> bool:
    """
    Verify a TOTP code with ±1 interval tolerance (valid_window=1).

    This accounts for up to 30 seconds of clock drift between the
    server and the authenticator app.
    """
    totp = pyotp.TOTP(secret, digits=SVID_TOTP_DIGITS, interval=SVID_TOTP_INTERVAL)
    return totp.verify(code, valid_window=1)


def generate_backup_codes(count: int = SVID_BACKUP_CODES_COUNT) -> list:
    """
    Generate a set of single-use backup codes.

    Each code is 8 characters, uppercase alphanumeric, formatted as
    XXXX-XXXX for readability.

    Returns:
        List of plaintext backup codes (to show to user ONCE).
    """
    alphabet = string.ascii_uppercase + string.digits
    codes = []
    for _ in range(count):
        raw = "".join(secrets.choice(alphabet) for _ in range(8))
        codes.append(f"{raw[:4]}-{raw[4:]}")
    return codes


def normalize_backup_code(code: str) -> str:
    """Strip dashes and whitespace, uppercase – for comparison."""
    return code.replace("-", "").replace(" ", "").upper().strip()
