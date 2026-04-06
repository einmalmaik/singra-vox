# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
# Re-export so callers can do `from app.core import db, now_utc, new_id`
from .database import db, close          # noqa: F401
from .utils import now_utc, new_id, sanitize_user  # noqa: F401
from .constants import (                 # noqa: F401
    E2EE_DEVICE_HEADER,
    E2EE_PROTOCOL_VERSION,
    MAX_E2EE_BLOB_BYTES,
    MAX_UPLOAD_BYTES,
    INLINE_MIME_PREFIXES,
    CLIENT_PLATFORM_HEADER,
)
