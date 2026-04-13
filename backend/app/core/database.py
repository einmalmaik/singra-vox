# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox – Shared MongoDB handle
===================================
All backend modules import `db` from this file so the whole application
uses a *single* Motor connection pool.

Usage
-----
    from app.core.database import db

    await db.users.find_one({"id": user_id}, {"_id": 0})
"""

import os

from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import ROOT_DIR  # noqa: F401

# Read once at import time so every module sees the same client.
_mongo_url: str = os.environ["MONGO_URL"]
_db_name: str = os.environ["DB_NAME"]

_client = AsyncIOMotorClient(_mongo_url)

#: The active Motor database.  Import this symbol everywhere.
db = _client[_db_name]


def close() -> None:
    """Gracefully close the MongoDB connection pool on shutdown."""
    _client.close()
