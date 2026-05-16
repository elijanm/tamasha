from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.pagination import PageParams
from app.core.rbac import require_permission
from app.dependencies import get_current_active_user, get_db
from app.models.user import UserDocument
from app.schemas.upload import (
    UploadCompleteRequest,
    UploadInitiateRequest,
    UploadInitiateResponse,
    UploadListResponse,
    UploadResponse,
)
from app.services import upload_service
from app.services.storage_service import StorageService
from app.config import get_settings

router = APIRouter(prefix="/uploads", tags=["uploads"])


def _ctx(request: Request) -> dict:
    return {
        "actor_ip": getattr(request.state, "actor_ip", ""),
        "actor_ua": getattr(request.state, "actor_ua", ""),
        "request_id": getattr(request.state, "request_id", ""),
    }


def _get_storage() -> StorageService:
    return StorageService(get_settings())


def _to_response(upload) -> UploadResponse:
    return UploadResponse.model_validate(upload.model_dump(by_alias=False))


@router.post("/initiate", response_model=UploadInitiateResponse, status_code=201)
async def initiate_upload(
    body: UploadInitiateRequest,
    request: Request,
    actor: UserDocument = require_permission("upload.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UploadInitiateResponse:
    storage = _get_storage()
    return await upload_service.initiate_upload(db, storage, body, actor, **_ctx(request))


@router.post("/complete", response_model=UploadResponse)
async def complete_upload(
    body: UploadCompleteRequest,
    request: Request,
    actor: UserDocument = require_permission("upload.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UploadResponse:
    upload = await upload_service.complete_upload(db, body, actor, **_ctx(request))
    return _to_response(upload)


@router.get("/", response_model=UploadListResponse)
async def list_uploads(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    actor: UserDocument = require_permission("upload.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UploadListResponse:
    page = PageParams(skip=skip, limit=limit)
    uploads, total = await upload_service.list_uploads(db, page, actor)
    return UploadListResponse(items=[_to_response(u) for u in uploads], total=total, skip=skip, limit=limit)


@router.get("/{upload_id}", response_model=UploadResponse)
async def get_upload(
    upload_id: str,
    actor: UserDocument = Depends(get_current_active_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UploadResponse:
    return _to_response(await upload_service.get_upload(db, upload_id, actor))


@router.get("/{upload_id}/manifest")
async def get_manifest(
    upload_id: str,
    actor: UserDocument = require_permission("upload.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> list:
    upload = await upload_service.get_upload(db, upload_id, actor)
    return [item.model_dump() for item in upload.manifest]


@router.post("/{upload_id}/retry", response_model=UploadResponse)
async def retry_upload(
    upload_id: str,
    request: Request,
    actor: UserDocument = require_permission("upload.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> UploadResponse:
    upload = await upload_service.retry_upload(db, upload_id, actor, **_ctx(request))
    return _to_response(upload)
