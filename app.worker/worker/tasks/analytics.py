from __future__ import annotations

from datetime import datetime, timezone, timedelta

import structlog
from bson import ObjectId
from celery import Task

from worker.celery_app import app
from worker.db.mongo import get_db

logger = structlog.get_logger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _start_of_day(dt: datetime) -> datetime:
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


def _start_of_month(dt: datetime) -> datetime:
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


# ── Track-level metrics ────────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.analytics.aggregate_metrics",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def aggregate_track_metrics(self: Task, track_id: str) -> dict:
    """Roll up raw analytics events into the tracks document for a single track."""
    log = logger.bind(task_id=self.request.id, track_id=track_id)
    log.info("aggregate_track_start")

    db = get_db()
    oid = ObjectId(track_id)

    pipeline = [
        {"$match": {"track_id": oid}},
        {"$group": {
            "_id": None,
            "stream_count": {"$sum": {"$cond": [{"$eq": ["$event_type", "stream"]}, 1, 0]}},
            "like_count": {"$sum": {"$cond": [{"$eq": ["$event_type", "like"]}, 1, 0]}},
            "favorite_count": {"$sum": {"$cond": [{"$eq": ["$event_type", "favorite"]}, 1, 0]}},
            "skip_count": {"$sum": {"$cond": [{"$eq": ["$event_type", "skip"]}, 1, 0]}},
            "replay_count": {"$sum": {"$cond": [{"$eq": ["$event_type", "replay"]}, 1, 0]}},
            "total_duration_streamed": {"$sum": "$duration_streamed"},
            "completion_sum": {"$sum": "$completion_rate"},
            "completion_count": {"$sum": {"$cond": [{"$ifNull": ["$completion_rate", False]}, 1, 0]}},
        }},
    ]
    rows = list(db["analytics"].aggregate(pipeline))

    if not rows:
        log.info("no_analytics_events")
        return {"track_id": track_id, "updated": False}

    row = rows[0]
    avg_completion = (
        row["completion_sum"] / row["completion_count"]
        if row["completion_count"] > 0 else 0.0
    )

    db["tracks"].update_one(
        {"_id": oid},
        {"$set": {
            "stream_count": row["stream_count"],
            "like_count": row["like_count"],
            "favorite_count": row["favorite_count"],
            "skip_count": row["skip_count"],
            "replay_count": row["replay_count"],
            "avg_completion_rate": round(avg_completion, 4),
            "total_duration_streamed": row["total_duration_streamed"],
            "analytics_updated_at": _utc_now(),
        }},
    )
    log.info("aggregate_track_complete", stream_count=row["stream_count"])
    return {"track_id": track_id, "updated": True, "stream_count": row["stream_count"]}


# ── Artist-level metrics ───────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.analytics.aggregate_artist_metrics",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def aggregate_artist_metrics(self: Task, artist_id: str) -> dict:
    """Roll up monthly listeners, top tracks, and geography for an artist."""
    log = logger.bind(task_id=self.request.id, artist_id=artist_id)
    log.info("aggregate_artist_start")

    db = get_db()
    oid = ObjectId(artist_id)
    now = _utc_now()
    month_start = _start_of_month(now)

    # Tracks belonging to this artist
    track_ids = [
        t["_id"] for t in db["tracks"].find({"artist_id": oid}, {"_id": 1})
    ]
    if not track_ids:
        log.info("no_tracks_for_artist")
        return {"artist_id": artist_id, "updated": False}

    # Monthly unique listeners (distinct user_id or session_id per month)
    monthly_listeners_pipeline = [
        {"$match": {
            "track_id": {"$in": track_ids},
            "event_type": "stream",
            "created_at": {"$gte": month_start},
        }},
        {"$group": {"_id": {"$ifNull": ["$user_id", "$session_id"]}}},
        {"$count": "total"},
    ]
    ml_result = list(db["analytics"].aggregate(monthly_listeners_pipeline))
    monthly_listeners = ml_result[0]["total"] if ml_result else 0

    # Top 10 tracks by stream count
    top_tracks_pipeline = [
        {"$match": {"track_id": {"$in": track_ids}, "event_type": "stream"}},
        {"$group": {"_id": "$track_id", "streams": {"$sum": 1}}},
        {"$sort": {"streams": -1}},
        {"$limit": 10},
    ]
    top_tracks = [
        {"track_id": str(r["_id"]), "streams": r["streams"]}
        for r in db["analytics"].aggregate(top_tracks_pipeline)
    ]

    # Listener geography (top 10 countries)
    geo_pipeline = [
        {"$match": {
            "track_id": {"$in": track_ids},
            "event_type": "stream",
            "country": {"$ne": None},
        }},
        {"$group": {"_id": "$country", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 10},
    ]
    geography = [
        {"country": r["_id"], "count": r["count"]}
        for r in db["analytics"].aggregate(geo_pipeline)
    ]

    db["artists"].update_one(
        {"_id": oid},
        {"$set": {
            "monthly_listeners": monthly_listeners,
            "top_tracks": top_tracks,
            "listener_geography": geography,
            "analytics_updated_at": _utc_now(),
        }},
    )
    log.info("aggregate_artist_complete", monthly_listeners=monthly_listeners)
    return {
        "artist_id": artist_id,
        "updated": True,
        "monthly_listeners": monthly_listeners,
        "top_tracks_count": len(top_tracks),
    }


# ── Platform-wide daily rollup ─────────────────────────────────────────────────

@app.task(
    name="worker.tasks.analytics.daily_platform_rollup",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
)
def daily_platform_rollup(self: Task) -> dict:
    """Compute and store daily platform-wide metrics snapshot."""
    log = logger.bind(task_id=self.request.id)
    log.info("daily_rollup_start")

    db = get_db()
    now = _utc_now()
    day_start = _start_of_day(now - timedelta(days=1))
    day_end = _start_of_day(now)

    streams_yesterday = db["analytics"].count_documents({
        "event_type": "stream",
        "created_at": {"$gte": day_start, "$lt": day_end},
    })
    unique_listeners = len(db["analytics"].distinct(
        "session_id",
        {"event_type": "stream", "created_at": {"$gte": day_start, "$lt": day_end}},
    ))
    new_tracks = db["tracks"].count_documents({
        "created_at": {"$gte": day_start, "$lt": day_end},
    })
    total_tracks = db["tracks"].count_documents({"status": "ready"})
    total_artists = db["artists"].count_documents({})
    total_users = db["users"].count_documents({})

    snapshot = {
        "date": day_start,
        "streams": streams_yesterday,
        "unique_listeners": unique_listeners,
        "new_tracks": new_tracks,
        "total_tracks": total_tracks,
        "total_artists": total_artists,
        "total_users": total_users,
        "created_at": now,
    }
    db["platform_metrics"].insert_one(snapshot)

    log.info("daily_rollup_complete", streams=streams_yesterday, unique_listeners=unique_listeners)
    return {
        "date": day_start.isoformat(),
        "streams": streams_yesterday,
        "unique_listeners": unique_listeners,
    }


# ── Batch artist rollup ────────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.analytics.rollup_all_artists",
    bind=True,
    max_retries=1,
    soft_time_limit=3600,
)
def rollup_all_artists(self: Task) -> dict:
    """Dispatch aggregate_artist_metrics for every artist. Called by beat schedule."""
    log = logger.bind(task_id=self.request.id)
    db = get_db()

    dispatched = 0
    for artist in db["artists"].find({}, {"_id": 1}):
        aggregate_artist_metrics.apply_async(
            kwargs={"artist_id": str(artist["_id"])},
            queue="analytics",
        )
        dispatched += 1

    log.info("rollup_all_artists_dispatched", count=dispatched)
    return {"dispatched": dispatched}
