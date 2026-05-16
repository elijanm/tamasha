from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class RadioStationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    frequency: str | None = Field(default=None, max_length=30)  # e.g. "98.4 FM"
    country: str = "KE"
    region: str | None = None
    royalty_rate: float = Field(default=0.0, ge=0)  # KES per play


class RadioStationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    frequency: str | None = None
    country: str | None = None
    region: str | None = None
    royalty_rate: float | None = Field(default=None, ge=0)
    is_active: bool | None = None


class RadioStation(BaseModel):
    id: str
    name: str
    frequency: str | None
    country: str
    region: str | None
    royalty_rate: float
    is_active: bool
    created_at: datetime


class AirplayLogCreate(BaseModel):
    track_id: str
    station_id: str
    played_at: datetime
    duration_seconds: int = Field(default=0, ge=0)
    notes: str | None = None


class AirplayLog(BaseModel):
    id: str
    track_id: str
    track_title: str | None
    station_id: str
    station_name: str | None
    played_at: datetime
    duration_seconds: int
    revenue: float
    notes: str | None
    logged_by: str | None
    created_at: datetime


class TrackAirplaySummary(BaseModel):
    track_id: str
    title: str
    total_plays: int
    total_duration_seconds: int
    total_revenue: float


class StationRevenueSummary(BaseModel):
    station_id: str
    station_name: str
    total_plays: int
    total_revenue: float


class AirplayTrendPoint(BaseModel):
    date: str   # YYYY-MM-DD
    plays: int
    revenue: float


class MonitoringDashboard(BaseModel):
    total_airplays: int
    total_duration_seconds: int
    total_revenue: float
    active_stations: int
    top_tracks: list[TrackAirplaySummary]
    revenue_by_station: list[StationRevenueSummary]
    airplay_trend: list[AirplayTrendPoint]
