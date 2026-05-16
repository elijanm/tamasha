from __future__ import annotations

import asyncio
import re
from functools import partial

import boto3
from botocore.config import Config

from app.config import Settings


class StorageService:
    def __init__(self, settings: Settings) -> None:
        self._bucket = settings.r2_bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.r2_endpoint_url or f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
            region_name="auto",
        )

    def _run_sync(self, fn, *args, **kwargs):
        loop = asyncio.get_event_loop()
        return loop.run_in_executor(None, partial(fn, *args, **kwargs))

    async def generate_presigned_upload_url(
        self, key: str, content_type: str = "application/octet-stream", expires: int = 3600
    ) -> str:
        url = await self._run_sync(
            self._client.generate_presigned_url,
            "put_object",
            Params={"Bucket": self._bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=expires,
            HttpMethod="PUT",
        )
        return url

    async def generate_presigned_download_url(self, key: str, expires: int = 900) -> str:
        url = await self._run_sync(
            self._client.generate_presigned_url,
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expires,
        )
        return url

    async def object_exists(self, key: str) -> bool:
        try:
            await self._run_sync(self._client.head_object, Bucket=self._bucket, Key=key)
            return True
        except Exception:
            return False

    async def get_object_metadata(self, key: str) -> dict | None:
        try:
            response = await self._run_sync(
                self._client.head_object, Bucket=self._bucket, Key=key
            )
            return {
                "content_length": response.get("ContentLength"),
                "content_type": response.get("ContentType"),
                "last_modified": response.get("LastModified"),
                "etag": response.get("ETag", "").strip('"'),
            }
        except Exception:
            return None

    async def delete_object(self, key: str) -> None:
        await self._run_sync(self._client.delete_object, Bucket=self._bucket, Key=key)

    async def list_objects(
        self,
        prefix: str = "",
        continuation_token: str | None = None,
        max_keys: int = 1000,
    ) -> dict:
        """Page through R2 objects under *prefix*.

        Returns::
            {
                "objects": [{"key", "size", "last_modified", "etag"}],
                "next_token": str | None,
                "is_truncated": bool,
                "total_returned": int,
            }
        """
        kwargs: dict = {"Bucket": self._bucket, "MaxKeys": max_keys}
        if prefix:
            kwargs["Prefix"] = prefix
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token

        response = await self._run_sync(self._client.list_objects_v2, **kwargs)
        objects = [
            {
                "key": obj["Key"],
                "size": obj["Size"],
                "last_modified": obj["LastModified"],
                "etag": obj.get("ETag", "").strip('"'),
            }
            for obj in response.get("Contents", [])
        ]
        return {
            "objects": objects,
            "next_token": response.get("NextContinuationToken"),
            "is_truncated": response.get("IsTruncated", False),
            "total_returned": len(objects),
        }

    async def get_prefix_stats(self, prefix: str = "") -> dict:
        """Return total object count and byte sum under *prefix* (full scan, use sparingly)."""
        total_objects = 0
        total_bytes = 0
        token = None
        while True:
            page = await self.list_objects(prefix=prefix, continuation_token=token, max_keys=1000)
            for obj in page["objects"]:
                total_objects += 1
                total_bytes += obj["size"]
            token = page["next_token"]
            if not token:
                break
        return {"prefix": prefix or "/", "total_objects": total_objects, "total_bytes": total_bytes}

    @staticmethod
    def _normalize(name: str) -> str:
        return re.sub(r"\s+", "_", name.strip())

    def make_track_raw_key(self, upload_id: str, filename: str) -> str:
        safe_name = self._normalize(filename)
        return f"music/raw/{upload_id}/{safe_name}"
