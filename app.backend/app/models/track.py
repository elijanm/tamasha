from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.utils.object_id import PyObjectId


class MetadataSnapshot(BaseModel):
    """Immutable record of track metadata at a particular version."""

    version: int
    changed_by: PyObjectId
    changed_at: datetime = Field(default_factory=datetime.utcnow)
    snapshot: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(arbitrary_types_allowed=True)


class TrackDocument(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
    )

    id: PyObjectId | None = Field(default=None, alias="_id")
    r2_key_raw: str                         # immutable once set
    r2_keys_transcoded: dict[str, str] = Field(default_factory=dict)
    artist_id: PyObjectId | None = None
    artist_name: str | None = None   # injected by list_tracks; not stored in DB
    artist_name_raw: str | None = None  # raw name from ID3/path enrichment
    album: str | None = None
    title: str
    year: int | None = None
    genre: str | None = None
    language: str | None = None
    duration_seconds: float | None = None
    file_size_bytes: int
    sha256: str
    md5: str
    artwork_r2_key: str | None = None
    waveform_r2_key: str | None = None
    tags: list[str] = Field(default_factory=list)
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
    status: Literal["pending", "processing", "ready", "failed"] = "pending"
    metadata_version: int = 1
    metadata_history: list[MetadataSnapshot] = Field(default_factory=list)
    duplicate_group_id: PyObjectId | None = None
    is_canonical: bool = False
    skiza_clip_ids: list[PyObjectId] = Field(default_factory=list)
    stream_count: int = 0
    like_count: int = 0
    created_by: PyObjectId | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    # Path-parser output stored at ingest time
    workflow_tags: list[str] = Field(default_factory=list)
    needs_human_review: bool = False
    review_reasons: list[str] = Field(default_factory=list)
    inferred_metadata: dict[str, Any] | None = None
