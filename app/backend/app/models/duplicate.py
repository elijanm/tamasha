from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.utils.object_id import PyObjectId


class QualityBreakdown(BaseModel):
    format_score: int = 0    # 0-30
    bitrate_score: int = 0   # 0-25
    duration_score: int = 0  # 0-20
    metadata_score: int = 0  # 0-15
    size_score: int = 0      # 0-10
    total: int = 0


class DuplicateGroupTrack(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    track_id: PyObjectId
    quality_score: int = 0
    quality_breakdown: QualityBreakdown = Field(default_factory=QualityBreakdown)


class DuplicateGroupDocument(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )

    id: PyObjectId | None = Field(default=None, alias="_id")
    detection_method: str          # "sha256" | "fingerprint" | "metadata"
    confidence: float = 1.0
    track_ids: list[PyObjectId] = Field(default_factory=list)
    track_scores: list[DuplicateGroupTrack] = Field(default_factory=list)
    canonical_track_id: PyObjectId | None = None
    status: str = "pending_review"  # "pending_review" | "resolved"
    reviewed_by: PyObjectId | None = None
    reviewed_at: datetime | None = None
    bytes_freed: int = 0
    notes: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
