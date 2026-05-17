from __future__ import annotations

import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase
from redis.asyncio import Redis

from app.core.celery_app import celery_app
from app.schemas.admin import (
    BackupStatus,
    QueueHealth,
    QueueInfo,
    StorageMetrics,
    StoragePrefixBreakdown,
    SystemHealth,
)
from app.utils.datetime_utils import utc_now

logger = structlog.get_logger(__name__)

_QUEUES = ["default", "transcoding", "sync", "backup", "email"]


async def get_system_health(
    db: AsyncIOMotorDatabase, redis: Redis
) -> SystemHealth:
    db_ok = False
    redis_ok = False

    try:
        await db.command("ping")
        db_ok = True
    except Exception as exc:
        logger.warning("db_health_check_failed", error=str(exc))

    try:
        await redis.ping()
        redis_ok = True
    except Exception as exc:
        logger.warning("redis_health_check_failed", error=str(exc))

    worker_count = 0
    queue_depths: dict[str, int] = {}
    try:
        inspect = celery_app.control.inspect(timeout=2.0)
        active = inspect.active() or {}
        worker_count = len(active)
        for queue in _QUEUES:
            depth = await redis.llen(queue) or 0
            queue_depths[queue] = int(depth)
    except Exception as exc:
        logger.warning("celery_health_check_failed", error=str(exc))

    overall = "ok" if db_ok and redis_ok else ("degraded" if db_ok or redis_ok else "down")
    return SystemHealth(
        status=overall,
        db_connected=db_ok,
        redis_connected=redis_ok,
        worker_count=worker_count,
        queue_depths=queue_depths,
    )


async def get_queue_health(redis: Redis) -> QueueHealth:
    queues: dict[str, QueueInfo] = {}
    try:
        inspect = celery_app.control.inspect(timeout=2.0)
        active_tasks = inspect.active() or {}
        scheduled_tasks = inspect.scheduled() or {}

        all_active: list = []
        for worker_tasks in active_tasks.values():
            all_active.extend(worker_tasks)
        all_scheduled: list = []
        for worker_tasks in scheduled_tasks.values():
            all_scheduled.extend(worker_tasks)

        for queue in _QUEUES:
            depth = int(await redis.llen(queue) or 0)
            active_count = sum(1 for t in all_active if t.get("delivery_info", {}).get("routing_key") == queue)
            sched_count = sum(1 for t in all_scheduled if t.get("delivery_info", {}).get("routing_key") == queue)
            queues[queue] = QueueInfo(depth=depth, active_tasks=active_count, scheduled_tasks=sched_count)
    except Exception as exc:
        logger.warning("queue_health_failed", error=str(exc))
        for queue in _QUEUES:
            queues[queue] = QueueInfo(depth=0, active_tasks=0, scheduled_tasks=0)

    return QueueHealth(queues=queues)


async def get_storage_metrics(db: AsyncIOMotorDatabase) -> StorageMetrics:
    pipeline = [
        {"$group": {"_id": None, "total_objects": {"$sum": 1}, "total_bytes": {"$sum": "$file_size_bytes"}}},
    ]
    result = await db["tracks"].aggregate(pipeline).to_list(1)
    total_objects = result[0]["total_objects"] if result else 0
    total_bytes = result[0]["total_bytes"] if result else 0

    # Breakdown by genre as a proxy for prefix segmentation
    breakdown_pipeline = [
        {"$group": {"_id": "$genre", "objects": {"$sum": 1}, "bytes": {"$sum": "$file_size_bytes"}}},
        {"$sort": {"bytes": -1}},
        {"$limit": 20},
    ]
    breakdown_docs = await db["tracks"].aggregate(breakdown_pipeline).to_list(20)
    breakdown = [
        StoragePrefixBreakdown(
            prefix=d["_id"] or "unknown",
            object_count=d["objects"],
            size_bytes=d["bytes"],
        )
        for d in breakdown_docs
    ]

    return StorageMetrics(
        total_objects=total_objects,
        total_bytes=total_bytes,
        total_gb=round(total_bytes / (1024 ** 3), 3),
        breakdown=breakdown,
    )


async def get_backup_status(db: AsyncIOMotorDatabase) -> BackupStatus:
    last_job = await db["sync_jobs"].find_one(
        {"mode": "integrity_scan"},
        sort=[("created_at", -1)],
    )
    if not last_job:
        return BackupStatus(last_run=None, status="never_run", objects_synced=0, errors=0)

    return BackupStatus(
        last_run=last_job.get("created_at"),
        status=last_job.get("status", "unknown"),
        objects_synced=last_job.get("objects_scanned", 0),
        errors=len(last_job.get("errors", [])),
    )
