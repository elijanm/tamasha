from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.pagination import PageParams
from app.core.rbac import require_permission
from app.dependencies import get_current_active_user, get_db
from app.models.user import UserDocument
from app.utils.r2 import get_r2_client, generate_presigned_url
from app.config import get_settings

_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_IMAGE_MAX_BYTES = 10 * 1024 * 1024
from app.schemas.artist import (
    ArtistCreateRequest,
    ArtistDetailResponse,
    ArtistListResponse,
    ArtistResponse,
    ArtistUpdateRequest,
    OwnershipRequestReview,
    OwnershipRequestResponse,
)
from app.services import artist_service

router = APIRouter(prefix="/artists", tags=["artists"])


def _ctx(request: Request) -> dict:
    return {
        "actor_ip": getattr(request.state, "actor_ip", ""),
        "actor_ua": getattr(request.state, "actor_ua", ""),
        "request_id": getattr(request.state, "request_id", ""),
    }


@router.get("/", response_model=ArtistListResponse)
async def list_artists(
    status: str | None = Query(default=None),
    genre: str | None = Query(default=None),
    search: str | None = Query(default=None),
    is_band: bool | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    _actor: UserDocument = require_permission("artist.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ArtistListResponse:
    page = PageParams(skip=skip, limit=limit)
    artists, total = await artist_service.list_artists(db, page, status, genre, search, is_band)
    items = [ArtistResponse.model_validate(a.model_dump(by_alias=False)) for a in artists]
    return ArtistListResponse(items=items, total=total, skip=skip, limit=limit)


@router.post("/", response_model=ArtistResponse, status_code=201)
async def create_artist(
    body: ArtistCreateRequest,
    request: Request,
    actor: UserDocument = require_permission("artist.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ArtistResponse:
    artist = await artist_service.create_artist(db, body, actor, **_ctx(request))
    return ArtistResponse.model_validate(artist.model_dump(by_alias=False))


@router.get("/{artist_id}", response_model=ArtistResponse)
async def get_artist(
    artist_id: str,
    _actor: UserDocument = require_permission("artist.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ArtistResponse:
    artist = await artist_service.get_artist(db, artist_id)
    return ArtistResponse.model_validate(artist.model_dump(by_alias=False))


@router.patch("/{artist_id}", response_model=ArtistResponse)
async def update_artist(
    artist_id: str,
    body: ArtistUpdateRequest,
    request: Request,
    actor: UserDocument = require_permission("artist.read"),  # service enforces ownership
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ArtistResponse:
    artist = await artist_service.update_artist(db, artist_id, body, actor, **_ctx(request))
    return ArtistResponse.model_validate(artist.model_dump(by_alias=False))


@router.delete("/{artist_id}", status_code=204)
async def delete_artist(
    artist_id: str,
    request: Request,
    actor: UserDocument = require_permission("artist.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    await artist_service.delete_artist(db, artist_id, actor, **_ctx(request))


@router.get("/{artist_id}/tracks")
async def get_artist_tracks(
    artist_id: str,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    _actor: UserDocument = require_permission("track.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    from app.core.pagination import PageParams
    from app.services import track_service
    page = PageParams(skip=skip, limit=limit)
    tracks, total = await track_service.list_tracks(db, page, artist_id=artist_id)
    from app.schemas.track import TrackResponse
    items = [TrackResponse.model_validate(t.model_dump(by_alias=False)) for t in tracks]
    return {"items": [i.model_dump() for i in items], "total": total, "skip": skip, "limit": limit}


@router.post("/{artist_id}/approve", response_model=ArtistResponse)
async def approve_artist(
    artist_id: str,
    request: Request,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ArtistResponse:
    artist = await artist_service.approve_artist(db, artist_id, actor, **_ctx(request))
    return ArtistResponse.model_validate(artist.model_dump(by_alias=False))


@router.post("/{artist_id}/reject", response_model=ArtistResponse)
async def reject_artist(
    artist_id: str,
    request: Request,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ArtistResponse:
    artist = await artist_service.reject_artist(db, artist_id, actor, **_ctx(request))
    return ArtistResponse.model_validate(artist.model_dump(by_alias=False))


@router.post("/{artist_id}/ownership-request", response_model=ArtistResponse)
async def request_ownership(
    artist_id: str,
    request: Request,
    actor: UserDocument = require_permission("artist.update_own"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ArtistResponse:
    artist = await artist_service.request_ownership(db, artist_id, actor, **_ctx(request))
    return ArtistResponse.model_validate(artist.model_dump(by_alias=False))


@router.get("/{artist_id}/ownership-requests")
async def list_ownership_requests(
    artist_id: str,
    _actor: UserDocument = require_permission("artist.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> list:
    artist = await artist_service.get_artist(db, artist_id)
    return [r.model_dump() for r in artist.ownership_requests]


@router.post("/{artist_id}/avatar", response_model=ArtistResponse)
async def upload_avatar(
    artist_id: str,
    request: Request,
    file: UploadFile = File(...),
    actor: UserDocument = require_permission("artist.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ArtistResponse:
    if file.content_type not in _IMAGE_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Unsupported image type: {file.content_type}. Use JPEG, PNG, WebP or GIF.")
    data = await file.read()
    if len(data) > _IMAGE_MAX_BYTES:
        raise HTTPException(status_code=422, detail="Image exceeds 10 MB limit.")
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    r2_key = f"music/artist-images/{artist_id}.{ext}"
    s = get_settings()
    get_r2_client().put_object(
        Bucket=s.r2_bucket,
        Key=r2_key,
        Body=data,
        ContentType=file.content_type or "image/jpeg",
    )
    image_url = generate_presigned_url(r2_key, expires=86400)
    body = ArtistUpdateRequest(image_url=image_url)
    artist = await artist_service.update_artist(db, artist_id, body, actor, **_ctx(request))
    return ArtistResponse.model_validate(artist.model_dump(by_alias=False))


@router.patch("/ownership-requests/{artist_id}/{req_id}", response_model=ArtistResponse)
async def review_ownership_request(
    artist_id: str,
    req_id: str,
    body: OwnershipRequestReview,
    request: Request,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> ArtistResponse:
    artist = await artist_service.review_ownership_request(db, artist_id, req_id, body, actor, **_ctx(request))
    return ArtistResponse.model_validate(artist.model_dump(by_alias=False))
