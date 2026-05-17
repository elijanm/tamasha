from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.exceptions import NotFoundError
from app.core.pagination import PageParams
from app.core.rbac import require_permission
from app.dependencies import get_current_active_user, get_db
from app.models.user import UserDocument
from app.schemas.audit_log import (
    ActionCount,
    AuditLogFilter,
    AuditLogListResponse,
    AuditLogResponse,
    TimelineBucket,
    WorkSummary,
    WorkTotals,
)
from app.utils.object_id import PyObjectId

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])

_admin = require_permission("*")


def _stringify_objectids(value: Any) -> Any:
    """Recursively convert bson.ObjectId values to strings so Pydantic can serialize them."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: _stringify_objectids(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_stringify_objectids(i) for i in value]
    return value


def _prepare_doc(doc: dict) -> dict:
    doc["_id"] = str(doc["_id"])
    if doc.get("before") is not None:
        doc["before"] = _stringify_objectids(doc["before"])
    if doc.get("after") is not None:
        doc["after"] = _stringify_objectids(doc["after"])
    return doc


@router.get("/", response_model=AuditLogListResponse)
async def list_audit_logs(
    actor_id: str | None = Query(default=None),
    action: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    _actor: UserDocument = _admin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> AuditLogListResponse:
    query: dict = {}
    if actor_id:
        query["actor_id"] = actor_id
    if action:
        query["action"] = {"$regex": action, "$options": "i"}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id

    total = await db["audit_logs"].count_documents(query)
    page = PageParams(skip=skip, limit=limit)
    cursor = db["audit_logs"].find(query).sort("occurred_at", -1).skip(page.skip).limit(page.limit)
    docs = await cursor.to_list(length=page.limit)

    items = []
    for doc in docs:
        items.append(AuditLogResponse.model_validate(_prepare_doc(doc)))

    return AuditLogListResponse(items=items, total=total, skip=skip, limit=limit)


@router.get("/my-work", response_model=WorkSummary)
async def my_work(
    from_date: str = Query(..., description="ISO date string, e.g. 2026-05-17"),
    to_date: str = Query(..., description="ISO date string, e.g. 2026-05-17"),
    actor: UserDocument = Depends(get_current_active_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> WorkSummary:
    """Return aggregated work stats for the authenticated user over the given date range."""
    from_dt = datetime.fromisoformat(from_date).replace(tzinfo=timezone.utc)
    to_dt = datetime.fromisoformat(to_date).replace(tzinfo=timezone.utc)
    actor_id = str(actor.id)

    match = {"actor_id": actor_id, "occurred_at": {"$gte": from_dt, "$lte": to_dt}}

    # Action counts
    action_pipeline = [
        {"$match": match},
        {"$group": {"_id": "$action", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]
    action_results = await db["audit_logs"].aggregate(action_pipeline).to_list(length=100)
    action_counts = [ActionCount(action=r["_id"], count=r["count"]) for r in action_results]
    cm = {r["_id"]: r["count"] for r in action_results}

    # Timeline — hourly for ≤2 days, daily otherwise
    delta_seconds = (to_dt - from_dt).total_seconds()
    use_hourly = delta_seconds <= 2 * 86400

    if use_hourly:
        group_id = {
            "y": {"$year": "$occurred_at"},
            "m": {"$month": "$occurred_at"},
            "d": {"$dayOfMonth": "$occurred_at"},
            "h": {"$hour": "$occurred_at"},
        }
    else:
        group_id = {
            "y": {"$year": "$occurred_at"},
            "m": {"$month": "$occurred_at"},
            "d": {"$dayOfMonth": "$occurred_at"},
        }

    timeline_pipeline = [
        {"$match": match},
        {"$group": {"_id": group_id, "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    timeline_results = await db["audit_logs"].aggregate(timeline_pipeline).to_list(length=500)

    timeline: list[TimelineBucket] = []
    for r in timeline_results:
        d = r["_id"]
        if use_hourly:
            bucket = f"{d['y']:04d}-{d['m']:02d}-{d['d']:02d}T{d['h']:02d}:00:00"
        else:
            bucket = f"{d['y']:04d}-{d['m']:02d}-{d['d']:02d}"
        timeline.append(TimelineBucket(bucket=bucket, count=r["count"]))

    totals = WorkTotals(
        total_actions=sum(c.count for c in action_counts),
        tracks_created=cm.get("track.create", 0),
        tracks_updated=cm.get("track.update", 0),
        tracks_deleted=cm.get("track.delete", 0),
        tracks_assigned_artist=cm.get("track.assign_artist", 0),
        tracks_artwork_updated=cm.get("track.update_artwork", 0),
        uploads_completed=cm.get("upload.complete", 0),
        artists_created=cm.get("artist.create", 0),
        artists_updated=cm.get("artist.update", 0),
        duplicates_resolved=cm.get("duplicate.resolve", 0),
    )

    # Linear projection when the period is today
    projected_today: int | None = None
    now_utc = datetime.now(timezone.utc)
    today_start = now_utc.replace(hour=0, minute=0, second=0, microsecond=0)
    is_today = abs((from_dt - today_start).total_seconds()) < 60 and delta_seconds < 86460
    if is_today:
        elapsed = (now_utc - today_start).total_seconds()
        if elapsed > 3600 and totals.total_actions > 0:
            projected_today = int(totals.total_actions * 86400 / elapsed)

    return WorkSummary(
        from_date=from_dt,
        to_date=to_dt,
        totals=totals,
        action_counts=action_counts,
        timeline=timeline,
        projected_today=projected_today,
    )


@router.get("/{log_id}", response_model=AuditLogResponse)
async def get_audit_log(
    log_id: str,
    _actor: UserDocument = _admin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> AuditLogResponse:
    from bson import ObjectId
    try:
        doc = await db["audit_logs"].find_one({"_id": ObjectId(log_id)})
    except Exception:
        doc = None
    if not doc:
        raise NotFoundError(f"Audit log {log_id} not found")
    return AuditLogResponse.model_validate(_prepare_doc(doc))
