from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import get_settings
from app.core.rbac import require_permission
from app.dependencies import get_db
from app.models.user import UserDocument
from app.services import r2_pool_service
from app.services.storage_service import StorageService

router = APIRouter(prefix="/r2/pool", tags=["r2-pool"])

_staff_or_admin = require_permission("track.write")


def _get_storage() -> StorageService:
    return StorageService(get_settings())


def _ctx(request: Request) -> dict:
    return {
        "actor_ip": getattr(request.state, "actor_ip", ""),
        "actor_ua": getattr(request.state, "actor_ua", ""),
        "request_id": getattr(request.state, "request_id", ""),
    }


@router.get("/stats")
async def pool_stats(
    _actor: UserDocument = _staff_or_admin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    """Summary metrics: how many files are in R2, how many are indexed, how many need work."""
    storage = _get_storage()
    return await r2_pool_service.get_pool_stats(db, storage)


@router.get("/objects")
async def list_pool_objects(
    prefix: str = Query(default="music/raw/", description="R2 key prefix to scan"),
    continuation_token: str | None = Query(default=None),
    page_size: int = Query(default=50, ge=1, le=200),
    audio_only: bool = Query(default=True),
    _actor: UserDocument = _staff_or_admin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    """Paginated list of R2 objects with their MongoDB index status.

    Each object shows: filename, size, upload date, whether it's indexed,
    track_id if indexed, processing status, title, and artist name.
    """
    storage = _get_storage()
    return await r2_pool_service.list_pool_objects(
        storage, db, prefix=prefix,
        continuation_token=continuation_token,
        page_size=page_size,
        audio_only=audio_only,
    )


@router.get("/unindexed")
async def list_unindexed(
    prefix: str = Query(default="music/raw/"),
    continuation_token: str | None = Query(default=None),
    page_size: int = Query(default=50, ge=1, le=200),
    _actor: UserDocument = _staff_or_admin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    """R2 objects that exist in R2 but have no MongoDB track record — the backlog."""
    storage = _get_storage()
    return await r2_pool_service.list_unindexed(
        storage, db, prefix=prefix,
        continuation_token=continuation_token,
        page_size=page_size,
    )


@router.post("/ingest")
async def ingest_from_pool(
    request: Request,
    prefix: str = Query(default="music/raw/"),
    limit: int = Query(default=200, ge=1, le=1000, description="Max track stubs to create per call"),
    actor: UserDocument = _staff_or_admin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    """Scan R2 for unindexed audio files and create pending track stubs in MongoDB.

    Each stub immediately dispatches transcoding and dedup tasks to workers.
    Staff can then edit metadata on the pending tracks.
    """
    storage = _get_storage()
    return await r2_pool_service.ingest_unindexed(
        storage, db, actor,
        prefix=prefix,
        limit=limit,
        **_ctx(request),
    )
