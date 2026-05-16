from __future__ import annotations

import asyncio
import json
from datetime import timedelta

import structlog
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase
from redis.asyncio import Redis

from app.core.exceptions import ForbiddenError
from app.models.user import UserDocument
from app.schemas.analytics import (
    AdminDashboard,
    AnalyticsEventBatchRequest,
    ArtistDashboard,
    BandwidthTrendPoint,
    GenreItem,
    GeoBreakdownItem,
    StreamTrendPoint,
    TopTrackItem,
    TrackMetrics,
)
from app.utils.datetime_utils import utc_now

logger = structlog.get_logger(__name__)

_CACHE_TTL = 300  # 5 minutes
_ADMIN_CACHE_TTL = 10  # 10 seconds — allows metrics to reflect pool/sync within one poll cycle


async def ingest_events(
    db: AsyncIOMotorDatabase,
    redis: Redis,
    batch: AnalyticsEventBatchRequest,
    actor: UserDocument | None,
    ip: str = "",
    ua: str = "",
) -> None:
    docs = []
    now = utc_now()
    for event in batch.events:
        dedup_key = f"analytics:dedup:{event.session_id}:{event.event_type}:{event.track_id}"
        if await redis.exists(dedup_key):
            continue
        await redis.setex(dedup_key, 300, "1")

        doc = {
            "event_type": event.event_type,
            "track_id": ObjectId(str(event.track_id)) if event.track_id else None,
            "artist_id": ObjectId(str(event.artist_id)) if event.artist_id else None,
            "playlist_id": ObjectId(str(event.playlist_id)) if event.playlist_id else None,
            "user_id": ObjectId(str(actor.id)) if actor else None,
            "session_id": event.session_id,
            "ip_address": ip,
            "country": None,
            "city": None,
            "device_type": _parse_device(ua),
            "browser": _parse_browser(ua),
            "bitrate_kbps": event.bitrate_kbps,
            "completion_pct": event.completion_pct,
            "occurred_at": event.occurred_at or now,
        }
        docs.append(doc)

    if docs:
        await db["analytics_events"].insert_many(docs)


def _parse_device(ua: str) -> str | None:
    ua_lower = ua.lower()
    if "mobile" in ua_lower:
        return "mobile"
    if "tablet" in ua_lower:
        return "tablet"
    if ua:
        return "desktop"
    return None


def _parse_browser(ua: str) -> str | None:
    ua_lower = ua.lower()
    for browser in ("chrome", "firefox", "safari", "edge", "opera"):
        if browser in ua_lower:
            return browser
    return None


async def get_track_metrics(
    db: AsyncIOMotorDatabase,
    redis: Redis,
    track_id: str,
    window_days: int = 30,
) -> TrackMetrics:
    cache_key = f"analytics:track:{track_id}:{window_days}"
    cached = await redis.get(cache_key)
    if cached:
        return TrackMetrics.model_validate_json(cached)

    since = utc_now() - timedelta(days=window_days)
    match = {"track_id": ObjectId(track_id), "occurred_at": {"$gte": since}}

    # Total streams
    total_streams = await db["analytics_events"].count_documents(
        {**match, "event_type": "stream_start"}
    )

    # Unique listeners
    unique_pipeline = [
        {"$match": {**match, "event_type": "stream_start", "user_id": {"$ne": None}}},
        {"$group": {"_id": "$user_id"}},
        {"$count": "unique"},
    ]
    unique_result = await db["analytics_events"].aggregate(unique_pipeline).to_list(1)
    unique_listeners = unique_result[0]["unique"] if unique_result else 0

    # Average completion
    completion_pipeline = [
        {"$match": {**match, "event_type": "stream_complete", "completion_pct": {"$ne": None}}},
        {"$group": {"_id": None, "avg": {"$avg": "$completion_pct"}}},
    ]
    comp_result = await db["analytics_events"].aggregate(completion_pipeline).to_list(1)
    avg_completion = comp_result[0]["avg"] if comp_result else 0.0

    # Top countries
    geo_pipeline = [
        {"$match": {**match, "event_type": "stream_start", "country": {"$ne": None}}},
        {"$group": {"_id": "$country", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]
    geo_result = await db["analytics_events"].aggregate(geo_pipeline).to_list(10)
    top_countries = [GeoBreakdownItem(country=r["_id"], count=r["count"]) for r in geo_result]

    # Stream trend (daily)
    trend_pipeline = [
        {"$match": {**match, "event_type": "stream_start"}},
        {"$group": {"_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$occurred_at"}}, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    trend_result = await db["analytics_events"].aggregate(trend_pipeline).to_list(window_days)
    stream_trend = [StreamTrendPoint(date=r["_id"], count=r["count"]) for r in trend_result]

    # Like count from track doc
    track_doc = await db["tracks"].find_one({"_id": ObjectId(track_id)}, {"like_count": 1})
    like_count = track_doc.get("like_count", 0) if track_doc else 0

    metrics = TrackMetrics(
        track_id=track_id,
        total_streams=total_streams,
        unique_listeners=unique_listeners,
        avg_completion=round(avg_completion, 3),
        like_count=like_count,
        top_countries=top_countries,
        stream_trend=stream_trend,
    )
    await redis.setex(cache_key, _CACHE_TTL, metrics.model_dump_json())
    return metrics


async def get_artist_dashboard(
    db: AsyncIOMotorDatabase,
    redis: Redis,
    artist_id: str,
    actor: UserDocument,
    window_days: int = 30,
) -> ArtistDashboard:
    # Ownership check for artist role
    if actor.role == "artist":
        artist_doc = await db["artists"].find_one({"_id": ObjectId(artist_id)})
        if not artist_doc or str(artist_doc.get("user_id", "")) != str(actor.id):
            raise ForbiddenError("You can only view your own artist analytics")

    cache_key = f"analytics:artist:{artist_id}:{window_days}"
    cached = await redis.get(cache_key)
    if cached:
        return ArtistDashboard.model_validate_json(cached)

    since = utc_now() - timedelta(days=window_days)
    artist_oid = ObjectId(artist_id)

    # Monthly listeners (unique users)
    monthly_pipeline = [
        {"$match": {"artist_id": artist_oid, "event_type": "stream_start",
                    "occurred_at": {"$gte": since}, "user_id": {"$ne": None}}},
        {"$group": {"_id": "$user_id"}},
        {"$count": "count"},
    ]
    monthly_result = await db["analytics_events"].aggregate(monthly_pipeline).to_list(1)
    monthly_listeners = monthly_result[0]["count"] if monthly_result else 0

    # Total streams + likes
    total_streams = await db["analytics_events"].count_documents(
        {"artist_id": artist_oid, "event_type": "stream_start", "occurred_at": {"$gte": since}}
    )
    total_likes_result = await db["tracks"].aggregate([
        {"$match": {"artist_id": artist_oid}},
        {"$group": {"_id": None, "total": {"$sum": "$like_count"}}},
    ]).to_list(1)
    total_likes = total_likes_result[0]["total"] if total_likes_result else 0

    # Top tracks
    top_tracks_pipeline = [
        {"$match": {"artist_id": artist_oid}},
        {"$sort": {"stream_count": -1}},
        {"$limit": 10},
        {"$project": {"_id": 1, "title": 1, "stream_count": 1}},
    ]
    top_tracks_docs = await db["tracks"].aggregate(top_tracks_pipeline).to_list(10)
    top_tracks = [TopTrackItem(track_id=str(t["_id"]), title=t["title"], stream_count=t["stream_count"]) for t in top_tracks_docs]

    # Geography
    geo_pipeline = [
        {"$match": {"artist_id": artist_oid, "event_type": "stream_start",
                    "occurred_at": {"$gte": since}, "country": {"$ne": None}}},
        {"$group": {"_id": "$country", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 15},
    ]
    geo_result = await db["analytics_events"].aggregate(geo_pipeline).to_list(15)
    geography = [GeoBreakdownItem(country=r["_id"], count=r["count"]) for r in geo_result]

    dashboard = ArtistDashboard(
        artist_id=artist_id,
        monthly_listeners=monthly_listeners,
        total_streams=total_streams,
        total_likes=total_likes,
        top_tracks=top_tracks,
        listener_geography=geography,
    )
    await redis.setex(cache_key, _CACHE_TTL, dashboard.model_dump_json())
    return dashboard


async def get_admin_dashboard(
    db: AsyncIOMotorDatabase,
    redis: Redis,
) -> AdminDashboard:
    cache_key = "analytics:admin:dashboard"
    cached = await redis.get(cache_key)
    if cached:
        return AdminDashboard.model_validate_json(cached)

    now = utc_now()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = now - timedelta(days=7)
    month_start = now - timedelta(days=30)

    total_tracks = await db["tracks"].count_documents({"status": {"$ne": "deleted"}})
    total_artists = await db["artists"].count_documents({})
    needs_review_count = await db["tracks"].count_documents({"needs_human_review": True})

    # Unique users who have streamed at least once (any role)
    listeners_result = await db["analytics_events"].aggregate([
        {"$match": {"event_type": "stream_start", "user_id": {"$ne": None}}},
        {"$group": {"_id": "$user_id"}},
        {"$count": "count"},
    ]).to_list(1)
    total_listeners = listeners_result[0]["count"] if listeners_result else 0

    total_streams_today = await db["analytics_events"].count_documents(
        {"event_type": "stream_start", "occurred_at": {"$gte": today_start}}
    )
    total_streams_week = await db["analytics_events"].count_documents(
        {"event_type": "stream_start", "occurred_at": {"$gte": week_start}}
    )

    # Top 10 tracks by stream count
    top_tracks_docs = await db["tracks"].find(
        {"status": {"$ne": "deleted"}, "stream_count": {"$gt": 0}},
        {"_id": 1, "title": 1, "stream_count": 1, "like_count": 1},
    ).sort("stream_count", -1).limit(10).to_list(10)
    top_tracks = [
        TopTrackItem(
            track_id=str(t["_id"]),
            title=t.get("title") or "Untitled",
            stream_count=t.get("stream_count", 0),
            like_count=t.get("like_count", 0),
        )
        for t in top_tracks_docs
    ]

    # Top 10 tracks by like count
    top_liked_docs = await db["tracks"].find(
        {"status": {"$ne": "deleted"}, "like_count": {"$gt": 0}},
        {"_id": 1, "title": 1, "stream_count": 1, "like_count": 1},
    ).sort("like_count", -1).limit(10).to_list(10)
    top_liked = [
        TopTrackItem(
            track_id=str(t["_id"]),
            title=t.get("title") or "Untitled",
            stream_count=t.get("stream_count", 0),
            like_count=t.get("like_count", 0),
        )
        for t in top_liked_docs
    ]

    # Tracks by status
    status_pipeline = [
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    status_result = await db["tracks"].aggregate(status_pipeline).to_list(20)
    tracks_by_status = {r["_id"]: r["count"] for r in status_result if r["_id"]}

    # Ownership breakdown by workflow_tags
    _ownership_tags = ["tamasha_owned", "signed_artist", "orchard_source", "wav_source"]
    ownership_breakdown: dict[str, int] = {}
    for tag in _ownership_tags:
        ownership_breakdown[tag] = await db["tracks"].count_documents({"workflow_tags": tag})

    # Top genres
    genre_pipeline = [
        {"$match": {"genre": {"$nin": [None, ""]}}},
        {"$group": {"_id": "$genre", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 12},
    ]
    genre_result = await db["tracks"].aggregate(genre_pipeline).to_list(12)
    genres = [GenreItem(genre=r["_id"], count=r["count"]) for r in genre_result if r.get("_id")]

    # Stream trend — last 30 days
    trend_pipeline = [
        {"$match": {"event_type": "stream_start", "occurred_at": {"$gte": month_start}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$occurred_at"}},
            "count": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]
    trend_result = await db["analytics_events"].aggregate(trend_pipeline).to_list(30)
    stream_trend = [StreamTrendPoint(date=r["_id"], count=r["count"]) for r in trend_result]

    # Storage from track file sizes
    storage_pipeline = [{"$group": {"_id": None, "total_bytes": {"$sum": "$file_size_bytes"}}}]
    storage_result = await db["tracks"].aggregate(storage_pipeline).to_list(1)
    total_bytes = storage_result[0]["total_bytes"] if storage_result else 0
    storage_gb = round(total_bytes / (1024 ** 3), 2)

    # Bandwidth — bytes streamed per period
    hour_start = now - timedelta(hours=1)

    async def _sum_bytes(since) -> int:
        res = await db["analytics_events"].aggregate([
            {"$match": {"event_type": "stream_start", "occurred_at": {"$gte": since}, "bytes_streamed": {"$gt": 0}}},
            {"$group": {"_id": None, "total": {"$sum": "$bytes_streamed"}}},
        ]).to_list(1)
        return res[0]["total"] if res else 0

    bytes_today, bytes_week, bytes_30d = await asyncio.gather(
        _sum_bytes(today_start),
        _sum_bytes(week_start),
        _sum_bytes(month_start),
    )

    bandwidth_trend_pipeline = [
        {"$match": {"event_type": "stream_start", "occurred_at": {"$gte": month_start}, "bytes_streamed": {"$gt": 0}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$occurred_at"}},
            "bytes": {"$sum": "$bytes_streamed"},
        }},
        {"$sort": {"_id": 1}},
    ]
    bw_result = await db["analytics_events"].aggregate(bandwidth_trend_pipeline).to_list(30)
    bandwidth_trend = [BandwidthTrendPoint(date=r["_id"], bytes=r["bytes"]) for r in bw_result]

    active_jobs = await db["sync_jobs"].count_documents({"status": {"$in": ["queued", "running"]}})

    dashboard = AdminDashboard(
        total_tracks=total_tracks,
        total_artists=total_artists,
        total_listeners=total_listeners,
        total_streams_today=total_streams_today,
        total_streams_week=total_streams_week,
        needs_review_count=needs_review_count,
        top_tracks=top_tracks,
        top_liked=top_liked,
        tracks_by_status=tracks_by_status,
        ownership_breakdown=ownership_breakdown,
        genres=genres,
        stream_trend=stream_trend,
        storage_used_gb=storage_gb,
        active_jobs=active_jobs,
        bytes_streamed_today=bytes_today,
        bytes_streamed_week=bytes_week,
        bytes_streamed_30d=bytes_30d,
        bandwidth_trend=bandwidth_trend,
    )
    await redis.setex(cache_key, _ADMIN_CACHE_TTL, dashboard.model_dump_json())
    return dashboard
