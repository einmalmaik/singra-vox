# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox – Shared utility helpers
=====================================
Pure functions with no external dependencies.  Import from anywhere.
"""

import uuid
from datetime import datetime, timezone


def now_utc() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    """Generate a random UUID-4 as a lowercase string."""
    return str(uuid.uuid4())


def sanitize_user(user: dict) -> dict:
    """Strip internal fields from a user document before sending to clients."""
    return {
        k: v
        for k, v in user.items()
        if k not in ("password_hash", "_id")
    }
