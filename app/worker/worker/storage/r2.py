from __future__ import annotations

import os
from functools import lru_cache
from typing import Generator

import boto3
from botocore.config import Config

from worker.config import get_settings


@lru_cache(maxsize=1)
def get_r2_client():
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=settings.r2_endpoint,
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(
            signature_version="s3v4",
            retries={"max_attempts": 5, "mode": "standard"},
        ),
        region_name="auto",
    )


def download_to_file(key: str, local_path: str) -> None:
    settings = get_settings()
    get_r2_client().download_file(settings.r2_bucket, key, local_path)


def upload_file(local_path: str, key: str, content_type: str = "application/octet-stream") -> None:
    settings = get_settings()
    get_r2_client().upload_file(
        local_path,
        settings.r2_bucket,
        key,
        ExtraArgs={"ContentType": content_type},
    )


def upload_bytes(data: bytes, key: str, content_type: str = "application/octet-stream") -> None:
    settings = get_settings()
    get_r2_client().put_object(
        Bucket=settings.r2_bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
    )


def list_objects(prefix: str = "", max_keys: int = 1000) -> Generator[dict, None, None]:
    """Yield every object under *prefix*, handling pagination automatically."""
    settings = get_settings()
    kwargs: dict = {"Bucket": settings.r2_bucket, "MaxKeys": max_keys}
    if prefix:
        kwargs["Prefix"] = prefix

    while True:
        response = get_r2_client().list_objects_v2(**kwargs)
        for obj in response.get("Contents", []):
            yield {
                "key": obj["Key"],
                "size": obj["Size"],
                "last_modified": obj["LastModified"],
                "etag": obj.get("ETag", "").strip('"'),
            }
        if not response.get("IsTruncated"):
            break
        kwargs["ContinuationToken"] = response["NextContinuationToken"]


def presigned_url(key: str, expiry: int = 300) -> str:
    settings = get_settings()
    return get_r2_client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket, "Key": key},
        ExpiresIn=expiry,
    )


def object_exists(key: str) -> bool:
    settings = get_settings()
    try:
        get_r2_client().head_object(Bucket=settings.r2_bucket, Key=key)
        return True
    except Exception:
        return False
