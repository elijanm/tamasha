from __future__ import annotations

from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.pagination import PageParams
from app.core.rbac import require_permission
from app.dependencies import get_db
from app.models.sync_job import SyncJobDocument
from app.models.user import UserDocument
from app.schemas.duplicate import (
    DuplicateGroupDetailResponse,
    DuplicateGroupListResponse,
    DuplicateGroupResponse,
    DuplicateMetrics,
    ResolveGroupRequest,
)
from app.schemas.sync_job import SyncJobResponse
from app.services import duplicate_service
from app.tasks.dedup import dispatch_dedup_scan_task

router = APIRouter(prefix="/duplicates", tags=["duplicates"])


@router.get("/metrics", response_model=DuplicateMetrics)
async def get_metrics(
    _actor: UserDocument = require_permission("track.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> DuplicateMetrics:
    return await duplicate_service.get_metrics(db)


@router.get("/", response_model=DuplicateGroupListResponse)
async def list_groups(
    status: str | None = Query(default=None),
    method: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    _actor: UserDocument = require_permission("track.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> DuplicateGroupListResponse:
    page = PageParams(skip=skip, limit=limit)
    items, total = await duplicate_service.list_groups(db, page, status, method)
    return DuplicateGroupListResponse(items=items, total=total, skip=skip, limit=limit)


@router.get("/{group_id}", response_model=DuplicateGroupDetailResponse)
async def get_group(
    group_id: str,
    _actor: UserDocument = require_permission("track.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> DuplicateGroupDetailResponse:
    return await duplicate_service.get_group_detail(db, group_id)


@router.post("/{group_id}/resolve", response_model=DuplicateGroupResponse)
async def resolve_group(
    group_id: str,
    body: ResolveGroupRequest,
    actor: UserDocument = require_permission("track.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> DuplicateGroupResponse:
    return await duplicate_service.resolve_group(db, group_id, body, str(actor.id))


@router.post("/scan", response_model=SyncJobResponse, status_code=202)
async def trigger_scan(
    actor: UserDocument = require_permission("track.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> SyncJobResponse:
    now = datetime.now(timezone.utc)
    result = await db["sync_jobs"].insert_one({
        "mode": "dedup_scan",
        "triggered_by": ObjectId(str(actor.id)),
        "status": "queued",
        "celery_task_id": None,
        "objects_scanned": 0,
        "objects_new": 0,
        "objects_updated": 0,
        "objects_orphaned": 0,
        "errors": [],
        "started_at": None,
        "completed_at": None,
        "created_at": now,
    })
    job_id = str(result.inserted_id)
    task_id = dispatch_dedup_scan_task(job_id=job_id)
    await db["sync_jobs"].update_one(
        {"_id": result.inserted_id},
        {"$set": {"celery_task_id": task_id}},
    )
    doc = await db["sync_jobs"].find_one({"_id": result.inserted_id})
    return SyncJobResponse.model_validate(SyncJobDocument.model_validate(doc).model_dump(by_alias=False))
