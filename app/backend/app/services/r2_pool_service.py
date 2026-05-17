from __future__ import annotations

import os
from datetime import datetime

import structlog
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.audit import write_audit_log
from app.models.user import UserDocument
from app.services.storage_service import StorageService
from app.tasks.dedup import dispatch_dedup_task
from app.tasks.transcoding import dispatch_transcode_task
from app.utils.datetime_utils import utc_now

logger = structlog.get_logger(__name__)

_AUDIO_EXTENSIONS = {".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".aiff"}
_RAW_PREFIX = "music/raw/"

# What R2 gives us without downloading the file
_R2_OBJECT_FIELDS = ("key", "size", "last_modified", "etag")


def _is_audio(key: str) -> bool:
    return os.path.splitext(key.lower())[1] in _AUDIO_EXTENSIONS


def _filename_from_key(key: str) -> str:
    return key.split("/")[-1]


def _title_from_filename(filename: str) -> str:
    return os.path.splitext(filename)[0].replace("_", " ").strip()


async def get_pool_stats(
    db: AsyncIOMotorDatabase,
    storage: StorageService,
) -> dict:
    """Return a summary of the R2 raw pool vs MongoDB index state."""
    # Count what R2 has under music/raw/
    r2_stats = await storage.get_prefix_stats(_RAW_PREFIX)
    r2_audio_count = 0
    r2_audio_bytes = 0
    token = None
    while True:
        page = await storage.list_objects(prefix=_RAW_PREFIX, continuation_token=token)
        for obj in page["objects"]:
            if _is_audio(obj["key"]):
                r2_audio_count += 1
                r2_audio_bytes += obj["size"]
        token = page["next_token"]
        if not token:
            break

    # Count what MongoDB has indexed
    indexed_count = await db["tracks"].count_documents({})
    ready_count = await db["tracks"].count_documents({"status": "ready"})
    pending_count = await db["tracks"].count_documents({"status": "pending"})
    processing_count = await db["tracks"].count_documents({"status": "processing"})
    failed_count = await db["tracks"].count_documents({"status": "failed"})

    unindexed_estimate = max(0, r2_audio_count - indexed_count)

    return {
        "r2": {
            "total_objects": r2_stats["total_objects"],
            "total_bytes": r2_stats["total_bytes"],
            "total_gb": round(r2_stats["total_bytes"] / (1024 ** 3), 3),
            "audio_files": r2_audio_count,
            "audio_bytes": r2_audio_bytes,
            "audio_gb": round(r2_audio_bytes / (1024 ** 3), 3),
        },
        "mongodb": {
            "indexed_tracks": indexed_count,
            "ready": ready_count,
            "pending": pending_count,
            "processing": processing_count,
            "failed": failed_count,
        },
        "gaps": {
            "estimated_unindexed": unindexed_estimate,
            "needs_attention": pending_count + failed_count,
        },
    }


async def list_pool_objects(
    storage: StorageService,
    db: AsyncIOMotorDatabase,
    prefix: str = _RAW_PREFIX,
    continuation_token: str | None = None,
    page_size: int = 50,
    audio_only: bool = True,
) -> dict:
    """List R2 objects and annotate each with its MongoDB index status.

    Returns a page of objects with::

        {
            "objects": [
                {
                    "key": str,
                    "filename": str,
                    "size_bytes": int,
                    "size_mb": float,
                    "last_modified": datetime,
                    "etag": str,
                    "is_audio": bool,
                    "indexed": bool,
                    "track_id": str | None,
                    "track_status": str | None,
                    "title": str | None,
                    "artist_name": str | None,
                }
            ],
            "next_token": str | None,
            "is_truncated": bool,
            "total_returned": int,
        }
    """
    # Fetch a larger page from R2 to account for filtering
    fetch_size = page_size * 3 if audio_only else page_size
    page = await storage.list_objects(
        prefix=prefix,
        continuation_token=continuation_token,
        max_keys=min(fetch_size, 1000),
    )

    raw_objects = page["objects"]
    if audio_only:
        raw_objects = [o for o in raw_objects if _is_audio(o["key"])]
    raw_objects = raw_objects[:page_size]

    if not raw_objects:
        return {
            "objects": [],
            "next_token": page["next_token"],
            "is_truncated": page["is_truncated"],
            "total_returned": 0,
        }

    # Bulk-lookup in MongoDB by r2_key_raw
    keys = [o["key"] for o in raw_objects]
    track_docs = await db["tracks"].find(
        {"r2_key_raw": {"$in": keys}},
        {"_id": 1, "r2_key_raw": 1, "status": 1, "title": 1, "artist_id": 1},
    ).to_list(length=len(keys))

    # Build lookup: r2_key_raw → track doc
    indexed_map: dict[str, dict] = {t["r2_key_raw"]: t for t in track_docs}

    # Resolve artist names for indexed tracks
    artist_ids = {t["artist_id"] for t in track_docs if t.get("artist_id")}
    artist_map: dict[str, str] = {}
    if artist_ids:
        artist_docs = await db["artists"].find(
            {"_id": {"$in": list(artist_ids)}},
            {"_id": 1, "display_name": 1},
        ).to_list(length=len(artist_ids))
        artist_map = {str(a["_id"]): a["display_name"] for a in artist_docs}

    annotated = []
    for obj in raw_objects:
        track = indexed_map.get(obj["key"])
        filename = _filename_from_key(obj["key"])
        annotated.append({
            "key": obj["key"],
            "filename": filename,
            "size_bytes": obj["size"],
            "size_mb": round(obj["size"] / (1024 ** 2), 2),
            "last_modified": obj["last_modified"],
            "etag": obj["etag"],
            "is_audio": _is_audio(obj["key"]),
            "indexed": track is not None,
            "track_id": str(track["_id"]) if track else None,
            "track_status": track.get("status") if track else None,
            "title": track.get("title") if track else _title_from_filename(filename),
            "artist_name": artist_map.get(str(track.get("artist_id", ""))) if track else None,
        })

    return {
        "objects": annotated,
        "next_token": page["next_token"],
        "is_truncated": page["is_truncated"],
        "total_returned": len(annotated),
    }


async def list_unindexed(
    storage: StorageService,
    db: AsyncIOMotorDatabase,
    prefix: str = _RAW_PREFIX,
    continuation_token: str | None = None,
    page_size: int = 50,
) -> dict:
    """Return only R2 objects that have no MongoDB track document."""
    collected = []
    next_token = continuation_token
    last_is_truncated = False

    # Keep fetching pages until we have enough unindexed objects or exhaust the bucket
    while len(collected) < page_size:
        page = await storage.list_objects(prefix=prefix, continuation_token=next_token, max_keys=500)
        audio_objects = [o for o in page["objects"] if _is_audio(o["key"])]

        if audio_objects:
            keys = [o["key"] for o in audio_objects]
            existing = await db["tracks"].distinct("r2_key_raw", {"r2_key_raw": {"$in": keys}})
            existing_set = set(existing)
            for obj in audio_objects:
                if obj["key"] not in existing_set:
                    filename = _filename_from_key(obj["key"])
                    collected.append({
                        "key": obj["key"],
                        "filename": filename,
                        "size_bytes": obj["size"],
                        "size_mb": round(obj["size"] / (1024 ** 2), 2),
                        "last_modified": obj["last_modified"],
                        "etag": obj["etag"],
                        "suggested_title": _title_from_filename(filename),
                    })
                    if len(collected) >= page_size:
                        break

        next_token = page["next_token"]
        last_is_truncated = page["is_truncated"]
        if not next_token:
            break

    return {
        "objects": collected[:page_size],
        "next_token": next_token,
        "is_truncated": last_is_truncated or len(collected) > page_size,
        "total_returned": len(collected[:page_size]),
    }


async def ingest_unindexed(
    storage: StorageService,
    db: AsyncIOMotorDatabase,
    actor: UserDocument,
    prefix: str = _RAW_PREFIX,
    limit: int = 200,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> dict:
    """Scan R2 for audio objects with no MongoDB record and create pending track stubs.

    This is the "pull from pool" operation.  Workers handle the heavy processing
    (transcoding, metadata extraction, dedup) after stubs are created.
    """
    now = utc_now()
    created = 0
    skipped = 0
    errors = []

    page_token = None
    while created < limit:
        page = await storage.list_objects(prefix=prefix, continuation_token=page_token, max_keys=500)
        audio_objects = [o for o in page["objects"] if _is_audio(o["key"])]

        if audio_objects:
            keys = [o["key"] for o in audio_objects]
            existing = set(
                await db["tracks"].distinct("r2_key_raw", {"r2_key_raw": {"$in": keys}})
            )

            for obj in audio_objects:
                if created >= limit:
                    break
                if obj["key"] in existing:
                    skipped += 1
                    continue

                filename = _filename_from_key(obj["key"])
                title = _title_from_filename(filename)
                # Use ETag as a proxy for MD5 on single-part uploads (not guaranteed on multipart)
                etag = obj.get("etag", "")

                stub = {
                    "r2_key_raw": obj["key"],
                    "r2_keys_transcoded": {},
                    "artist_id": None,
                    "album": None,
                    "title": title,
                    "year": None,
                    "genre": None,
                    "language": None,
                    "duration_seconds": None,
                    "file_size_bytes": obj["size"],
                    "sha256": "",         # worker will fill this after download
                    "md5": etag,          # ETag is MD5 for single-part uploads
                    "artwork_r2_key": None,
                    "waveform_r2_key": None,
                    "tags": [],
                    "status": "pending",
                    "metadata_version": 1,
                    "metadata_history": [],
                    "duplicate_group_id": None,
                    "is_canonical": False,
                    "skiza_clip_ids": [],
                    "stream_count": 0,
                    "like_count": 0,
                    "ingested_from_pool": True,
                    "r2_last_modified": obj["last_modified"],
                    "created_by": ObjectId(str(actor.id)),
                    "created_at": now,
                    "updated_at": now,
                }

                try:
                    result = await db["tracks"].insert_one(stub)
                    track_id = str(result.inserted_id)
                    created += 1

                    # Dispatch processing tasks
                    try:
                        dispatch_transcode_task(track_id, obj["key"])
                        if etag:
                            dispatch_dedup_task(track_id, "", etag)
                    except Exception as dispatch_exc:
                        logger.warning("dispatch_failed_after_ingest", track_id=track_id, error=str(dispatch_exc))

                except Exception as exc:
                    errors.append({"key": obj["key"], "error": str(exc)})
                    logger.warning("pool_ingest_failed", key=obj["key"], error=str(exc))

        page_token = page["next_token"]
        if not page_token:
            break

    await write_audit_log(
        db,
        actor_id=str(actor.id),
        actor_role=actor.role,
        actor_ip=actor_ip,
        actor_ua=actor_ua,
        action="r2_pool.ingest",
        entity_type="pool",
        entity_id=prefix,
        after={"created": created, "skipped": skipped, "errors": len(errors)},
        request_id=request_id,
    )

    return {
        "created": created,
        "skipped": skipped,
        "errors": errors,
        "message": f"Ingested {created} tracks from R2 pool. {skipped} already indexed.",
    }
