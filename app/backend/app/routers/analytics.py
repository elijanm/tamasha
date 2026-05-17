from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from redis.asyncio import Redis

from app.core.rbac import require_permission
from app.dependencies import get_current_active_user, get_db, get_redis
from app.models.user import UserDocument
from app.schemas.analytics import (
    AdminDashboard,
    AnalyticsEventBatchRequest,
    ArtistDashboard,
    TrackMetrics,
)
from app.services import analytics_service

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.post("/events", status_code=204)
async def ingest_events(
    body: AnalyticsEventBatchRequest,
    request: Request,
    actor: UserDocument = require_permission("analytics.ingest"),
    db: AsyncIOMotorDatabase = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> None:
    ip = getattr(request.state, "actor_ip", "")
    ua = getattr(request.state, "actor_ua", "")
    await analytics_service.ingest_events(db, redis, body, actor, ip, ua)


@router.get("/tracks/{track_id}", response_model=TrackMetrics)
async def get_track_metrics(
    track_id: str,
    window_days: int = Query(default=30, ge=1, le=365),
    _actor: UserDocument = require_permission("analytics.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> TrackMetrics:
    return await analytics_service.get_track_metrics(db, redis, track_id, window_days)


@router.get("/artists/{artist_id}", response_model=ArtistDashboard)
async def get_artist_dashboard(
    artist_id: str,
    window_days: int = Query(default=30, ge=1, le=365),
    actor: UserDocument = require_permission("analytics.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> ArtistDashboard:
    return await analytics_service.get_artist_dashboard(db, redis, artist_id, actor, window_days)


@router.get("/dashboard", response_model=AdminDashboard)
async def get_admin_dashboard(
    _actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> AdminDashboard:
    return await analytics_service.get_admin_dashboard(db, redis)


@router.post("/dashboard/invalidate", status_code=204)
async def invalidate_dashboard_cache(
    _actor: UserDocument = require_permission("*"),
    redis: Redis = Depends(get_redis),
) -> None:
    await redis.delete("analytics:admin:dashboard")


@router.get("/top-tracks")
async def get_top_tracks(
    limit: int = Query(default=10, ge=1, le=50),
    _actor: UserDocument = require_permission("analytics.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> list:
    docs = await db["tracks"].find(
        {"status": "ready"}, {"_id": 1, "title": 1, "stream_count": 1}
    ).sort("stream_count", -1).limit(limit).to_list(limit)
    return [{"track_id": str(d["_id"]), "title": d["title"], "stream_count": d.get("stream_count", 0)} for d in docs]


@router.get("/geography")
async def get_geography(
    window_days: int = Query(default=30, ge=1, le=365),
    _actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> list:
    from datetime import timedelta
    from app.utils.datetime_utils import utc_now
    since = utc_now() - timedelta(days=window_days)
    pipeline = [
        {"$match": {"event_type": "stream_start", "occurred_at": {"$gte": since}, "country": {"$ne": None}}},
        {"$group": {"_id": "$country", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 50},
    ]
    result = await db["analytics_events"].aggregate(pipeline).to_list(50)
    return [{"country": r["_id"], "count": r["count"]} for r in result]
