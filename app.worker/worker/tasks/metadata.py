"""Metadata enrichment tasks.

Reads ID3 / Vorbis / MP4 tags from raw R2 audio files using partial HTTP range
requests (first 256 KB — enough for tag headers in all common formats).
Falls back to path inference when tags are absent.
Creates artist stubs from discovered artist names.
"""
from __future__ import annotations

import io
import os
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any

import structlog
from bson import ObjectId
from celery import Task

from worker.celery_app import app
from worker.db.mongo import get_db
from worker.storage.r2 import get_r2_client
from worker.config import get_settings

logger = structlog.get_logger(__name__)

_TAG_READ_BYTES = 262_144  # 256 KB — covers ID3v2, Vorbis, MP4 moov (usually)
_AUDIO_EXTS = {".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".aiff"}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _slugify(name: str) -> str:
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    name = re.sub(r"[^\w\s-]", "", name.lower())
    return re.sub(r"[\s_]+", "-", name).strip("-")


def _first_tag(f: Any, *keys: str) -> str | None:
    for k in keys:
        val = f.tags.get(k) if hasattr(f, "tags") and f.tags else None
        if val is None:
            val = f.get(k)
        if val:
            v = str(val[0]).strip() if hasattr(val, "__iter__") and not isinstance(val, str) else str(val).strip()
            if v:
                return v
    return None


def _read_tags_from_bytes(data: bytes, filename: str) -> dict:
    """Parse audio tags from raw bytes via mutagen. Returns {} on any failure."""
    try:
        import mutagen
        buf = io.BytesIO(data)
        buf.name = filename  # mutagen uses the name extension to pick the parser
        f = mutagen.File(buf, easy=True)
        if f is None:
            return {}

        tags: dict[str, Any] = {}

        def get(key: str) -> str | None:
            val = f.get(key)
            if not val:
                return None
            v = str(val[0]).strip()
            return v or None

        if get("title"):
            tags["title"] = get("title")
        if get("artist"):
            tags["artist"] = get("artist")
        if get("albumartist"):
            tags["album_artist"] = get("albumartist")
        if get("album"):
            tags["album"] = get("album")
        if get("genre"):
            tags["genre"] = get("genre")
        if get("language"):
            tags["language"] = get("language")

        date_str = get("date") or ""
        m = re.search(r"\b(19|20)\d{2}\b", date_str)
        if m:
            tags["year"] = int(m.group())

        tn = get("tracknumber") or ""
        num = tn.split("/")[0]
        if num.isdigit():
            tags["track_number"] = int(num)

        # Duration from info block (available even in partial reads for most formats)
        if hasattr(f, "info") and hasattr(f.info, "length") and f.info.length:
            tags["duration_seconds"] = round(f.info.length)

        return tags
    except Exception:
        return {}


def _fetch_partial(r2_key: str) -> tuple[bytes, str]:
    """Download first _TAG_READ_BYTES bytes of r2_key. Returns (data, filename)."""
    s = get_settings()
    resp = get_r2_client().get_object(
        Bucket=s.r2_bucket,
        Key=r2_key,
        Range=f"bytes=0-{_TAG_READ_BYTES - 1}",
    )
    data = resp["Body"].read()
    filename = r2_key.split("/")[-1]
    return data, filename


def _artist_from_path(r2_key: str) -> str | None:
    """Use path_parser to extract artist name from the R2 key segments."""
    from worker.utils.path_parser import parse_r2_key
    try:
        parsed = parse_r2_key(r2_key)
        if parsed.artist and parsed.artist.confidence >= 0.4:
            return parsed.artist.value
    except Exception:
        pass
    # Direct path fallback: music/raw/Artist/Album/Track or music/Artist/Track
    parts = [p for p in r2_key.replace("\\", "/").split("/") if p]
    skip = {"music", "raw", "transcoded", "singles", "compilations", "various", "various artists",
             "unknown", "untitled", "skiza", "artwork", "documents", "waveforms", "backups"}
    for part in parts[:-1]:  # exclude filename
        clean = part.replace("_", " ").strip()
        if clean.lower() not in skip and len(clean) >= 2:
            return clean
    return None


def _album_from_path(r2_key: str) -> str | None:
    from worker.utils.path_parser import parse_r2_key
    try:
        parsed = parse_r2_key(r2_key)
        if parsed.album and parsed.album.confidence >= 0.4:
            return parsed.album.value
    except Exception:
        pass
    # Second-to-last path segment before filename
    parts = [p for p in r2_key.replace("\\", "/").split("/") if p]
    skip = {"music", "raw", "transcoded", "singles"}
    if len(parts) >= 3:
        candidate = parts[-2].replace("_", " ").strip()
        if candidate.lower() not in skip:
            return candidate
    return None


def _upsert_artist(db, display_name: str, genres: list[str] | None = None) -> ObjectId | None:
    """Upsert artist by slug. Returns ObjectId."""
    name = display_name.strip()
    if not name or len(name) < 2:
        return None
    slug = _slugify(name)
    if not slug:
        return None

    existing = db["artists"].find_one({"slug": slug}, {"_id": 1})
    if existing:
        return existing["_id"]

    now = _utc_now()
    result = db["artists"].insert_one({
        "display_name": name,
        "slug": slug,
        "status": "pending",
        "bio": None,
        "country": None,
        "genres": genres or [],
        "image_url": None,
        "image_r2_key": None,
        "track_count": 0,
        "monthly_listeners": 0,
        "user_id": None,
        "auto_created": True,
        "created_at": now,
        "updated_at": now,
    })
    return result.inserted_id


def _enrich_one(db, track: dict) -> dict:
    """Enrich a single track document. Returns a result summary dict."""
    r2_key = track["r2_key_raw"]
    track_id = track["_id"]
    log = logger.bind(track_id=str(track_id), r2_key=r2_key)

    # ── Fetch partial file and read tags ──────────────────────────────────────
    id3: dict = {}
    try:
        data, filename = _fetch_partial(r2_key)
        id3 = _read_tags_from_bytes(data, filename)
    except Exception as exc:
        log.warning("metadata_fetch_failed", error=str(exc))

    # ── Merge: ID3 wins over path, path fills gaps ────────────────────────────
    path_artist = _artist_from_path(r2_key)
    path_album = _album_from_path(r2_key)

    artist_name = id3.get("artist") or id3.get("album_artist") or path_artist
    album = id3.get("album") or (path_album if not track.get("album") else None)

    updates: dict[str, Any] = {"updated_at": _utc_now(), "id3_extracted": True}

    if id3.get("title"):
        updates["title"] = id3["title"]
    if album:
        updates["album"] = album
    if id3.get("year"):
        updates["year"] = id3["year"]
    if id3.get("genre"):
        updates["genre"] = id3["genre"]
    if id3.get("track_number"):
        updates["track_number"] = id3["track_number"]
    if id3.get("language") and not track.get("language"):
        updates["language"] = id3["language"]
    if id3.get("duration_seconds") and not track.get("duration_seconds"):
        updates["duration_seconds"] = id3["duration_seconds"]

    # ── Upsert artist ─────────────────────────────────────────────────────────
    artist_id_oid = None
    if artist_name and not track.get("artist_id"):
        genres = [id3["genre"]] if id3.get("genre") else []
        artist_id_oid = _upsert_artist(db, artist_name, genres)
        if artist_id_oid:
            updates["artist_id"] = artist_id_oid
            updates["artist_name_raw"] = artist_name
            # Increment track_count on the artist
            db["artists"].update_one(
                {"_id": artist_id_oid},
                {"$inc": {"track_count": 1}, "$set": {"updated_at": _utc_now()}},
            )

    # Bump metadata_version so sync doesn't re-overwrite staff work
    updates["metadata_version"] = max(track.get("metadata_version", 1), 2)

    db["tracks"].update_one({"_id": track_id}, {"$set": updates})

    # Strip missing_metadata tag if we now have the key fields
    has_title = updates.get("title") or track.get("title")
    has_artist = artist_id_oid or track.get("artist_id")
    if has_title and has_artist:
        db["tracks"].update_one(
            {"_id": track_id},
            {"$pull": {"workflow_tags": "missing_metadata"}},
        )

    return {
        "status": "ok",
        "artist": artist_name,
        "album": album,
        "has_id3": bool(id3),
        "artist_created": bool(artist_id_oid and not db["artists"].find_one(
            {"_id": artist_id_oid, "created_at": {"$lt": _utc_now()}}
        )),
    }


# ── Celery tasks ──────────────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.metadata.enrich_track_metadata",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def enrich_track_metadata(self: Task, track_id: str) -> dict:
    """Enrich a single track's metadata from R2 tags and path inference."""
    db = get_db()
    track = db["tracks"].find_one({"_id": ObjectId(track_id)})
    if not track:
        return {"status": "not_found", "track_id": track_id}
    return _enrich_one(db, track)


@app.task(
    name="worker.tasks.metadata.batch_enrich_metadata",
    bind=True,
    max_retries=1,
    soft_time_limit=10800,  # 3h
)
def batch_enrich_metadata(
    self: Task,
    batch_size: int = 100,
    skip: int = 0,
    only_missing_artist: bool = False,
    job_id: str = "cron",
) -> dict:
    """Batch-enrich tracks from R2 tags and file path parsing.

    Processes up to *batch_size* un-enriched tracks per invocation. Tracks
    already at metadata_version >= 2 (touched by staff) are skipped.

    Args:
        batch_size: Max tracks to process this run.
        skip: Offset into the pending-track cursor (for parallel batching).
        only_missing_artist: If True, only process tracks without artist_id.
        job_id: Sync job document ID for progress display in the UI.
    """
    log = logger.bind(task_id=self.request.id, job_id=job_id)
    log.info("batch_enrich_start", batch_size=batch_size, skip=skip)

    db = get_db()
    counters = {"processed": 0, "enriched": 0, "artists_created": 0, "errors": 0}
    errors: list[dict] = []

    # ── Ensure a sync_job record for the UI ───────────────────────────────────
    job_oid: ObjectId | None = None
    if job_id != "cron":
        try:
            job_oid = ObjectId(job_id)
            db["sync_jobs"].update_one(
                {"_id": job_oid},
                {"$set": {"status": "running", "started_at": _utc_now()}},
            )
        except Exception:
            job_oid = None
    if job_oid is None:
        result = db["sync_jobs"].insert_one({
            "mode": "batch_enrich_metadata",
            "triggered_by": None,
            "status": "running",
            "celery_task_id": self.request.id,
            "objects_scanned": 0,
            "objects_new": 0,
            "objects_updated": 0,
            "objects_orphaned": 0,
            "errors": [],
            "started_at": _utc_now(),
            "completed_at": None,
            "created_at": _utc_now(),
        })
        job_oid = result.inserted_id

    # ── Query ─────────────────────────────────────────────────────────────────
    query: dict = {
        "id3_extracted": {"$ne": True},  # not yet enriched
        "r2_key_raw": {"$regex": r"\.(mp3|flac|wav|m4a|aac|ogg|opus|wma|aiff)$", "$options": "i"},
    }
    if only_missing_artist:
        query["artist_id"] = None

    artists_before = db["artists"].count_documents({})

    try:
        cursor = db["tracks"].find(
            query,
            {"_id": 1, "r2_key_raw": 1, "artist_id": 1, "title": 1, "album": 1,
             "language": 1, "duration_seconds": 1, "metadata_version": 1, "workflow_tags": 1},
        ).skip(skip).limit(batch_size)

        for track in cursor:
            counters["processed"] += 1
            try:
                _enrich_one(db, track)
                counters["enriched"] += 1
            except Exception as exc:
                counters["errors"] += 1
                errors.append({"key": track.get("r2_key_raw", ""), "message": str(exc)})
                log.warning("enrich_failed", r2_key=track.get("r2_key_raw"), error=str(exc))

            # Live progress every 10 tracks
            if counters["processed"] % 10 == 0:
                db["sync_jobs"].update_one(
                    {"_id": job_oid},
                    {"$set": {
                        "objects_scanned": counters["processed"],
                        "objects_updated": counters["enriched"],
                    }},
                )
                log.info("batch_enrich_progress", **counters)

        artists_after = db["artists"].count_documents({})
        counters["artists_created"] = artists_after - artists_before

        db["sync_jobs"].update_one(
            {"_id": job_oid},
            {"$set": {
                "status": "complete",
                "completed_at": _utc_now(),
                "objects_scanned": counters["processed"],
                "objects_updated": counters["enriched"],
                "errors": errors[-50:],
            }},
        )
        log.info("batch_enrich_done", **counters)

    except Exception as exc:
        db["sync_jobs"].update_one(
            {"_id": job_oid},
            {"$set": {
                "status": "failed",
                "completed_at": _utc_now(),
                "objects_scanned": counters["processed"],
                "objects_updated": counters["enriched"],
                "errors": (errors + [{"key": "", "message": str(exc)}])[-50:],
            }},
        )
        raise

    return counters
