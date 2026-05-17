from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.utils.object_id import PyObjectId


class AnalyticsEventRequest(BaseModel):
    event_type: Literal[
        "stream_start", "stream_complete", "stream_skip",
        "like", "unlike", "favorite", "unfavorite",
        "follow", "unfollow", "playlist_add",
    ]
    track_id: PyObjectId | None = None
    artist_id: PyObjectId | None = None
    playlist_id: PyObjectId | None = None
    session_id: str = Field(min_length=1, max_length=128)
    bitrate_kbps: int | None = None
    completion_pct: float | None = Field(default=None, ge=0.0, le=1.0)
    occurred_at: datetime | None = None


class AnalyticsEventBatchRequest(BaseModel):
    events: list[AnalyticsEventRequest] = Field(min_length=1, max_length=100)


class StreamTrendPoint(BaseModel):
    date: str  # ISO date string YYYY-MM-DD
    count: int


class GeoBreakdownItem(BaseModel):
    country: str
    count: int


class TrackMetrics(BaseModel):
    track_id: str
    total_streams: int
    unique_listeners: int
    avg_completion: float
    like_count: int
    top_countries: list[GeoBreakdownItem]
    stream_trend: list[StreamTrendPoint]


class TopTrackItem(BaseModel):
    track_id: str
    title: str
    stream_count: int
    like_count: int = 0


class ArtistDashboard(BaseModel):
    artist_id: str
    monthly_listeners: int
    total_streams: int
    total_likes: int
    top_tracks: list[TopTrackItem]
    listener_geography: list[GeoBreakdownItem]


class GenreItem(BaseModel):
    genre: str
    count: int


class BandwidthTrendPoint(BaseModel):
    date: str   # YYYY-MM-DD
    bytes: int


class AdminDashboard(BaseModel):
    total_tracks: int
    total_artists: int
    total_listeners: int
    total_streams_today: int
    total_streams_week: int
    needs_review_count: int
    top_tracks: list[TopTrackItem]
    top_liked: list[TopTrackItem]
    tracks_by_status: dict[str, int]
    ownership_breakdown: dict[str, int]
    genres: list[GenreItem]
    stream_trend: list[StreamTrendPoint]
    storage_used_gb: float
    active_jobs: int
    # Bandwidth / bytes-streamed metrics
    bytes_streamed_today: int = 0
    bytes_streamed_week: int = 0
    bytes_streamed_30d: int = 0
    bandwidth_trend: list[BandwidthTrendPoint] = []
