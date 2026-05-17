from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel

from app.core.pagination import PagedResponse
from app.utils.object_id import PyObjectId


class SyncJobTriggerRequest(BaseModel):
    mode: Literal[
        "incremental", "metadata_reconciliation", "full_scan", "integrity_scan",
        "pool_all", "batch_enrich_metadata"
    ]
    prefix: str = "music/"
    dispatch: bool = False
    batch_size: int = 100
    only_missing_artist: bool = False


class SyncErrorResponse(BaseModel):
    key: str
    message: str


class SyncJobResponse(BaseModel):
    id: PyObjectId
    mode: Literal[
        "incremental", "metadata_reconciliation", "full_scan", "integrity_scan",
        "pool_all", "batch_enrich_metadata", "dedup_scan"
    ]
    triggered_by: PyObjectId | None = None
    status: Literal["queued", "running", "complete", "failed", "cancelled"]
    celery_task_id: str | None = None
    objects_scanned: int
    objects_new: int
    objects_updated: int
    objects_orphaned: int
    errors: list[SyncErrorResponse]
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime


SyncJobListResponse = PagedResponse[SyncJobResponse]
