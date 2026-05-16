from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Literal

import structlog
from bson import ObjectId
from celery import Task

from worker.celery_app import app
from worker.db.mongo import get_db
from worker.storage.r2 import list_objects, object_exists
from worker.utils.path_parser import (
    compute_workflow_tags,
    parse_r2_key,
    should_queue_human_review,
)

logger = structlog.get_logger(__name__)

_AUDIO_EXTENSIONS = {".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".aiff"}
_RAW_PREFIX = "music/raw/"

SyncResult = Literal["created", "updated", "skipped"]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _is_audio(key: str) -> bool:
    return os.path.splitext(key.lower())[1] in _AUDIO_EXTENSIONS


def _filename_from_key(key: str) -> str:
    return key.split("/")[-1]


def _ensure_sync_job(db, job_id: str, mode: str) -> ObjectId:
    if job_id == "cron":
        result = db["sync_jobs"].insert_one({
            "mode": mode,
            "triggered_by": None,
            "status": "running",
            "celery_task_id": None,
            "objects_scanned": 0,
            "objects_new": 0,
            "objects_updated": 0,
            "objects_orphaned": 0,
            "errors": [],
            "started_at": _utc_now(),
            "completed_at": None,
            "created_at": _utc_now(),
        })
        return result.inserted_id
    try:
        oid = ObjectId(job_id)
        db["sync_jobs"].update_one(
            {"_id": oid},
            {"$set": {"status": "running", "started_at": _utc_now()}},
        )
        return oid
    except Exception:
        return _ensure_sync_job(db, "cron", mode)


def _finish_job(db, job_oid: ObjectId, status: str, counters: dict, errors: list) -> None:
    db["sync_jobs"].update_one(
        {"_id": job_oid},
        {"$set": {
            "status": status,
            "completed_at": _utc_now(),
            "objects_scanned": counters.get("scanned", 0),
            "objects_new": counters.get("new", 0),
            "objects_updated": counters.get("updated", 0),
            "objects_orphaned": counters.get("orphaned", 0),
            "errors": errors[-50:],
        }},
    )


def _infer_stub_metadata(r2_key: str) -> dict:
    """Run path parser and return fields suitable for a track document."""
    parsed = parse_r2_key(r2_key)
    workflow_tags = compute_workflow_tags(parsed)
    needs_review, review_reasons = should_queue_human_review(parsed)

    fields: dict = {
        "inferred_metadata": parsed.to_dict(),
        "workflow_tags": workflow_tags,
        "needs_human_review": needs_review,
        "review_reasons": review_reasons,
        "metadata_confidence": {
            k: getattr(parsed, k).as_dict()
            for k in ("artist", "title", "album", "year", "genre", "language", "region")
            if getattr(parsed, k) is not None
        },
    }

    # Pre-fill human-readable fields from inferred values (low confidence; workers override later)
    if parsed.title:
        fields["title"] = parsed.title.value
    if parsed.album:
        fields["album"] = parsed.album.value
    if parsed.year:
        fields["year"] = parsed.year.value
    if parsed.genre:
        fields["genre"] = parsed.genre.value
    if parsed.language:
        fields["language"] = parsed.language.value

    return fields


def _create_or_update_track_stub(db, obj: dict, mode: str = "sync") -> SyncResult:
    """Create a new track stub or re-queue an existing one if its ETag changed.

    Returns:
        "created"  — new stub inserted
        "updated"  — existing track's content changed (ETag differs); reset to pending
        "skipped"  — already indexed and unchanged
    """
    r2_key = obj["key"]
    new_etag = obj.get("etag", "")

    existing = db["tracks"].find_one(
        {"r2_key_raw": r2_key},
        {"_id": 1, "md5": 1, "status": 1, "metadata_version": 1},
    )

    # ── New file ──────────────────────────────────────────────────────────────
    if not existing:
        now = _utc_now()
        stub = {
            "r2_key_raw": r2_key,
            "r2_keys_transcoded": {},
            "artist_id": None,
            "title": os.path.splitext(_filename_from_key(r2_key))[0].replace("_", " "),
            "album": None,
            "year": None,
            "genre": None,
            "language": None,
            "duration_seconds": None,
            "file_size_bytes": obj["size"],
            "sha256": "",
            "md5": new_etag,
            "r2_etag": new_etag,          # separate slot — md5 gets updated by transcoder
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
            "ingested_from_sync": True,
            "sync_mode": mode,
            "r2_last_modified": obj["last_modified"],
            "created_by": None,
            "created_at": now,
            "updated_at": now,
        }
        stub.update(_infer_stub_metadata(r2_key))
        db["tracks"].insert_one(stub)
        return "created"

    # ── Already indexed — check if content changed via ETag ──────────────────
    stored_etag = existing.get("md5", "")

    # Never re-queue a track that staff has already verified/edited
    if existing.get("metadata_version", 1) > 1:
        return "skipped"

    # ETag unchanged — nothing to do
    if stored_etag and stored_etag == new_etag:
        return "skipped"

    # ETag changed — file was replaced at the same R2 path
    # Reset to pending so transcoding re-runs; preserve metadata_version to protect staff edits
    db["tracks"].update_one(
        {"_id": existing["_id"]},
        {"$set": {
            "status": "pending",
            "md5": new_etag,
            "r2_etag": new_etag,
            "file_size_bytes": obj["size"],
            "r2_last_modified": obj["last_modified"],
            "sha256": "",           # stale — will be recomputed
            "r2_keys_transcoded": {},
            "updated_at": _utc_now(),
        }},
    )
    return "updated"


def _dispatch_processing(db, r2_key: str) -> None:
    """Look up track by r2_key and dispatch transcode + dedup tasks."""
    track_doc = db["tracks"].find_one({"r2_key_raw": r2_key}, {"_id": 1})
    if not track_doc:
        return
    track_id = str(track_doc["_id"])
    from worker.tasks.transcoding import transcode_track
    from worker.tasks.dedup import check_duplicate
    transcode_track.apply_async(kwargs={"track_id": track_id, "r2_key_raw": r2_key})
    check_duplicate.apply_async(kwargs={"track_id": track_id, "sha256": "", "md5": ""})


# ── Pool all ──────────────────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.sync.pool_all",
    bind=True,
    max_retries=1,
    soft_time_limit=7200,
)
def pool_all(self: Task, prefix: str = "music/", dispatch: bool = False, job_id: str = "cron") -> dict:
    """Scan every audio file under *prefix* in R2 and index any that are not yet in MongoDB.

    Args:
        prefix:   R2 prefix to scan (default "music/" covers the whole bucket).
        dispatch: If True, dispatch transcode+dedup for new/changed files.
        job_id:   Sync job document ID for progress tracking.
    """
    log = logger.bind(task_id=self.request.id, prefix=prefix, job_id=job_id)
    log.info("pool_all_start", dispatch=dispatch)

    db = get_db()
    job_oid = _ensure_sync_job(db, job_id, "pool_all")
    counters: dict[str, int] = {"scanned": 0, "created": 0, "updated": 0, "skipped": 0, "errors": 0}
    errors = []

    try:
        for obj in list_objects(prefix=prefix):
            if not _is_audio(obj["key"]):
                continue
            counters["scanned"] += 1
            try:
                result = _create_or_update_track_stub(db, obj, mode="pool")
                if result == "created":
                    counters["created"] += 1
                elif result == "updated":
                    counters["updated"] += 1
                else:
                    counters["skipped"] += 1
                if dispatch and result in ("created", "updated"):
                    _dispatch_processing(db, obj["key"])
            except Exception as exc:
                counters["errors"] += 1
                errors.append({"key": obj["key"], "message": str(exc)})
                log.warning("pool_all_item_failed", key=obj["key"], error=str(exc))

            # Write live progress every 50 objects so the UI can poll it
            if counters["scanned"] % 50 == 0:
                db["sync_jobs"].update_one(
                    {"_id": job_oid},
                    {"$set": {
                        "objects_scanned": counters["scanned"],
                        "objects_new": counters["created"],
                        "objects_updated": counters["updated"],
                    }},
                )

        finish_status = "complete"
        _finish_job(db, job_oid, finish_status, {
            "scanned": counters["scanned"],
            "new": counters["created"],
            "updated": counters["updated"],
            "orphaned": 0,
        }, errors)
        log.info("pool_all_done", status=finish_status, **counters)
    except Exception as exc:
        _finish_job(db, job_oid, "failed", {
            "scanned": counters["scanned"], "new": counters["created"],
            "updated": counters["updated"], "orphaned": 0,
        }, errors + [{"key": "", "message": str(exc)}])
        raise

    return {"status": finish_status, **counters}


# ── Sync tasks ─────────────────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.sync.incremental_sync",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def incremental_sync(self: Task, job_id: str = "cron") -> dict:
    """Detect new or changed R2 objects since last sync and create/re-queue track stubs."""
    log = logger.bind(task_id=self.request.id, job_id=job_id)
    log.info("incremental_sync_start")

    db = get_db()
    job_oid = _ensure_sync_job(db, job_id, "incremental")
    counters = {"scanned": 0, "new": 0, "updated": 0, "orphaned": 0}
    errors = []

    # Watermark: last r2_last_modified among sync-ingested tracks
    last_track = db["tracks"].find_one(
        {"ingested_from_sync": True},
        sort=[("r2_last_modified", -1)],
    )
    since: datetime | None = last_track["r2_last_modified"] if last_track else None

    try:
        for obj in list_objects(prefix=_RAW_PREFIX):
            if not _is_audio(obj["key"]):
                continue
            counters["scanned"] += 1
            if since and obj["last_modified"] <= since:
                continue
            try:
                result = _create_or_update_track_stub(db, obj, mode="incremental")
                if result == "created":
                    counters["new"] += 1
                    _dispatch_processing(db, obj["key"])
                elif result == "updated":
                    counters["updated"] += 1
                    _dispatch_processing(db, obj["key"])
                    log.info("etag_changed_requeued", key=obj["key"])
            except Exception as exc:
                errors.append({"key": obj["key"], "message": str(exc)})
                log.warning("incremental_sync_item_failed", key=obj["key"], error=str(exc))

        _finish_job(db, job_oid, "complete", counters, errors)
        log.info("incremental_sync_complete", **counters)
    except Exception as exc:
        _finish_job(db, job_oid, "failed", counters, errors + [{"key": "", "message": str(exc)}])
        raise

    return {**counters, "errors": len(errors)}


@app.task(
    name="worker.tasks.sync.full_scan",
    bind=True,
    max_retries=1,
    soft_time_limit=3600,
)
def full_scan(self: Task, job_id: str = "cron") -> dict:
    """Full R2 bucket scan: index all unindexed/changed audio objects, detect orphans."""
    log = logger.bind(task_id=self.request.id, job_id=job_id)
    log.info("full_scan_start")

    db = get_db()
    job_oid = _ensure_sync_job(db, job_id, "full_scan")
    counters = {"scanned": 0, "new": 0, "updated": 0, "orphaned": 0}
    errors = []

    try:
        r2_keys: set[str] = set()

        for obj in list_objects(prefix=_RAW_PREFIX):
            if not _is_audio(obj["key"]):
                continue
            r2_keys.add(obj["key"])
            counters["scanned"] += 1
            try:
                result = _create_or_update_track_stub(db, obj, mode="full_scan")
                if result == "created":
                    counters["new"] += 1
                    _dispatch_processing(db, obj["key"])
                elif result == "updated":
                    counters["updated"] += 1
                    _dispatch_processing(db, obj["key"])
                    log.info("etag_changed_requeued", key=obj["key"])
            except Exception as exc:
                errors.append({"key": obj["key"], "message": str(exc)})

        # Orphan detection: MongoDB tracks whose r2_key_raw no longer exists in R2
        if r2_keys:
            cursor = db["tracks"].find(
                {"r2_key_raw": {"$regex": f"^{_RAW_PREFIX}"}},
                {"_id": 1, "r2_key_raw": 1},
            )
            for track in cursor:
                if track["r2_key_raw"] not in r2_keys:
                    counters["orphaned"] += 1
                    db["tracks"].update_one(
                        {"_id": track["_id"]},
                        {"$set": {"orphaned": True, "updated_at": _utc_now()}},
                    )
                    log.warning("orphan_detected", r2_key=track["r2_key_raw"])

        _finish_job(db, job_oid, "complete", counters, errors)
        log.info("full_scan_complete", **counters)
    except Exception as exc:
        _finish_job(db, job_oid, "failed", counters, errors + [{"key": "", "message": str(exc)}])
        raise

    return {**counters, "errors": len(errors)}


@app.task(
    name="worker.tasks.sync.metadata_reconciliation",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
)
def metadata_reconciliation(self: Task, job_id: str = "cron") -> dict:
    """Verify MongoDB track metadata is consistent with R2 object metadata."""
    log = logger.bind(task_id=self.request.id, job_id=job_id)
    log.info("reconciliation_start")

    db = get_db()
    job_oid = _ensure_sync_job(db, job_id, "metadata_reconciliation")
    counters = {"scanned": 0, "new": 0, "updated": 0, "orphaned": 0}
    errors = []

    try:
        cursor = db["tracks"].find(
            {"status": {"$in": ["ready", "pending"]}, "r2_key_raw": {"$regex": f"^{_RAW_PREFIX}"}},
            {"_id": 1, "r2_key_raw": 1, "file_size_bytes": 1, "r2_etag": 1, "md5": 1},
        ).limit(5000)

        for track in cursor:
            counters["scanned"] += 1
            try:
                from worker.storage.r2 import get_r2_client
                from worker.config import get_settings
                s = get_settings()
                response = get_r2_client().head_object(Bucket=s.r2_bucket, Key=track["r2_key_raw"])
                r2_size = response.get("ContentLength", 0)
                r2_etag = response.get("ETag", "").strip('"')

                stored_etag = track.get("r2_etag") or track.get("md5", "")
                size_changed = r2_size and r2_size != track.get("file_size_bytes")
                etag_changed = r2_etag and stored_etag and r2_etag != stored_etag

                if size_changed or etag_changed:
                    db["tracks"].update_one(
                        {"_id": track["_id"]},
                        {"$set": {
                            "file_size_bytes": r2_size,
                            "r2_etag": r2_etag,
                            "updated_at": _utc_now(),
                        }},
                    )
                    counters["updated"] += 1

            except Exception as exc:
                code = getattr(getattr(exc, "response", {}), "get", lambda k, d=None: d)("Error", {}).get("Code", "")
                if code in ("404", "NoSuchKey", "NotFound"):
                    counters["orphaned"] += 1
                    db["tracks"].update_one(
                        {"_id": track["_id"]},
                        {"$set": {"orphaned": True, "updated_at": _utc_now()}},
                    )
                else:
                    errors.append({"key": track.get("r2_key_raw", ""), "message": str(exc)})

        _finish_job(db, job_oid, "complete", counters, errors)
        log.info("reconciliation_complete", **counters)
    except Exception as exc:
        _finish_job(db, job_oid, "failed", counters, errors + [{"key": "", "message": str(exc)}])
        raise

    return {**counters, "errors": len(errors)}


@app.task(
    name="worker.tasks.sync.integrity_scan",
    bind=True,
    max_retries=1,
    soft_time_limit=7200,
)
def integrity_scan(self: Task, job_id: str = "cron") -> dict:
    """Verify SHA256 checksums for a sample of ready tracks and check backup coverage."""
    log = logger.bind(task_id=self.request.id, job_id=job_id)
    log.info("integrity_scan_start")

    import tempfile
    from worker.utils.hashing import sha256_file

    db = get_db()
    job_oid = _ensure_sync_job(db, job_id, "integrity_scan")
    counters = {"scanned": 0, "new": 0, "updated": 0, "orphaned": 0}
    errors = []
    mismatches = 0

    try:
        sample = list(db["tracks"].find(
            {"status": "ready", "sha256": {"$nin": ["", None]}},
            {"_id": 1, "r2_key_raw": 1, "sha256": 1},
        ).limit(500))

        for track in sample:
            counters["scanned"] += 1
            r2_key = track.get("r2_key_raw", "")
            if not r2_key:
                continue
            try:
                with tempfile.TemporaryDirectory(prefix="tamasha_int_") as tmp:
                    ext = os.path.splitext(r2_key)[1] or ".audio"
                    local = os.path.join(tmp, f"raw{ext}")
                    from worker.storage.r2 import download_to_file
                    download_to_file(r2_key, local)
                    actual_sha = sha256_file(local)
                    if actual_sha != track["sha256"]:
                        mismatches += 1
                        db["tracks"].update_one(
                            {"_id": track["_id"]},
                            {"$set": {"integrity_mismatch": True, "updated_at": _utc_now()}},
                        )
                        log.warning("integrity_mismatch", track_id=str(track["_id"]), r2_key=r2_key)
                        errors.append({"key": r2_key, "message": "SHA256 mismatch"})
            except Exception as exc:
                errors.append({"key": r2_key, "message": str(exc)})

        counters["updated"] = mismatches
        _finish_job(db, job_oid, "complete", counters, errors)
        log.info("integrity_scan_complete", scanned=counters["scanned"], mismatches=mismatches)
    except Exception as exc:
        _finish_job(db, job_oid, "failed", counters, errors + [{"key": "", "message": str(exc)}])
        raise

    return {**counters, "mismatches": mismatches, "errors": len(errors)}
