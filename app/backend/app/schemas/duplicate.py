from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.core.pagination import PagedResponse
from app.schemas.track import TrackResponse
from app.utils.object_id import PyObjectId


class QualityBreakdownSchema(BaseModel):
    format_score: int = 0
    bitrate_score: int = 0
    duration_score: int = 0
    metadata_score: int = 0
    size_score: int = 0
    total: int = 0


class DuplicateTrackEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    track: TrackResponse
    quality_score: int
    quality_breakdown: QualityBreakdownSchema
    stream_url: str | None = None


class DuplicateGroupResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: PyObjectId
    detection_method: str
    confidence: float
    track_count: int
    canonical_track_id: PyObjectId | None = None
    representative_title: str | None = None
    status: str
    bytes_freed: int = 0
    notes: str | None = None
    created_at: datetime
    updated_at: datetime


class DuplicateGroupDetailResponse(DuplicateGroupResponse):
    tracks: list[DuplicateTrackEntry] = Field(default_factory=list)


DuplicateGroupListResponse = PagedResponse[DuplicateGroupResponse]


class ResolveGroupRequest(BaseModel):
    canonical_track_id: str


class DuplicateMetrics(BaseModel):
    total_groups: int
    pending_groups: int
    resolved_groups: int
    reclaimable_files: int
    reclaimable_bytes: int
    bytes_already_freed: int
    detection_breakdown: dict[str, int]
