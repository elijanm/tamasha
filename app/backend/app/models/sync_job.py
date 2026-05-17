from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.utils.object_id import PyObjectId


class SyncError(BaseModel):
    key: str
    message: str


class SyncJobDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: PyObjectId | None = Field(default=None, alias="_id")
    mode: Literal[
        "incremental", "metadata_reconciliation", "full_scan", "integrity_scan",
        "pool_all", "batch_enrich_metadata", "dedup_scan"
    ]
    triggered_by: PyObjectId | None = None  # None for cron-triggered jobs
    status: Literal["queued", "running", "complete", "failed", "cancelled"] = "queued"
    celery_task_id: str | None = None
    objects_scanned: int = 0
    objects_new: int = 0
    objects_updated: int = 0
    objects_orphaned: int = 0
    errors: list[SyncError] = Field(default_factory=list)
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
