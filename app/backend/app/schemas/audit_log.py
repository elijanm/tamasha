from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.pagination import PagedResponse
from app.utils.object_id import PyObjectId


# ─── My Work ──────────────────────────────────────────────────────────────────

class WorkTotals(BaseModel):
    total_actions: int = 0
    tracks_created: int = 0
    tracks_updated: int = 0
    tracks_deleted: int = 0
    tracks_assigned_artist: int = 0
    tracks_artwork_updated: int = 0
    uploads_completed: int = 0
    artists_created: int = 0
    artists_updated: int = 0
    duplicates_resolved: int = 0


class ActionCount(BaseModel):
    action: str
    count: int


class TimelineBucket(BaseModel):
    bucket: str
    count: int


class WorkSummary(BaseModel):
    from_date: datetime
    to_date: datetime
    totals: WorkTotals
    action_counts: list[ActionCount]
    timeline: list[TimelineBucket]
    projected_today: int | None = None


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: PyObjectId = Field(alias="_id")
    actor_id: str | None = None
    actor_role: str = ""
    actor_ip: str = ""
    actor_ua: str = ""
    action: str
    entity_type: str
    entity_id: str
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None
    request_id: str = ""
    occurred_at: datetime


class AuditLogFilter(BaseModel):
    actor_id: str | None = None
    action: str | None = None
    entity_type: str | None = None
    entity_id: str | None = None
    from_date: datetime | None = None
    to_date: datetime | None = None


AuditLogListResponse = PagedResponse[AuditLogResponse]
