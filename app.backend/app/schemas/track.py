from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.pagination import PagedResponse
from app.utils.object_id import PyObjectId


class MetadataSnapshotResponse(BaseModel):
    version: int
    changed_by: PyObjectId
    changed_at: datetime
    snapshot: dict[str, Any]


class TrackResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: PyObjectId
    r2_key_raw: str
    r2_keys_transcoded: dict[str, str] = Field(default_factory=dict)
    artist_id: PyObjectId | None = None
    artist_name: str | None = None
    artist_name_raw: str | None = None
    album: str | None = None
    title: str
    year: int | None = None
    genre: str | None = None
    language: str | None = None
    duration_seconds: float | None = None
    file_size_bytes: int
    sha256: str
    artwork_r2_key: str | None = None
    artwork_url: str | None = None   # presigned URL, populated by router
    tags: list[str] = Field(default_factory=list)
    status: Literal["pending", "processing", "ready", "failed"] = "pending"
    metadata_version: int = 1
    stream_count: int = 0
    like_count: int = 0
    created_by: PyObjectId | None = None
    created_at: datetime
    updated_at: datetime
    # Path-parser output (set at ingest, displayed in staff review UI)
    workflow_tags: list[str] = Field(default_factory=list)
    needs_human_review: bool = False
    review_reasons: list[str] = Field(default_factory=list)
    inferred_metadata: dict[str, Any] | None = None
    # Extended metadata
    isrc: str | None = None
    label: str | None = None
    composer: str | None = None
    publisher: str | None = None
    copyright: str | None = None
    featuring: str | None = None
    band: str | None = None
    producer: str | None = None
    remixer: str | None = None
    bpm: float | None = None
    musical_key: str | None = None
    mood: str | None = None
    version: str | None = None
    release_date: str | None = None
    track_number: int | None = None
    disc_number: int | None = None
    upc: str | None = None
    catalogue_number: str | None = None
    explicit: bool = False


class TrackDetailResponse(TrackResponse):
    metadata_history: list[MetadataSnapshotResponse] = []
    skiza_clip_ids: list[PyObjectId] = []


class _ExtendedMetaMixin(BaseModel):
    isrc: str | None = Field(default=None, max_length=12)
    label: str | None = None
    composer: str | None = None
    publisher: str | None = None
    copyright: str | None = None
    featuring: str | None = None
    band: str | None = None
    producer: str | None = None
    remixer: str | None = None
    bpm: float | None = Field(default=None, ge=0, le=300)
    musical_key: str | None = None
    mood: str | None = None
    version: str | None = None
    release_date: str | None = None
    track_number: int | None = Field(default=None, ge=1)
    disc_number: int | None = Field(default=None, ge=1)
    upc: str | None = None
    catalogue_number: str | None = None
    explicit: bool = False


class TrackCreateRequest(_ExtendedMetaMixin):
    title: str = Field(min_length=1, max_length=500)
    r2_key_raw: str
    file_size_bytes: int = Field(default=0, ge=0)
    sha256: str | None = None
    md5: str | None = None
    artist_id: PyObjectId | None = None
    album: str | None = Field(default=None, max_length=300)
    year: int | None = Field(default=None, ge=1900, le=2100)
    genre: str | None = None
    language: str | None = None
    duration_seconds: float | None = None
    tags: list[str] = Field(default_factory=list)


class TrackUpdateRequest(_ExtendedMetaMixin):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    artist_id: PyObjectId | None = None
    album: str | None = Field(default=None, max_length=300)
    year: int | None = Field(default=None, ge=1900, le=2100)
    genre: str | None = None
    language: str | None = None
    duration_seconds: float | None = None
    tags: list[str] | None = None
    status: Literal["pending", "processing", "ready", "failed"] | None = None
    workflow_tags: list[str] | None = None
    needs_human_review: bool | None = None
    # extended fields inherited from _ExtendedMetaMixin are all optional (None = no change)


class TrackArtistAssignRequest(BaseModel):
    artist_id: PyObjectId


TrackListResponse = PagedResponse[TrackResponse]
