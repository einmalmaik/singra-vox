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

# Read once at import time so every module sees the same client.
_mongo_url: str = os.environ["MONGO_URL"]
_db_name: str = os.environ["DB_NAME"]

_client: AsyncIOMotorClient = AsyncIOMotorClient(_mongo_url)

#: The active Motor database.  Import this symbol everywhere.
db = _client[_db_name]


def close() -> None:
    """Gracefully close the MongoDB connection pool on shutdown."""
    _client.close()
