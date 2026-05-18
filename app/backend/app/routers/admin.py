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


@router.get("/fingerprint-progress")
async def fingerprint_progress(
    _actor: UserDocument = _admin_read,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    total = await db["tracks"].count_documents({"status": {"$nin": ["archived", "deleted"]}})
    indexed = await db["tracks"].count_documents({"fingerprinted": True})
    return {
        "indexed": indexed,
        "total": total,
        "remaining": total - indexed,
        "pct": round(indexed / total * 100, 1) if total else 0.0,
    }
