from __future__ import annotations

from typing import Any

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.audit import write_audit_log
from app.core.exceptions import ForbiddenError, NotFoundError
from app.core.pagination import PageParams
from app.models.track import TrackDocument
from app.models.user import UserDocument
from app.schemas.track import TrackCreateRequest, TrackUpdateRequest
from app.utils.datetime_utils import utc_now


def _doc_to_model(doc: dict) -> TrackDocument:
    return TrackDocument.model_validate(doc)


async def _get_track_doc(db: AsyncIOMotorDatabase, track_id: str) -> dict:
    try:
        doc = await db["tracks"].find_one({"_id": ObjectId(track_id)})
    except Exception:
        doc = None
    if not doc:
        raise NotFoundError(f"Track {track_id} not found")
    return doc


_METADATA_FIELDS = ("title", "artist_id", "album", "year", "genre", "language", "duration_seconds", "tags")


def _snapshot_metadata(doc: dict) -> dict[str, Any]:
    return {f: doc.get(f) for f in _METADATA_FIELDS}


async def create_track(
    db: AsyncIOMotorDatabase,
    body: TrackCreateRequest,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> TrackDocument:
    now = utc_now()
    doc = {
        "r2_key_raw": body.r2_key_raw,
        "r2_keys_transcoded": {},
        "artist_id": ObjectId(str(body.artist_id)) if body.artist_id else None,
        "album": body.album,
        "title": body.title,
        "year": body.year,
        "genre": body.genre,
        "language": body.language,
        "duration_seconds": body.duration_seconds,
        "file_size_bytes": body.file_size_bytes,
        "sha256": body.sha256,
        "md5": body.md5,
        "artwork_r2_key": None,
        "waveform_r2_key": None,
        "tags": body.tags,
        "status": "pending",
        "metadata_version": 1,
        "metadata_history": [],
        "duplicate_group_id": None,
        "is_canonical": False,
        "skiza_clip_ids": [],
        "stream_count": 0,
        "like_count": 0,
        "created_by": ObjectId(str(actor.id)),
        "created_at": now,
        "updated_at": now,
    }
    result = await db["tracks"].insert_one(doc)
    track_id = str(result.inserted_id)
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="track.create", entity_type="track", entity_id=track_id,
        after={"title": body.title, "r2_key_raw": body.r2_key_raw},
        request_id=request_id,
    )
    created = await db["tracks"].find_one({"_id": result.inserted_id})
    return _doc_to_model(created)


async def get_track(db: AsyncIOMotorDatabase, track_id: str) -> TrackDocument:
    return _doc_to_model(await _get_track_doc(db, track_id))


async def list_tracks(
    db: AsyncIOMotorDatabase,
    page: PageParams,
    artist_id: str | None = None,
    status: str | None = None,
    genre: str | None = None,
    no_artist: bool = False,
    workflow_tag: str | None = None,
    needs_review: bool = False,
    search: str | None = None,
) -> tuple[list[TrackDocument], int]:
    query: dict = {}
    if artist_id:
        try:
            query["artist_id"] = ObjectId(artist_id)
        except Exception:
            pass
    if no_artist:
        query["artist_id"] = None
    if status:
        query["status"] = status
    if genre:
        query["genre"] = genre
    if workflow_tag:
        query["workflow_tags"] = workflow_tag
    if needs_review:
        query["needs_human_review"] = True
    if search:
        query["$or"] = [
            {"title": {"$regex": search, "$options": "i"}},
            {"album": {"$regex": search, "$options": "i"}},
            {"genre": {"$regex": search, "$options": "i"}},
        ]
    total = await db["tracks"].count_documents(query)
    cursor = db["tracks"].find(query).sort("created_at", -1).skip(page.skip).limit(page.limit)
    docs = await cursor.to_list(length=page.limit)

    # Batch-resolve artist display names
    artist_ids = list({d["artist_id"] for d in docs if d.get("artist_id")})
    artist_map: dict[str, str] = {}
    if artist_ids:
        async for a in db["artists"].find({"_id": {"$in": artist_ids}}, {"_id": 1, "display_name": 1}):
            artist_map[str(a["_id"])] = a["display_name"]
    for d in docs:
        aid = d.get("artist_id")
        if aid:
            d["artist_name"] = artist_map.get(str(aid))

    return [_doc_to_model(d) for d in docs], total


async def update_track(
    db: AsyncIOMotorDatabase,
    track_id: str,
    body: TrackUpdateRequest,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> TrackDocument:
    doc = await _get_track_doc(db, track_id)

    updates: dict = {}
    if body.title is not None:
        updates["title"] = body.title
    if body.artist_id is not None:
        updates["artist_id"] = ObjectId(str(body.artist_id))
    if body.album is not None:
        updates["album"] = body.album
    if body.year is not None:
        updates["year"] = body.year
    if body.genre is not None:
        updates["genre"] = body.genre
    if body.language is not None:
        updates["language"] = body.language
    if body.duration_seconds is not None:
        updates["duration_seconds"] = body.duration_seconds
    if body.tags is not None:
        updates["tags"] = body.tags
    if body.status is not None:
        updates["status"] = body.status
    if body.workflow_tags is not None:
        updates["workflow_tags"] = body.workflow_tags
    if body.needs_human_review is not None:
        updates["needs_human_review"] = body.needs_human_review

    if not updates:
        return _doc_to_model(doc)

    # Snapshot current metadata before applying update
    now = utc_now()
    snapshot = {
        "version": doc.get("metadata_version", 1),
        "changed_by": ObjectId(str(actor.id)),
        "changed_at": now,
        "snapshot": _snapshot_metadata(doc),
    }
    updates["metadata_version"] = doc.get("metadata_version", 1) + 1
    updates["updated_at"] = now

    before = _snapshot_metadata(doc)
    await db["tracks"].update_one(
        {"_id": doc["_id"]},
        {"$set": updates, "$push": {"metadata_history": snapshot}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="track.update", entity_type="track", entity_id=track_id,
        before=before, after={k: v for k, v in updates.items() if k in _METADATA_FIELDS},
        request_id=request_id,
    )
    updated = await db["tracks"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)


async def soft_delete_track(
    db: AsyncIOMotorDatabase,
    track_id: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> None:
    doc = await _get_track_doc(db, track_id)
    now = utc_now()
    await db["tracks"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": "failed", "deleted": True, "deleted_at": now, "deleted_by": ObjectId(str(actor.id)), "updated_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="track.delete", entity_type="track", entity_id=track_id,
        request_id=request_id,
    )


async def assign_artist(
    db: AsyncIOMotorDatabase,
    track_id: str,
    artist_id: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> TrackDocument:
    doc = await _get_track_doc(db, track_id)
    now = utc_now()
    before_artist = doc.get("artist_id")
    await db["tracks"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"artist_id": ObjectId(artist_id), "updated_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="track.assign_artist", entity_type="track", entity_id=track_id,
        before={"artist_id": str(before_artist) if before_artist else None},
        after={"artist_id": artist_id},
        request_id=request_id,
    )
    updated = await db["tracks"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)


async def get_track_metadata_history(
    db: AsyncIOMotorDatabase, track_id: str
) -> list[dict]:
    doc = await _get_track_doc(db, track_id)
    return doc.get("metadata_history", [])


async def update_artwork(
    db: AsyncIOMotorDatabase,
    track_id: str,
    r2_key: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> TrackDocument:
    doc = await _get_track_doc(db, track_id)
    now = utc_now()
    await db["tracks"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"artwork_r2_key": r2_key, "updated_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="track.update_artwork", entity_type="track", entity_id=track_id,
        after={"artwork_r2_key": r2_key}, request_id=request_id,
    )
    updated = await db["tracks"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)
