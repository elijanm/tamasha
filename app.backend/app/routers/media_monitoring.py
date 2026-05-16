from __future__ import annotations

from datetime import timedelta

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.exceptions import NotFoundError
from app.core.pagination import PageParams
from app.core.rbac import require_permission
from app.dependencies import get_db
from app.models.user import UserDocument
from app.schemas.media_monitoring import (
    AirplayLog,
    AirplayLogCreate,
    AirplayTrendPoint,
    MonitoringDashboard,
    RadioStation,
    RadioStationCreate,
    RadioStationUpdate,
    StationRevenueSummary,
    TrackAirplaySummary,
)
from app.utils.datetime_utils import utc_now

router = APIRouter(prefix="/media-monitoring", tags=["media-monitoring"])


def _station_out(doc: dict) -> RadioStation:
    return RadioStation(
        id=str(doc["_id"]),
        name=doc["name"],
        frequency=doc.get("frequency"),
        country=doc.get("country", "KE"),
        region=doc.get("region"),
        royalty_rate=doc.get("royalty_rate", 0.0),
        is_active=doc.get("is_active", True),
        created_at=doc["created_at"],
    )


def _log_out(doc: dict) -> AirplayLog:
    return AirplayLog(
        id=str(doc["_id"]),
        track_id=str(doc["track_id"]),
        track_title=doc.get("track_title"),
        station_id=str(doc["station_id"]),
        station_name=doc.get("station_name"),
        played_at=doc["played_at"],
        duration_seconds=doc.get("duration_seconds", 0),
        revenue=doc.get("revenue", 0.0),
        notes=doc.get("notes"),
        logged_by=doc.get("logged_by"),
        created_at=doc["created_at"],
    )


# ── Stations ──────────────────────────────────────────────────────────────────

@router.get("/stations", response_model=list[RadioStation])
async def list_stations(
    active_only: bool = Query(default=False),
    _actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> list[RadioStation]:
    filt: dict = {}
    if active_only:
        filt["is_active"] = True
    docs = await db["radio_stations"].find(filt).sort("name", 1).to_list(200)
    return [_station_out(d) for d in docs]


@router.post("/stations", response_model=RadioStation, status_code=201)
async def create_station(
    body: RadioStationCreate,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> RadioStation:
    now = utc_now()
    doc = {**body.model_dump(), "is_active": True, "created_at": now}
    result = await db["radio_stations"].insert_one(doc)
    doc["_id"] = result.inserted_id
    return _station_out(doc)


@router.patch("/stations/{station_id}", response_model=RadioStation)
async def update_station(
    station_id: str,
    body: RadioStationUpdate,
    _actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> RadioStation:
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        doc = await db["radio_stations"].find_one({"_id": ObjectId(station_id)})
    else:
        doc = await db["radio_stations"].find_one_and_update(
            {"_id": ObjectId(station_id)},
            {"$set": updates},
            return_document=True,
        )
    if not doc:
        raise NotFoundError("Station not found")
    return _station_out(doc)


@router.delete("/stations/{station_id}", status_code=204)
async def deactivate_station(
    station_id: str,
    _actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    await db["radio_stations"].update_one(
        {"_id": ObjectId(station_id)},
        {"$set": {"is_active": False}},
    )


# ── Airplay logs ──────────────────────────────────────────────────────────────

@router.post("/airplays", response_model=AirplayLog, status_code=201)
async def log_airplay(
    body: AirplayLogCreate,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> AirplayLog:
    now = utc_now()
    station = await db["radio_stations"].find_one({"_id": ObjectId(body.station_id)})
    if not station:
        raise NotFoundError("Station not found")
    track = await db["tracks"].find_one({"_id": ObjectId(body.track_id)}, {"title": 1})
    revenue = round(station.get("royalty_rate", 0.0), 4)
    doc = {
        "track_id": ObjectId(body.track_id),
        "track_title": (track or {}).get("title"),
        "station_id": ObjectId(body.station_id),
        "station_name": station["name"],
        "played_at": body.played_at,
        "duration_seconds": body.duration_seconds,
        "revenue": revenue,
        "notes": body.notes,
        "logged_by": str(actor.id),
        "created_at": now,
    }
    result = await db["airplay_logs"].insert_one(doc)
    doc["_id"] = result.inserted_id
    return _log_out(doc)


@router.get("/airplays", response_model=list[AirplayLog])
async def list_airplays(
    station_id: str | None = Query(default=None),
    track_id: str | None = Query(default=None),
    limit: int = Query(default=50, le=200),
    skip: int = Query(default=0, ge=0),
    _actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> list[AirplayLog]:
    filt: dict = {}
    if station_id:
        filt["station_id"] = ObjectId(station_id)
    if track_id:
        filt["track_id"] = ObjectId(track_id)
    docs = await db["airplay_logs"].find(filt).sort("played_at", -1).skip(skip).limit(limit).to_list(limit)
    return [_log_out(d) for d in docs]


# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/dashboard", response_model=MonitoringDashboard)
async def dashboard(
    window_days: int = Query(default=30, ge=1, le=365),
    _actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> MonitoringDashboard:
    since = utc_now() - timedelta(days=window_days)
    match = {"played_at": {"$gte": since}}

    total_airplays = await db["airplay_logs"].count_documents(match)

    dur_result = await db["airplay_logs"].aggregate([
        {"$match": match},
        {"$group": {"_id": None, "total_dur": {"$sum": "$duration_seconds"}, "total_rev": {"$sum": "$revenue"}}},
    ]).to_list(1)
    total_duration = dur_result[0]["total_dur"] if dur_result else 0
    total_revenue = round(dur_result[0]["total_rev"] if dur_result else 0.0, 2)

    active_stations = await db["radio_stations"].count_documents({"is_active": True})

    top_tracks_pipeline = [
        {"$match": match},
        {"$group": {
            "_id": "$track_id",
            "title":          {"$first": "$track_title"},
            "total_plays":    {"$sum": 1},
            "total_duration": {"$sum": "$duration_seconds"},
            "total_revenue":  {"$sum": "$revenue"},
        }},
        {"$sort": {"total_plays": -1}},
        {"$limit": 10},
    ]
    top_tracks_docs = await db["airplay_logs"].aggregate(top_tracks_pipeline).to_list(10)
    top_tracks = [
        TrackAirplaySummary(
            track_id=str(d["_id"]),
            title=d.get("title") or "Untitled",
            total_plays=d["total_plays"],
            total_duration_seconds=d["total_duration"],
            total_revenue=round(d["total_revenue"], 2),
        )
        for d in top_tracks_docs
    ]

    station_pipeline = [
        {"$match": match},
        {"$group": {
            "_id":          "$station_id",
            "station_name": {"$first": "$station_name"},
            "total_plays":  {"$sum": 1},
            "total_revenue":{"$sum": "$revenue"},
        }},
        {"$sort": {"total_revenue": -1}},
        {"$limit": 15},
    ]
    station_docs = await db["airplay_logs"].aggregate(station_pipeline).to_list(15)
    revenue_by_station = [
        StationRevenueSummary(
            station_id=str(d["_id"]),
            station_name=d.get("station_name") or "Unknown",
            total_plays=d["total_plays"],
            total_revenue=round(d["total_revenue"], 2),
        )
        for d in station_docs
    ]

    trend_pipeline = [
        {"$match": match},
        {"$group": {
            "_id":     {"$dateToString": {"format": "%Y-%m-%d", "date": "$played_at"}},
            "plays":   {"$sum": 1},
            "revenue": {"$sum": "$revenue"},
        }},
        {"$sort": {"_id": 1}},
    ]
    trend_docs = await db["airplay_logs"].aggregate(trend_pipeline).to_list(window_days)
    airplay_trend = [
        AirplayTrendPoint(date=d["_id"], plays=d["plays"], revenue=round(d["revenue"], 2))
        for d in trend_docs
    ]

    return MonitoringDashboard(
        total_airplays=total_airplays,
        total_duration_seconds=total_duration,
        total_revenue=total_revenue,
        active_stations=active_stations,
        top_tracks=top_tracks,
        revenue_by_station=revenue_by_station,
        airplay_trend=airplay_trend,
    )
