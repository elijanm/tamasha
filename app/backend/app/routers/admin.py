from __future__ import annotations

from fastapi import APIRouter, Depends
from motor.motor_asyncio import AsyncIOMotorDatabase
from redis.asyncio import Redis

from app.core.rbac import require_permission
from app.dependencies import get_db, get_redis
from app.models.user import UserDocument
from app.schemas.admin import BackupStatus, QueueHealth, StorageMetrics, SystemHealth
from app.services import admin_service

router = APIRouter(prefix="/admin", tags=["admin"])

_admin = require_permission("*")


@router.get("/health", response_model=SystemHealth)
async def system_health(
    _actor: UserDocument = _admin,
    db: AsyncIOMotorDatabase = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> SystemHealth:
    return await admin_service.get_system_health(db, redis)


@router.get("/queue-health", response_model=QueueHealth)
async def queue_health(
    _actor: UserDocument = _admin,
    redis: Redis = Depends(get_redis),
) -> QueueHealth:
    return await admin_service.get_queue_health(redis)


@router.get("/storage-metrics", response_model=StorageMetrics)
async def storage_metrics(
    _actor: UserDocument = _admin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> StorageMetrics:
    return await admin_service.get_storage_metrics(db)


@router.get("/backup-status", response_model=BackupStatus)
async def backup_status(
    _actor: UserDocument = _admin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> BackupStatus:
    return await admin_service.get_backup_status(db)


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
