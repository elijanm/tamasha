from __future__ import annotations

import os
import io
import tempfile
from datetime import datetime, timezone
from typing import Iterator

import structlog
from bson import ObjectId
from celery import Task

from worker.celery_app import app
from worker.config import get_settings
from worker.db.mongo import get_db
from worker.storage.r2 import download_to_file, list_objects, get_r2_client

logger = structlog.get_logger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _get_backup_client(destination: str):
    """Return a boto3 S3 client configured for the given backup destination."""
    s = get_settings()
    import boto3
    configs: dict[str, dict] = {
        "b2": {
            "endpoint_url": s.b2_endpoint_url,
            "aws_access_key_id": s.b2_key_id,
            "aws_secret_access_key": s.b2_application_key,
            "region_name": "us-east-005",
        },
        "wasabi": {
            "endpoint_url": s.wasabi_endpoint_url,
            "aws_access_key_id": s.wasabi_access_key,
            "aws_secret_access_key": s.wasabi_secret_key,
            "region_name": s.wasabi_region or "us-east-1",
        },
        "glacier": {
            "aws_access_key_id": s.aws_access_key_id,
            "aws_secret_access_key": s.aws_secret_access_key,
            "region_name": s.aws_region or "us-east-1",
        },
    }
    if destination not in configs:
        raise ValueError(f"Unknown backup destination: {destination}")
    cfg = configs[destination]
    return boto3.client("s3", **{k: v for k, v in cfg.items() if v})


def _destination_bucket(destination: str) -> str:
    s = get_settings()
    return {
        "b2": s.b2_bucket,
        "wasabi": s.wasabi_bucket,
        "glacier": s.aws_glacier_bucket,
    }.get(destination, "tamasha-backup")


def _object_exists_in_dest(client, bucket: str, key: str) -> bool:
    try:
        client.head_object(Bucket=bucket, Key=key)
        return True
    except Exception:
        return False


# ── Single-destination sync ────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.backup.sync_to_destination",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
    autoretry_for=(Exception,),
    retry_backoff=True,
    soft_time_limit=14400,   # 4 hours
)
def sync_to_destination(
    self: Task,
    destination: str,
    prefix: str = "music/raw/",
    job_id: str | None = None,
) -> dict:
    """Copy R2 objects under *prefix* to a backup destination (b2/wasabi/glacier).

    Already-present objects are skipped (content-addressed via ETag comparison).
    Never deletes from the destination.
    """
    log = logger.bind(task_id=self.request.id, destination=destination, prefix=prefix)
    log.info("backup_sync_start")

    db = get_db()
    job_oid = _ensure_backup_job(db, job_id, destination, prefix)

    try:
        dest_client = _get_backup_client(destination)
    except Exception as exc:
        _finish_backup_job(db, job_oid, "failed", {}, [str(exc)])
        raise

    bucket = _destination_bucket(destination)
    counters = {"scanned": 0, "copied": 0, "skipped": 0, "failed": 0}
    errors: list[str] = []

    r2 = get_r2_client()
    s = get_settings()

    for obj in list_objects(prefix=prefix):
        counters["scanned"] += 1
        key = obj["key"]

        try:
            # Skip if destination already has object with matching ETag
            if _object_exists_in_dest(dest_client, bucket, key):
                counters["skipped"] += 1
                continue

            # Stream from R2 to destination
            with tempfile.TemporaryDirectory(prefix="tamasha_bk_") as tmp:
                local = os.path.join(tmp, os.path.basename(key))
                download_to_file(key, local)
                dest_client.upload_file(
                    local, bucket, key,
                    ExtraArgs={"StorageClass": "STANDARD" if destination != "glacier" else "DEEP_ARCHIVE"},
                )

            counters["copied"] += 1
            log.debug("object_copied", key=key, destination=destination)

        except Exception as exc:
            counters["failed"] += 1
            errors.append(f"{key}: {exc}")
            log.warning("object_copy_failed", key=key, destination=destination, error=str(exc))
            if counters["failed"] >= 50:
                log.error("too_many_failures_aborting")
                break

    status = "failed" if counters["failed"] > 0 and counters["copied"] == 0 else "complete"
    _finish_backup_job(db, job_oid, status, counters, errors)
    log.info("backup_sync_complete", destination=destination, **counters)

    return {**counters, "destination": destination, "errors": len(errors)}


# ── Full backup: all destinations ─────────────────────────────────────────────

@app.task(
    name="worker.tasks.backup.full_backup",
    bind=True,
    max_retries=1,
    soft_time_limit=28800,   # 8 hours
)
def full_backup(self: Task) -> dict:
    """Dispatch sync_to_destination for all configured backup destinations."""
    log = logger.bind(task_id=self.request.id)
    s = get_settings()

    destinations = []
    if getattr(s, "b2_bucket", None):
        destinations.append("b2")
    if getattr(s, "wasabi_bucket", None):
        destinations.append("wasabi")
    if getattr(s, "aws_glacier_bucket", None):
        destinations.append("glacier")

    if not destinations:
        log.warning("no_backup_destinations_configured")
        return {"dispatched": 0}

    db = get_db()
    dispatched = 0
    for dest in destinations:
        for prefix in ("music/raw/", "music/transcoded/", "music/skiza/"):
            job = db["backup_jobs"].insert_one({
                "destination": dest,
                "prefix": prefix,
                "status": "queued",
                "triggered_by": None,
                "objects_scanned": 0,
                "objects_copied": 0,
                "objects_skipped": 0,
                "objects_failed": 0,
                "errors": [],
                "started_at": None,
                "completed_at": None,
                "created_at": _utc_now(),
            })
            sync_to_destination.apply_async(
                kwargs={
                    "destination": dest,
                    "prefix": prefix,
                    "job_id": str(job.inserted_id),
                },
                queue="backup",
            )
            dispatched += 1

    log.info("full_backup_dispatched", count=dispatched)
    return {"dispatched": dispatched, "destinations": destinations}


# ── Backup verification ────────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.backup.verify_backup_coverage",
    bind=True,
    max_retries=1,
    soft_time_limit=3600,
)
def verify_backup_coverage(self: Task, destination: str, sample_size: int = 200) -> dict:
    """Spot-check that a random sample of tracks exist in the backup destination."""
    log = logger.bind(task_id=self.request.id, destination=destination)
    log.info("backup_verify_start")

    db = get_db()
    try:
        dest_client = _get_backup_client(destination)
        bucket = _destination_bucket(destination)
    except Exception as exc:
        log.error("backup_verify_setup_failed", error=str(exc))
        return {"destination": destination, "error": str(exc)}

    sample = list(db["tracks"].find(
        {"status": "ready", "r2_key_raw": {"$exists": True}},
        {"_id": 1, "r2_key_raw": 1},
    ).limit(sample_size))

    present = 0
    missing = 0
    missing_keys: list[str] = []

    for track in sample:
        key = track.get("r2_key_raw", "")
        if not key:
            continue
        if _object_exists_in_dest(dest_client, bucket, key):
            present += 1
        else:
            missing += 1
            missing_keys.append(key)

    coverage_pct = round(present / len(sample) * 100, 1) if sample else 0.0

    log.info("backup_verify_complete",
             destination=destination,
             present=present, missing=missing,
             coverage_pct=coverage_pct)

    if missing > 0:
        log.warning("backup_gaps_found", missing_keys=missing_keys[:10])

    return {
        "destination": destination,
        "sample_size": len(sample),
        "present": present,
        "missing": missing,
        "coverage_pct": coverage_pct,
        "missing_keys_sample": missing_keys[:10],
    }


# ── Job helpers ────────────────────────────────────────────────────────────────

def _ensure_backup_job(db, job_id: str | None, destination: str, prefix: str) -> ObjectId:
    if not job_id:
        result = db["backup_jobs"].insert_one({
            "destination": destination,
            "prefix": prefix,
            "status": "running",
            "triggered_by": None,
            "objects_scanned": 0,
            "objects_copied": 0,
            "objects_skipped": 0,
            "objects_failed": 0,
            "errors": [],
            "started_at": _utc_now(),
            "completed_at": None,
            "created_at": _utc_now(),
        })
        return result.inserted_id
    try:
        oid = ObjectId(job_id)
        db["backup_jobs"].update_one(
            {"_id": oid},
            {"$set": {"status": "running", "started_at": _utc_now()}},
        )
        return oid
    except Exception:
        return _ensure_backup_job(db, None, destination, prefix)


def _finish_backup_job(db, job_oid: ObjectId, status: str, counters: dict, errors: list) -> None:
    db["backup_jobs"].update_one(
        {"_id": job_oid},
        {"$set": {
            "status": status,
            "completed_at": _utc_now(),
            "objects_scanned": counters.get("scanned", 0),
            "objects_copied": counters.get("copied", 0),
            "objects_skipped": counters.get("skipped", 0),
            "objects_failed": counters.get("failed", 0),
            "errors": errors[-50:],
        }},
    )
