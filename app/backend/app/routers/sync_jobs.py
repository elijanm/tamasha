from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.pagination import PageParams
from app.core.rbac import require_permission
from app.dependencies import get_db
from app.models.user import UserDocument
from app.schemas.sync_job import SyncJobListResponse, SyncJobResponse, SyncJobTriggerRequest
from app.services import sync_service

router = APIRouter(prefix="/sync-jobs", tags=["sync-jobs"])


def _ctx(request: Request) -> dict:
    return {
        "actor_ip": getattr(request.state, "actor_ip", ""),
        "actor_ua": getattr(request.state, "actor_ua", ""),
        "request_id": getattr(request.state, "request_id", ""),
    }


def _to_response(job) -> SyncJobResponse:
    return SyncJobResponse.model_validate(job.model_dump(by_alias=False))


@router.get("/", response_model=SyncJobListResponse)
async def list_sync_jobs(
    mode: str | None = Query(default=None),
    status: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    _actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> SyncJobListResponse:
    page = PageParams(skip=skip, limit=limit)
    jobs, total = await sync_service.list_sync_jobs(db, page, mode, status)
    return SyncJobListResponse(items=[_to_response(j) for j in jobs], total=total, skip=skip, limit=limit)


@router.post("/trigger", response_model=SyncJobResponse, status_code=201)
async def trigger_sync(
    body: SyncJobTriggerRequest,
    request: Request,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> SyncJobResponse:
    job = await sync_service.trigger_sync(db, body, actor, **_ctx(request))
    return _to_response(job)


@router.get("/{job_id}", response_model=SyncJobResponse)
async def get_sync_job(
    job_id: str,
    _actor: UserDocument = require_permission("sync_job.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> SyncJobResponse:
    return _to_response(await sync_service.get_sync_job(db, job_id))


@router.post("/{job_id}/cancel", response_model=SyncJobResponse)
async def cancel_sync_job(
    job_id: str,
    request: Request,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> SyncJobResponse:
    job = await sync_service.cancel_sync_job(db, job_id, actor, **_ctx(request))
    return _to_response(job)
