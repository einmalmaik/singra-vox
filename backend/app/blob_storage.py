"""
Helpers for storing ciphertext-only blobs in an S3-compatible backend.

The backend never encrypts or decrypts attachment payloads itself. It only
persists opaque ciphertext objects so the application can switch between local
MinIO and managed S3 without touching the message routes.
"""
from __future__ import annotations

import asyncio
import io
import os
from typing import Optional

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError


def _storage_config() -> dict:
    return {
        "endpoint_url": os.environ.get("S3_ENDPOINT_URL", "").strip() or None,
        "region_name": os.environ.get("S3_REGION", "us-east-1").strip() or "us-east-1",
        "aws_access_key_id": os.environ.get("S3_ACCESS_KEY", "").strip() or None,
        "aws_secret_access_key": os.environ.get("S3_SECRET_KEY", "").strip() or None,
        "bucket": os.environ.get("S3_BUCKET", "singravox-e2ee").strip() or "singravox-e2ee",
        "force_path_style": os.environ.get("S3_FORCE_PATH_STYLE", "true").lower() == "true",
    }


def _build_client():
    cfg = _storage_config()
    session = boto3.session.Session()
    return session.client(
        "s3",
        endpoint_url=cfg["endpoint_url"],
        region_name=cfg["region_name"],
        aws_access_key_id=cfg["aws_access_key_id"],
        aws_secret_access_key=cfg["aws_secret_access_key"],
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path" if cfg["force_path_style"] else "auto"},
        ),
    )


def _bucket_name() -> str:
    return _storage_config()["bucket"]


def _has_s3_credentials() -> bool:
    cfg = _storage_config()
    return bool(cfg.get("endpoint_url") or (cfg.get("aws_access_key_id") and cfg.get("aws_secret_access_key")))


def _ensure_bucket_sync() -> None:
    if not _has_s3_credentials():
        import logging
        logging.getLogger(__name__).warning(
            "S3 credentials not configured – encrypted blob storage disabled. "
            "Set S3_ENDPOINT_URL + S3_ACCESS_KEY + S3_SECRET_KEY to enable."
        )
        return
    client = _build_client()
    bucket = _bucket_name()
    try:
        client.head_bucket(Bucket=bucket)
        return
    except ClientError:
        pass

    cfg = _storage_config()
    create_kwargs = {"Bucket": bucket}
    if cfg["region_name"] and cfg["region_name"] != "us-east-1":
        create_kwargs["CreateBucketConfiguration"] = {
            "LocationConstraint": cfg["region_name"],
        }
    client.create_bucket(**create_kwargs)


async def ensure_bucket() -> None:
    await asyncio.to_thread(_ensure_bucket_sync)


def _put_blob_sync(*, object_key: str, data: bytes, content_type: Optional[str]) -> None:
    if not _has_s3_credentials():
        raise RuntimeError("Encrypted blob storage is not configured (S3 credentials missing)")
    client = _build_client()
    extra_args = {}
    if content_type:
        extra_args["ContentType"] = content_type
    client.upload_fileobj(
        Fileobj=io.BytesIO(data),
        Bucket=_bucket_name(),
        Key=object_key,
        ExtraArgs=extra_args or None,
    )


async def put_blob(*, object_key: str, data: bytes, content_type: Optional[str] = None) -> None:
    await asyncio.to_thread(_put_blob_sync, object_key=object_key, data=data, content_type=content_type)


def _get_blob_sync(*, object_key: str) -> bytes:
    if not _has_s3_credentials():
        raise RuntimeError("Encrypted blob storage is not configured (S3 credentials missing)")
    client = _build_client()
    response = client.get_object(Bucket=_bucket_name(), Key=object_key)
    return response["Body"].read()


async def get_blob(*, object_key: str) -> bytes:
    return await asyncio.to_thread(_get_blob_sync, object_key=object_key)

