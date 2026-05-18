from __future__ import annotations

from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase
from redis.asyncio import Redis

from app.core.exceptions import ForbiddenError
from app.core.rbac import require_permission
from app.dependencies import get_db, get_redis, get_current_active_user
from app.models.user import UserDocument
from app.schemas.admin import BackupStatus, QueueHealth, StorageMetrics, SystemHealth
from app.services import admin_service

router = APIRouter(prefix="/admin", tags=["admin"])

_admin = require_permission("*")
_admin_read = require_permission("admin.read")

# Collections cleared by reset — billing and user data are preserved
_RESET_COLLECTIONS = [
    "tracks",
    "artists",
    "uploads",
    "sync_jobs",
    "analytics_events",
    "audit_logs",
    "duplicate_groups",
    "media_monitoring",
]


@router.get("/health", response_model=SystemHealth)
async def system_health(
    _actor: UserDocument = _admin_read,
    db: AsyncIOMotorDatabase = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> SystemHealth:
    return await admin_service.get_system_health(db, redis)


@router.get("/queue-health", response_model=QueueHealth)
async def queue_health(
    _actor: UserDocument = _admin_read,
    redis: Redis = Depends(get_redis),
) -> QueueHealth:
    return await admin_service.get_queue_health(redis)


@router.get("/storage-metrics", response_model=StorageMetrics)
async def storage_metrics(
    _actor: UserDocument = _admin_read,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> StorageMetrics:
    return await admin_service.get_storage_metrics(db)


@router.get("/backup-status", response_model=BackupStatus)
async def backup_status(
    _actor: UserDocument = _admin_read,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> BackupStatus:
    return await admin_service.get_backup_status(db)


@router.post("/reset-catalogue", status_code=200)
async def reset_catalogue(
    actor: UserDocument = Depends(get_current_active_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    """Drop all catalogue/media collections to allow a fresh R2 resync.
    Preserves users, billing, invoices, payment records, and arrangements."""
    if actor.role != "superadmin":
        raise ForbiddenError("Only superadmin can reset the catalogue")

    results = {}
    for col in _RESET_COLLECTIONS:
        r = await db[col].delete_many({})
        results[col] = r.deleted_count

    total = sum(results.values())
    return {"deleted": results, "total": total}


@router.post("/reindex", status_code=202)
async def trigger_reindex(
    _actor: UserDocument = _admin,
) -> dict:
    from app.tasks.sync import dispatch_full_scan_task
    # Dispatch a full scan which workers use to rebuild OpenSearch index
    try:
        task_id = dispatch_full_scan_task("manual-reindex")
    except Exception:
        task_id = None
    return {"message": "Reindex triggered", "task_id": task_id}


_FINGERPRINT_SETTING_KEY = "fingerprint_index_visible"
_superadmin = require_permission("billing.manage")  # only superadmin has this


@router.get("/settings/fingerprint-visible")
async def get_fingerprint_visible(
    _actor: UserDocument = _admin_read,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    doc = await db["settings"].find_one({"key": _FINGERPRINT_SETTING_KEY})
    return {"visible": doc.get("value", True) if doc else True}


@router.patch("/settings/fingerprint-visible")
async def set_fingerprint_visible(
    body: dict,
    _actor: UserDocument = _superadmin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    visible = bool(body.get("visible", True))
    await db["settings"].update_one(
        {"key": _FINGERPRINT_SETTING_KEY},
        {"$set": {"key": _FINGERPRINT_SETTING_KEY, "value": visible}},
        upsert=True,
    )
    return {"visible": visible}


@router.post("/fingerprint-index", status_code=202)
async def trigger_fingerprint_index(
    _actor: UserDocument = _admin,
) -> dict:
    """Dispatch fingerprint_all: indexes all canonical/non-duplicate tracks into RocksDB."""
    from app.tasks.fingerprint import dispatch_fingerprint_all
    try:
        task_id = dispatch_fingerprint_all()
    except Exception:
        task_id = None
    return {"message": "Fingerprint indexing triggered", "task_id": task_id}


_FP_CANCEL_KEY = "fingerprint:cancel"


@router.post("/fingerprint-cancel", status_code=200)
async def cancel_fingerprint_index(
    _actor: UserDocument = _admin,
    redis: Redis = Depends(get_redis),
) -> dict:
    """Signal the worker to stop accepting new fingerprint_track tasks."""
    await redis.set(_FP_CANCEL_KEY, "1", ex=3600)
    return {"cancelled": True}


@router.delete("/fingerprint-cancel", status_code=200)
async def clear_fingerprint_cancel(
    _actor: UserDocument = _admin,
    redis: Redis = Depends(get_redis),
) -> dict:
    await redis.delete(_FP_CANCEL_KEY)
    return {"cancelled": False}


@router.get("/fingerprint-progress")
async def fingerprint_progress(
    _actor: UserDocument = _admin_read,
    db: AsyncIOMotorDatabase = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> dict:
    from datetime import datetime, timezone

    total   = await db["tracks"].count_documents({"status": {"$nin": ["archived", "deleted"]}})
    indexed = await db["tracks"].count_documents({"fingerprinted": True})

    speed_mbps: float | None = None
    eta_seconds: int | None  = None
    bytes_done_mb: float | None = None

    if indexed > 0:
        # Aggregate bytes + earliest fingerprinted_at from indexed tracks
        done_agg = await db["tracks"].aggregate([
            {"$match": {"fingerprinted": True}},
            {"$group": {
                "_id": None,
                "bytes": {"$sum": "$file_size_bytes"},
                "started": {"$min": "$fingerprinted_at"},
            }},
        ]).to_list(1)

        if done_agg:
            row = done_agg[0]
            bytes_done  = row.get("bytes", 0) or 0
            started_at  = row.get("started")
            now         = datetime.now(timezone.utc)

            if started_at and bytes_done > 0:
                if started_at.tzinfo is None:
                    started_at = started_at.replace(tzinfo=timezone.utc)
                elapsed = max((now - started_at).total_seconds(), 1)
                bytes_per_sec = bytes_done / elapsed
                speed_mbps    = round(bytes_per_sec / (1024 * 1024), 2)
                bytes_done_mb = round(bytes_done / (1024 * 1024), 1)

                # Aggregate remaining bytes
                rem_agg = await db["tracks"].aggregate([
                    {"$match": {
                        "fingerprinted": {"$ne": True},
                        "status": {"$nin": ["archived", "deleted"]},
                    }},
                    {"$group": {"_id": None, "bytes": {"$sum": "$file_size_bytes"}}},
                ]).to_list(1)

                if rem_agg and bytes_per_sec > 0:
                    eta_seconds = int((rem_agg[0].get("bytes", 0) or 0) / bytes_per_sec)

    cancelled = bool(await redis.exists(_FP_CANCEL_KEY))

    return {
        "indexed":       indexed,
        "total":         total,
        "remaining":     total - indexed,
        "pct":           round(indexed / total * 100, 1) if total else 0.0,
        "speed_mbps":    speed_mbps,
        "bytes_done_mb": bytes_done_mb,
        "eta_seconds":   eta_seconds,
        "cancelled":     cancelled,
    }
