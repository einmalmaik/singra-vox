# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox ID – Password Utilities
====================================

Password strength validation, scoring, and secure generation.

Policy (configurable via identity/config.py):
    - Minimum 10 characters
    - Must contain: uppercase, lowercase, digit, special character
    - Common / breached passwords are rejected
    - Strength score 0–4 returned for UI feedback

The generator creates cryptographically secure passwords that always
satisfy the policy so users can fall back to an auto-generated password.
"""
import re
import secrets
import string

from app.identity.config import SVID_PASSWORD_MIN_LENGTH, SVID_PASSWORD_MAX_LENGTH


# ── Common weak passwords (top patterns to reject) ──────────────────────────
_COMMON_PASSWORDS = frozenset([
    "password", "12345678", "123456789", "1234567890", "qwerty",
    "abcdefgh", "letmein", "welcome", "monkey", "dragon",
    "master", "login", "princess", "football", "shadow",
    "sunshine", "trustno1", "iloveyou", "batman", "access",
    "hello", "charlie", "donald", "password1", "password123",
    "qwerty123", "abc123", "111111", "123123", "admin",
    "passw0rd", "p@ssw0rd", "p@ssword",
])

# Characters that the sequential detector considers "runs"
_SEQUENTIAL_PATTERNS = [
    "abcdefghijklmnopqrstuvwxyz",
    "0123456789",
    "qwertyuiop",
    "asdfghjkl",
    "zxcvbnm",
]


def _has_sequential_run(password: str, run_length: int = 4) -> bool:
    """Detect keyboard / alphabet runs of *run_length* or more."""
    lower = password.lower()
    for pattern in _SEQUENTIAL_PATTERNS:
        for i in range(len(pattern) - run_length + 1):
            segment = pattern[i:i + run_length]
            if segment in lower or segment[::-1] in lower:
                return True
    return False


def check_password_strength(password: str) -> dict:
    """
    Analyse a password and return a structured report.

    Returns:
        {
            "score": 0-4,           # 0=very weak, 4=very strong
            "label": "strong",      # human-readable label
            "feedback": ["..."],    # list of improvement suggestions
            "meets_policy": True,   # True if all requirements met
            "checks": {
                "length": True,
                "uppercase": True,
                "lowercase": True,
                "digit": True,
                "special": True,
                "not_common": True,
                "no_sequential": True,
            }
        }
    """
    feedback = []
    checks = {
        "length": len(password) >= SVID_PASSWORD_MIN_LENGTH,
        "uppercase": bool(re.search(r"[A-Z]", password)),
        "lowercase": bool(re.search(r"[a-z]", password)),
        "digit": bool(re.search(r"\d", password)),
        "special": bool(re.search(r"[^A-Za-z0-9]", password)),
        "not_common": password.lower().strip() not in _COMMON_PASSWORDS,
        "no_sequential": not _has_sequential_run(password),
    }

    if not checks["length"]:
        feedback.append(f"Minimum {SVID_PASSWORD_MIN_LENGTH} characters required")
    if not checks["uppercase"]:
        feedback.append("Add at least one uppercase letter (A-Z)")
    if not checks["lowercase"]:
        feedback.append("Add at least one lowercase letter (a-z)")
    if not checks["digit"]:
        feedback.append("Add at least one number (0-9)")
    if not checks["special"]:
        feedback.append("Add at least one special character (!@#$...)")
    if not checks["not_common"]:
        feedback.append("This password is too common – choose something unique")
    if not checks["no_sequential"]:
        feedback.append("Avoid sequential characters (abc, 1234, qwerty)")

    # Score: each passed check contributes, bonus for length
    passed = sum(checks.values())
    length_bonus = min(2, max(0, (len(password) - SVID_PASSWORD_MIN_LENGTH) // 4))
    raw_score = passed + length_bonus

    if raw_score <= 3:
        score, label = 0, "very_weak"
    elif raw_score <= 5:
        score, label = 1, "weak"
    elif raw_score <= 7:
        score, label = 2, "fair"
    elif raw_score <= 8:
        score, label = 3, "strong"
    else:
        score, label = 4, "very_strong"

    meets_policy = all(checks.values())

    return {
        "score": score,
        "label": label,
        "feedback": feedback,
        "meets_policy": meets_policy,
        "checks": checks,
    }


def validate_password_policy(password: str) -> list:
    """
    Validate a password against the policy.

    Returns:
        List of error messages.  Empty list = password is acceptable.
    """
    if len(password) > SVID_PASSWORD_MAX_LENGTH:
        return [f"Password must not exceed {SVID_PASSWORD_MAX_LENGTH} characters"]

    result = check_password_strength(password)
    return result["feedback"] if not result["meets_policy"] else []


def generate_secure_password(length: int = 16) -> str:
    """
    Generate a cryptographically secure password that always meets the policy.

    The generated password contains:
        - At least 2 uppercase letters
        - At least 2 lowercase letters
        - At least 2 digits
        - At least 2 special characters
        - Remaining characters are random from the full set

    Returns:
        A password string of the requested length (minimum 12).
    """
    length = max(12, min(length, 64))

    uppercase = string.ascii_uppercase
    lowercase = string.ascii_lowercase
    digits = string.digits
    special = "!@#$%^&*()-_=+[]{}|;:,.<>?"

    # Guarantee minimum diversity
    password_chars = [
        secrets.choice(uppercase),
        secrets.choice(uppercase),
        secrets.choice(lowercase),
        secrets.choice(lowercase),
        secrets.choice(digits),
        secrets.choice(digits),
        secrets.choice(special),
        secrets.choice(special),
    ]

    # Fill the rest from the full alphabet
    full_alphabet = uppercase + lowercase + digits + special
    for _ in range(length - len(password_chars)):
        password_chars.append(secrets.choice(full_alphabet))

    # Shuffle to avoid predictable positions
    shuffled = list(password_chars)
    secrets.SystemRandom().shuffle(shuffled)

    return "".join(shuffled)
