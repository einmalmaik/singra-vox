from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
from typing import Optional

from fastapi import HTTPException
from pymongo import ReturnDocument


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def hash_rate_limit_key(scope: str, key: str) -> str:
    return hashlib.sha256(f"{scope}:{key}".encode("utf-8")).hexdigest()


async def enforce_fixed_window_rate_limit(
    db,
    *,
    scope: str,
    key: str,
    limit: int,
    window_seconds: int,
    error_message: str,
    status_code: int = 429,
    code: str = "rate_limited",
    now: Optional[datetime] = None,
):
    if limit <= 0:
        return

    current_time = now or utc_now()
    window_id = int(current_time.timestamp()) // window_seconds
    window_start = datetime.fromtimestamp(window_id * window_seconds, tz=timezone.utc)
    expires_at = window_start + timedelta(seconds=window_seconds * 2)
    key_hash = hash_rate_limit_key(scope, key)

    document = await db.rate_limits.find_one_and_update(
        {
            "scope": scope,
            "key_hash": key_hash,
            "window_id": window_id,
        },
        {
            "$inc": {"count": 1},
            "$setOnInsert": {
                "scope": scope,
                "key_hash": key_hash,
                "window_id": window_id,
                "window_started_at": window_start.isoformat(),
                "expires_at": expires_at.isoformat(),
            },
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
        projection={"_id": 0, "count": 1},
    )

    if (document or {}).get("count", 0) > limit:
        raise HTTPException(
            status_code,
            {
                "code": code,
                "message": error_message,
                "retry_after_seconds": window_seconds,
            },
        )
