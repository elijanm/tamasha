from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.utils.object_id import PyObjectId


class AnalyticsEventDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: PyObjectId | None = Field(default=None, alias="_id")
    event_type: Literal[
        "stream_start", "stream_complete", "stream_skip",
        "like", "unlike", "favorite", "unfavorite",
        "follow", "unfollow", "playlist_add",
    ]
    track_id: PyObjectId | None = None
    artist_id: PyObjectId | None = None
    playlist_id: PyObjectId | None = None
    user_id: PyObjectId | None = None
    session_id: str
    ip_address: str = ""
    country: str | None = None
    city: str | None = None
    device_type: str | None = None
    browser: str | None = None
    bitrate_kbps: int | None = None
    completion_pct: float | None = None  # 0.0–1.0 for stream events
    occurred_at: datetime = Field(default_factory=datetime.utcnow)
