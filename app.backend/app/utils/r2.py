from __future__ import annotations

import boto3
from botocore.config import Config

from app.config import get_settings

_client = None


def get_r2_client():
    global _client
    if _client is None:
        s = get_settings()
        _client = boto3.client(
            "s3",
            endpoint_url=s.r2_endpoint_url or f"https://{s.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=s.r2_access_key_id,
            aws_secret_access_key=s.r2_secret_access_key,
            region_name="auto",
            config=Config(signature_version="s3v4"),
        )
    return _client


def generate_presigned_url(r2_key: str, expires: int = 3600) -> str:
    client = get_r2_client()
    s = get_settings()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": s.r2_bucket, "Key": r2_key},
        ExpiresIn=expires,
    )
