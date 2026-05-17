from __future__ import annotations

import hashlib
import io
import zipfile
from pathlib import Path

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Request, Response, UploadFile, File
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from datetime import datetime
from pydantic import BaseModel, Field

from app.core.pagination import PageParams
from app.core.rbac import require_permission
from app.dependencies import get_db, get_redis
from app.models.user import UserDocument
from app.utils.datetime_utils import utc_now
from app.utils.r2 import get_r2_client, generate_presigned_url
from app.config import get_settings
from redis.asyncio import Redis
from app.schemas.track import (
    TrackArtistAssignRequest,
    TrackCreateRequest,
    TrackDetailResponse,
    TrackListResponse,
    TrackResponse,
    TrackUpdateRequest,
)
from app.services import track_service

router = APIRouter(prefix="/tracks", tags=["tracks"])

_IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_IMAGE_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_AUDIO_EXTENSIONS = {".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".aiff"}
_AUDIO_MAX_BYTES = 500 * 1024 * 1024  # 500 MB
_ZIP_MAX_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB


def _safe_filename(name: str) -> str:
    return "_".join(Path(name).name.strip().split())


def _extract_audio_meta(data: bytes, filename: str) -> dict:
    """Returns {duration_seconds, title, artist, album, track_number} via mutagen."""
    result: dict = {"duration_seconds": None, "title": None, "artist": None, "album": None, "track_number": None}
    try:
        from mutagen import File as MutagenFile  # type: ignore
        audio = MutagenFile(io.BytesIO(data), easy=True)
        if audio is None:
            return result
        if hasattr(audio, "info") and audio.info:
            result["duration_seconds"] = round(float(audio.info.length), 3)
        for key, dest in (("title", "title"), ("artist", "artist"), ("album", "album")):
            val = audio.get(key)
            if val:
                result[dest] = val[0]
        tn = audio.get("tracknumber")
        if tn:
            try:
                result["track_number"] = int(str(tn[0]).split("/")[0])
            except (ValueError, IndexError):
                pass
    except Exception:
        pass
    if not result["title"]:
        result["title"] = Path(filename).stem.replace("_", " ").replace("-", " ").strip()
    return result


def _ctx(request: Request) -> dict:
    return {
        "actor_ip": getattr(request.state, "actor_ip", ""),
        "actor_ua": getattr(request.state, "actor_ua", ""),
        "request_id": getattr(request.state, "request_id", ""),
    }


def _to_response(track) -> TrackResponse:
    data = track.model_dump(by_alias=False)
    r2_key = data.get("artwork_r2_key")
    if r2_key:
        try:
            data["artwork_url"] = generate_presigned_url(r2_key, expires=3600)
        except Exception:
            data["artwork_url"] = None
    return TrackResponse.model_validate(data)


@router.get("/", response_model=TrackListResponse)
async def list_tracks(
    artist_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    genre: str | None = Query(default=None),
    no_artist: bool = Query(default=False),
    workflow_tag: str | None = Query(default=None),
    needs_review: bool = Query(default=False),
    search: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    sort_by: str = Query(default="created_at"),
    _actor: UserDocument = require_permission("track.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> TrackListResponse:
    page = PageParams(skip=skip, limit=limit)
    # Admin/staff can see deleted tracks; listeners and artists never see them
    exclude_deleted = _actor.role not in ("admin", "superadmin", "staff")
    tracks, total = await track_service.list_tracks(
        db, page, artist_id, status, genre, no_artist, workflow_tag, needs_review, search,
        exclude_deleted=exclude_deleted, sort_by=sort_by,
    )
    return TrackListResponse(items=[_to_response(t) for t in tracks], total=total, skip=skip, limit=limit)


# ── Static sub-paths must come BEFORE /{track_id} to avoid param capture ──────

@router.get("/skiza-clips")
async def list_all_skiza_clips(
    status: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    _actor: UserDocument = require_permission("skiza.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    from bson import ObjectId
    query: dict = {}
    if status:
        query["status"] = status
    total = await db["skiza_clips"].count_documents(query)
    clips = await db["skiza_clips"].find(query).sort("created_at", -1).skip(skip).limit(limit).to_list(limit)
    for c in clips:
        c["_id"] = str(c["_id"])
        c["track_id"] = str(c["track_id"])
    return {"items": clips, "total": total, "skip": skip, "limit": limit}


@router.patch("/skiza-clips/{clip_id}")
async def update_skiza_clip(
    clip_id: str,
    status: str = Body(..., embed=True),
    actor: UserDocument = require_permission("skiza.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    from bson import ObjectId
    _VALID = {"draft", "pending_review", "approved", "rejected", "exporting", "exported", "submitted", "accepted", "failed"}
    if status not in _VALID:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail=f"Invalid status: {status}")
    await db["skiza_clips"].update_one(
        {"_id": ObjectId(clip_id)},
        {"$set": {"status": status, "updated_at": utc_now()}},
    )
    doc = await db["skiza_clips"].find_one({"_id": ObjectId(clip_id)})
    if doc:
        doc["_id"] = str(doc["_id"])
        doc["track_id"] = str(doc["track_id"])
    return doc or {}


def _extract_artwork(data: bytes) -> bytes | None:
    """Return raw artwork bytes embedded in audio tags, or None."""
    try:
        from mutagen.id3 import ID3, APIC  # type: ignore
        tags = ID3(io.BytesIO(data))
        for tag in tags.values():
            if isinstance(tag, APIC):
                return tag.data
    except Exception:
        pass
    try:
        from mutagen.flac import FLAC  # type: ignore
        f = FLAC(io.BytesIO(data))
        if f.pictures:
            return f.pictures[0].data
    except Exception:
        pass
    try:
        from mutagen.mp4 import MP4  # type: ignore
        mp4 = MP4(io.BytesIO(data))
        covr = mp4.tags.get("covr") if mp4.tags else None
        if covr:
            return bytes(covr[0])
    except Exception:
        pass
    return None


def _upload_to_r2(key: str, body: bytes, content_type: str = "application/octet-stream") -> None:
    s = get_settings()
    get_r2_client().put_object(Bucket=s.r2_bucket, Key=key, Body=body, ContentType=content_type)


@router.post("/upload-file")
async def upload_track_file(
    file: UploadFile = File(...),
    actor: UserDocument = require_permission("track.write"),
) -> dict:
    """Upload a single audio file to R2 and return auto-detected metadata."""
    if file.size and file.size > _AUDIO_MAX_BYTES:
        raise HTTPException(status_code=422, detail="File exceeds 500 MB limit")

    data = await file.read()
    if len(data) > _AUDIO_MAX_BYTES:
        raise HTTPException(status_code=422, detail="File exceeds 500 MB limit")

    filename = _safe_filename(file.filename or "track")
    ext = Path(filename).suffix.lower()
    if ext not in _AUDIO_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"Unsupported audio format: {ext}")

    sha256 = hashlib.sha256(data).hexdigest()
    md5    = hashlib.md5(data).hexdigest()
    r2_key = f"music/raw/{sha256[:8]}_{filename}"

    _upload_to_r2(r2_key, data, file.content_type or "application/octet-stream")

    meta = _extract_audio_meta(data, filename)

    # Extract and upload embedded artwork
    artwork_r2_key: str | None = None
    artwork_url: str | None = None
    art_bytes = _extract_artwork(data)
    if art_bytes:
        artwork_r2_key = f"music/artwork/{sha256[:8]}.jpg"
        _upload_to_r2(artwork_r2_key, art_bytes, "image/jpeg")
        try:
            artwork_url = generate_presigned_url(artwork_r2_key, expires=3600)
        except Exception:
            pass

    return {
        "r2_key_raw": r2_key,
        "file_size_bytes": len(data),
        "sha256": sha256,
        "md5": md5,
        "duration_seconds": meta["duration_seconds"],
        "title": meta["title"],
        "artist": meta["artist"],
        "album": meta["album"],
        "track_number": meta["track_number"],
        "original_filename": filename,
        "artwork_r2_key": artwork_r2_key,
        "artwork_url": artwork_url,
    }


@router.post("/upload-album")
async def upload_album_zip(
    file: UploadFile = File(...),
    actor: UserDocument = require_permission("track.write"),
) -> dict:
    """Upload a ZIP archive. Each audio file inside is uploaded to R2 and its metadata returned."""
    data = await file.read()
    if len(data) > _ZIP_MAX_BYTES:
        raise HTTPException(status_code=422, detail="ZIP exceeds 2 GB limit")
    if not zipfile.is_zipfile(io.BytesIO(data)):
        raise HTTPException(status_code=422, detail="File must be a ZIP archive")

    tracks = []
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        audio_entries = sorted(
            [n for n in zf.namelist() if Path(n).suffix.lower() in _AUDIO_EXTENSIONS and not n.startswith("__MACOSX")],
        )
        if not audio_entries:
            raise HTTPException(status_code=422, detail="ZIP contains no supported audio files")

        for name in audio_entries:
            track_data = zf.read(name)
            sha256 = hashlib.sha256(track_data).hexdigest()
            md5    = hashlib.md5(track_data).hexdigest()
            filename = _safe_filename(Path(name).name)
            r2_key = f"music/raw/{sha256[:8]}_{filename}"

            _upload_to_r2(r2_key, track_data)

            meta = _extract_audio_meta(track_data, filename)

            artwork_r2_key: str | None = None
            artwork_url: str | None = None
            art_bytes = _extract_artwork(track_data)
            if art_bytes:
                artwork_r2_key = f"music/artwork/{sha256[:8]}.jpg"
                _upload_to_r2(artwork_r2_key, art_bytes, "image/jpeg")
                try:
                    artwork_url = generate_presigned_url(artwork_r2_key, expires=3600)
                except Exception:
                    pass

            tracks.append({
                "r2_key_raw": r2_key,
                "file_size_bytes": len(track_data),
                "sha256": sha256,
                "md5": md5,
                "duration_seconds": meta["duration_seconds"],
                "title": meta["title"],
                "artist": meta["artist"],
                "album": meta["album"],
                "track_number": meta["track_number"],
                "original_filename": filename,
                "artwork_r2_key": artwork_r2_key,
                "artwork_url": artwork_url,
            })

    return {"tracks": tracks, "count": len(tracks)}


@router.post("/", response_model=TrackResponse, status_code=201)
async def create_track(
    body: TrackCreateRequest,
    request: Request,
    actor: UserDocument = require_permission("track.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> TrackResponse:
    track = await track_service.create_track(db, body, actor, **_ctx(request))
    return _to_response(track)


@router.get("/{track_id}", response_model=TrackResponse)
async def get_track(
    track_id: str,
    _actor: UserDocument = require_permission("track.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> TrackResponse:
    return _to_response(await track_service.get_track(db, track_id))


@router.patch("/{track_id}", response_model=TrackResponse)
async def update_track(
    track_id: str,
    body: TrackUpdateRequest,
    request: Request,
    actor: UserDocument = require_permission("track.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> TrackResponse:
    track = await track_service.update_track(db, track_id, body, actor, **_ctx(request))
    return _to_response(track)


@router.delete("/{track_id}", status_code=204)
async def delete_track(
    track_id: str,
    request: Request,
    actor: UserDocument = require_permission("*"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    await track_service.soft_delete_track(db, track_id, actor, **_ctx(request))


@router.get("/{track_id}/metadata-history")
async def get_metadata_history(
    track_id: str,
    _actor: UserDocument = require_permission("track.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> list:
    history = await track_service.get_track_metadata_history(db, track_id)
    return history


@router.post("/{track_id}/artwork", response_model=TrackResponse)
async def upload_artwork(
    track_id: str,
    request: Request,
    file: UploadFile = File(...),
    actor: UserDocument = require_permission("track.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> TrackResponse:
    if file.content_type not in _IMAGE_CONTENT_TYPES:
        raise HTTPException(status_code=422, detail=f"Unsupported image type: {file.content_type}. Use JPEG, PNG, WebP or GIF.")
    data = await file.read()
    if len(data) > _IMAGE_MAX_BYTES:
        raise HTTPException(status_code=422, detail="Image exceeds 10 MB limit.")
    ext = file.filename.rsplit(".", 1)[-1].lower() if file.filename and "." in file.filename else "jpg"
    r2_key = f"music/artwork/{track_id}.{ext}"
    s = get_settings()
    get_r2_client().put_object(
        Bucket=s.r2_bucket,
        Key=r2_key,
        Body=data,
        ContentType=file.content_type or "image/jpeg",
    )
    track = await track_service.update_artwork(db, track_id, r2_key, actor, **_ctx(request))
    return _to_response(track)


@router.patch("/{track_id}/assign-artist", response_model=TrackResponse)
async def assign_artist(
    track_id: str,
    body: TrackArtistAssignRequest,
    request: Request,
    actor: UserDocument = require_permission("track.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> TrackResponse:
    track = await track_service.assign_artist(db, track_id, str(body.artist_id), actor, **_ctx(request))
    return _to_response(track)


@router.get("/{track_id}/stream-url")
async def get_stream_url(
    track_id: str,
    bitrate: str | None = Query(default=None),
    _actor: UserDocument = require_permission("track.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    from bson import ObjectId
    from app.utils.r2 import generate_presigned_url
    try:
        doc = await db["tracks"].find_one({"_id": ObjectId(track_id)})
    except Exception:
        doc = None
    if not doc:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Track not found")

    transcoded: dict[str, str] = doc.get("r2_keys_transcoded") or {}
    raw_key: str = doc.get("r2_key_raw", "")

    if bitrate and bitrate in transcoded:
        key = transcoded[bitrate]
        chosen_bitrate = bitrate
    elif transcoded:
        # prefer highest numeric bitrate available
        chosen_bitrate = max(
            (k for k in transcoded if k.isdigit()),
            key=int,
            default=next(iter(transcoded)),
        )
        key = transcoded[chosen_bitrate]
    else:
        key = raw_key
        chosen_bitrate = "raw"

    url = generate_presigned_url(key, expires=3600)
    return {
        "url": url,
        "bitrate": chosen_bitrate,
        "available_bitrates": sorted(
            (k for k in transcoded if k.isdigit()), key=int
        ) or (["raw"] if raw_key else []),
        "r2_key": key,
        "expires_in": 3600,
    }


@router.get("/{track_id}/audio")
async def stream_audio(
    track_id: str,
    bitrate: str | None = Query(default=None),
    token: str | None = Query(default=None),
    range: str | None = Header(default=None, alias="range"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> StreamingResponse:
    """Proxy audio from R2 through the backend — supports Range for seeking.

    Auth: Bearer header (normal) OR ?token= query param (for <audio> elements).
    """
    import re
    from bson import ObjectId
    from fastapi import HTTPException
    from app.core.security import decode_token
    from app.core.exceptions import UnauthorizedError
    from app.utils.r2 import get_r2_client

    # ── Auth via query-param token (audio element can't set headers) ──────────
    if token:
        try:
            payload = decode_token(token)
            if payload.get("type") != "access":
                raise HTTPException(status_code=401, detail="Invalid token")
            user_id = payload.get("sub")
            if not user_id:
                raise HTTPException(status_code=401, detail="Invalid token")
            user = await db["users"].find_one({"_id": ObjectId(user_id)})
            if not user:
                raise HTTPException(status_code=401, detail="User not found")
        except UnauthorizedError as exc:
            raise HTTPException(status_code=401, detail=str(exc))
    else:
        raise HTTPException(status_code=401, detail="Authentication required")

    # ── Resolve R2 key ─────────────────────────────────────────────────────────
    try:
        doc = await db["tracks"].find_one({"_id": ObjectId(track_id)})
    except Exception:
        doc = None
    if not doc:
        raise HTTPException(status_code=404, detail="Track not found")

    transcoded: dict[str, str] = doc.get("r2_keys_transcoded") or {}
    raw_key: str = doc.get("r2_key_raw", "")

    if bitrate and bitrate in transcoded:
        key = transcoded[bitrate]
    elif transcoded:
        best = max((k for k in transcoded if k.isdigit()), key=int, default=next(iter(transcoded)))
        key = transcoded[best]
    else:
        key = raw_key

    if not key:
        raise HTTPException(status_code=404, detail="No audio file for track")

    from app.config import get_settings
    settings = get_settings()
    client = get_r2_client()

    # ── Determine content type ─────────────────────────────────────────────────
    ext = key.rsplit(".", 1)[-1].lower()
    mime = {
        "mp3": "audio/mpeg", "wav": "audio/wav", "flac": "audio/flac",
        "aac": "audio/aac", "ogg": "audio/ogg", "m4a": "audio/mp4",
    }.get(ext, "audio/mpeg")

    # ── Head request to get file size ──────────────────────────────────────────
    import asyncio
    loop = asyncio.get_event_loop()

    def _head():
        return client.head_object(Bucket=settings.r2_bucket, Key=key)

    head = await loop.run_in_executor(None, _head)
    file_size = head["ContentLength"]

    # ── Parse Range header ─────────────────────────────────────────────────────
    start = 0
    end = file_size - 1
    status_code = 200

    if range:
        m = re.match(r"bytes=(\d+)-(\d*)", range)
        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else file_size - 1
            end = min(end, file_size - 1)
            status_code = 206

    chunk_size = end - start + 1

    def _get():
        return client.get_object(
            Bucket=settings.r2_bucket, Key=key,
            Range=f"bytes={start}-{end}",
        )

    obj = await loop.run_in_executor(None, _get)
    body = obj["Body"]

    def _iter_content():
        while True:
            chunk = body.read(64 * 1024)
            if not chunk:
                break
            yield chunk

    headers = {
        "Content-Type": mime,
        "Content-Length": str(chunk_size),
        "Accept-Ranges": "accepts",
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Cache-Control": "no-cache",
    }
    return StreamingResponse(_iter_content(), status_code=status_code, headers=headers)


@router.post("/{track_id}/stream", status_code=204)
async def log_stream(
    track_id: str,
    request: Request,
    actor: UserDocument = require_permission("track.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> None:
    from bson import ObjectId
    oid = ObjectId(track_id)
    now = utc_now()
    dedup_key = f"analytics:dedup:{actor.id}:stream_start:{track_id}"
    if not await redis.exists(dedup_key):
        await redis.setex(dedup_key, 30, "1")
        track_doc = await db["tracks"].find_one({"_id": oid}, {"file_size_bytes": 1, "artist_id": 1})
        file_size = (track_doc or {}).get("file_size_bytes") or 0
        raw_artist_id = (track_doc or {}).get("artist_id")
        artist_oid = ObjectId(str(raw_artist_id)) if raw_artist_id else None
        await db["tracks"].update_one({"_id": oid}, {"$inc": {"stream_count": 1}})
        await db["analytics_events"].insert_one({
            "event_type": "stream_start",
            "track_id": oid,
            "artist_id": artist_oid,
            "user_id": ObjectId(str(actor.id)) if actor.id else None,
            "session_id": getattr(request.state, "request_id", str(actor.id)),
            "ip_address": getattr(request.state, "actor_ip", ""),
            "country": None,
            "device_type": None,
            "browser": None,
            "occurred_at": now,
            "bytes_streamed": file_size,
        })
        # Invalidate caches so stats update immediately
        await redis.delete("analytics:admin:dashboard")
        if artist_oid:
            await redis.delete(f"analytics:artist:{str(artist_oid)}:30")


class StreamCompleteRequest(BaseModel):
    played_seconds: int = Field(ge=0)
    started_at: datetime | None = None


@router.post("/{track_id}/stream-complete", status_code=204)
async def log_stream_complete(
    track_id: str,
    body: StreamCompleteRequest,
    request: Request,
    actor: UserDocument = require_permission("track.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    from bson import ObjectId
    oid = ObjectId(track_id)
    now = utc_now()
    track_doc = await db["tracks"].find_one({"_id": oid}, {"duration_seconds": 1})
    duration = (track_doc or {}).get("duration_seconds") or 0
    completion_pct = round(min(1.0, body.played_seconds / duration), 4) if duration > 0 else None
    await db["analytics_events"].insert_one({
        "event_type": "stream_complete",
        "track_id": oid,
        "user_id": ObjectId(str(actor.id)) if actor.id else None,
        "session_id": getattr(request.state, "request_id", str(actor.id)),
        "ip_address": getattr(request.state, "actor_ip", ""),
        "country": None,
        "device_type": None,
        "browser": None,
        "played_seconds": body.played_seconds,
        "completion_pct": completion_pct,
        "occurred_at": body.started_at or now,
    })


@router.post("/{track_id}/like", status_code=204)
async def toggle_like(
    track_id: str,
    actor: UserDocument = require_permission("track.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> None:
    from bson import ObjectId
    oid = ObjectId(track_id)
    user_oid = ObjectId(str(actor.id))
    liked_key = f"user:likes:{actor.id}:{track_id}"
    is_liked = await redis.exists(liked_key)
    if is_liked:
        # Unlike
        await redis.delete(liked_key)
        await db["tracks"].update_one({"_id": oid}, {"$inc": {"like_count": -1}})
        await db["users"].update_one({"_id": user_oid}, {"$pull": {"liked_track_ids": oid}})
    else:
        # Like
        await redis.set(liked_key, "1")
        await db["tracks"].update_one({"_id": oid}, {"$inc": {"like_count": 1}})
        await db["users"].update_one({"_id": user_oid}, {"$addToSet": {"liked_track_ids": oid}})


@router.get("/{track_id}/like-status")
async def get_like_status(
    track_id: str,
    actor: UserDocument = require_permission("track.read"),
    redis: Redis = Depends(get_redis),
) -> dict:
    liked_key = f"user:likes:{actor.id}:{track_id}"
    return {"liked": bool(await redis.exists(liked_key))}


class SkizaClipCreateRequest(BaseModel):
    title: str = ""
    start_seconds: float
    end_seconds: float
    notes: str = ""


@router.get("/{track_id}/skiza-clips")
async def list_track_skiza_clips(
    track_id: str,
    _actor: UserDocument = require_permission("skiza.read"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> list:
    from bson import ObjectId
    clips = await db["skiza_clips"].find({"track_id": ObjectId(track_id)}).sort("created_at", -1).to_list(100)
    for c in clips:
        c["_id"] = str(c["_id"])
        c["track_id"] = str(c["track_id"])
    return clips


@router.post("/{track_id}/skiza-clips", status_code=201)
async def create_skiza_clip(
    track_id: str,
    body: SkizaClipCreateRequest,
    actor: UserDocument = require_permission("skiza.write"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    from bson import ObjectId
    now = utc_now()
    doc = {
        "track_id": ObjectId(track_id),
        "title": body.title,
        "start_seconds": body.start_seconds,
        "end_seconds": body.end_seconds,
        "notes": body.notes,
        "status": "draft",
        "created_by": ObjectId(str(actor.id)) if actor.id else None,
        "created_at": now,
        "updated_at": now,
    }
    result = await db["skiza_clips"].insert_one(doc)
    doc["_id"] = str(result.inserted_id)
    doc["track_id"] = track_id
    return doc


