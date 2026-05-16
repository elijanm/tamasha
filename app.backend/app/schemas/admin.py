from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class QueueInfo(BaseModel):
    depth: int
    active_tasks: int
    scheduled_tasks: int


class SystemHealth(BaseModel):
    status: Literal["ok", "degraded", "down"]
    db_connected: bool
    redis_connected: bool
    worker_count: int
    queue_depths: dict[str, int]


class QueueHealth(BaseModel):
    queues: dict[str, QueueInfo]


class StoragePrefixBreakdown(BaseModel):
    prefix: str
    object_count: int
    size_bytes: int


class StorageMetrics(BaseModel):
    total_objects: int
    total_bytes: int
    total_gb: float
    breakdown: list[StoragePrefixBreakdown]


class BackupStatus(BaseModel):
    last_run: datetime | None
    status: str
    objects_synced: int
    errors: int
