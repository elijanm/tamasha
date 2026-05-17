from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import get_settings
from app.core.audit import write_audit_log
from app.core.exceptions import NotFoundError
from app.core.pagination import PageParams
from app.models.duplicate import DuplicateGroupDocument, QualityBreakdown
from app.schemas.duplicate import (
    DuplicateGroupDetailResponse,
    DuplicateGroupResponse,
    DuplicateMetrics,
    DuplicateTrackEntry,
    QualityBreakdownSchema,
    ResolveGroupRequest,
)
from app.models.track import TrackDocument
from app.schemas.track import TrackResponse
from app.utils.datetime_utils import utc_now
from app.utils.r2 import generate_presigned_url, get_r2_client


# ── Quality scorer ─────────────────────────────────────────────────────────────

_FORMAT_SCORES: dict[str, int] = {
    ".flac": 30, ".wav": 30, ".aiff": 28,
    ".m4a": 22, ".aac": 22,
    ".mp3": 0,   # filled in by bitrate branch below
    ".ogg": 16, ".opus": 18, ".wma": 10,
}


def score_track(doc: dict) -> tuple[int, QualityBreakdown]:
    ext = os.path.splitext(doc.get("r2_key_raw", ""))[1].lower()
    size = doc.get("file_size_bytes", 0) or 0
    duration = doc.get("duration_seconds") or 0

    # Format score
    fmt = _FORMAT_SCORES.get(ext, 5)
    if ext == ".mp3" and duration > 0:
        kbps = (size * 8) / duration / 1000
        fmt = 22 if kbps >= 300 else 18 if kbps >= 240 else 14 if kbps >= 180 else 8

    # Bitrate score (normalised against 320 kbps ceiling)
    bitrate_score = 0
    if duration > 0 and size > 0:
        kbps = (size * 8) / duration / 1000
        bitrate_score = min(25, int((min(kbps, 320) / 320) * 25))

    # Duration score — penalise copies shorter than the longest in the group
    # (we can't compute the group max here, so use raw duration as a proxy: > 60s = full marks)
    dur_score = min(20, int((min(duration, 300) / 300) * 20)) if duration > 0 else 0

    # Metadata completeness (15 pts: title 2, artist 3, album 2, year 1, genre 1, isrc 2, artwork 2, composer/producer 2)
    md = 0
    if doc.get("title"):         md += 2
    if doc.get("artist_id"):     md += 3
    if doc.get("album"):         md += 2
    if doc.get("year"):          md += 1
    if doc.get("genre"):         md += 1
    if doc.get("isrc"):          md += 2
    if doc.get("artwork_r2_key"): md += 2
    if doc.get("composer") or doc.get("producer"): md += 1
    md = min(15, md)

    # Size score (tiebreaker, 10 pts)
    mb = size / (1024 * 1024)
    size_score = min(10, int(mb / 10))

    total = fmt + bitrate_score + dur_score + md + size_score
    breakdown = QualityBreakdown(
        format_score=fmt,
        bitrate_score=bitrate_score,
        duration_score=dur_score,
        metadata_score=md,
        size_score=size_score,
        total=total,
    )
    return total, breakdown


# ── Helpers ────────────────────────────────────────────────────────────────────

def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def _get_group(db: AsyncIOMotorDatabase, group_id: str) -> dict:
    try:
        doc = await db["duplicate_groups"].find_one({"_id": ObjectId(group_id)})
    except Exception:
        doc = None
    if not doc:
        raise NotFoundError(f"Duplicate group {group_id} not found")
    return doc


def _group_to_response(doc: dict, representative_title: str | None = None) -> DuplicateGroupResponse:
    return DuplicateGroupResponse(
        id=str(doc["_id"]),
        detection_method=doc.get("detection_method", "sha256"),
        confidence=doc.get("confidence", 1.0),
        track_count=len(doc.get("track_ids", [])),
        canonical_track_id=str(doc["canonical_track_id"]) if doc.get("canonical_track_id") else None,
        representative_title=representative_title or doc.get("representative_title"),
        status=doc.get("status", "pending_review"),
        bytes_freed=doc.get("bytes_freed", 0),
        notes=doc.get("notes"),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


# ── Public API ─────────────────────────────────────────────────────────────────

async def get_metrics(db: AsyncIOMotorDatabase) -> DuplicateMetrics:
    pipeline = [
        {"$group": {
            "_id": None,
            "total":    {"$sum": 1},
            "pending":  {"$sum": {"$cond": [{"$eq": ["$status", "pending_review"]}, 1, 0]}},
            "resolved": {"$sum": {"$cond": [{"$eq": ["$status", "resolved"]}, 1, 0]}},
            "freed":    {"$sum": "$bytes_freed"},
        }},
    ]
    row = await db["duplicate_groups"].aggregate(pipeline).to_list(1)
    agg = row[0] if row else {}

    total    = agg.get("total", 0)
    pending  = agg.get("pending", 0)
    resolved = agg.get("resolved", 0)
    freed    = agg.get("freed", 0)

    # Potential reclaimable: sum file_size_bytes of non-canonical tracks in pending groups
    pending_groups = await db["duplicate_groups"].find(
        {"status": "pending_review"}, {"track_ids": 1}
    ).to_list(1000)
    all_track_ids = [tid for g in pending_groups for tid in g.get("track_ids", [])]
    reclaimable_bytes = 0
    reclaimable_files = 0
    if all_track_ids:
        cursor = db["tracks"].find(
            {"_id": {"$in": all_track_ids}, "is_canonical": {"$ne": True}},
            {"file_size_bytes": 1},
        )
        async for t in cursor:
            reclaimable_bytes += t.get("file_size_bytes", 0) or 0
            reclaimable_files += 1

    breakdown_pipeline = [
        {"$group": {"_id": "$detection_method", "count": {"$sum": 1}}}
    ]
    breakdown_rows = await db["duplicate_groups"].aggregate(breakdown_pipeline).to_list(20)
    breakdown = {r["_id"]: r["count"] for r in breakdown_rows}

    return DuplicateMetrics(
        total_groups=total,
        pending_groups=pending,
        resolved_groups=resolved,
        reclaimable_files=reclaimable_files,
        reclaimable_bytes=reclaimable_bytes,
        bytes_already_freed=freed,
        detection_breakdown=breakdown,
    )


async def list_groups(
    db: AsyncIOMotorDatabase,
    page: PageParams,
    status: str | None = None,
    method: str | None = None,
) -> tuple[list[DuplicateGroupResponse], int]:
    filt: dict = {}
    if status:
        filt["status"] = status
    if method:
        filt["detection_method"] = method

    total = await db["duplicate_groups"].count_documents(filt)

    pipeline = [
        {"$match": filt},
        {"$sort": {"created_at": -1}},
        {"$skip": page.skip},
        {"$limit": page.limit},
        # Join the first track in each group to get a representative title
        {"$lookup": {
            "from": "tracks",
            "let": {"ids": "$track_ids"},
            "pipeline": [
                {"$match": {"$expr": {"$in": ["$_id", "$$ids"]}}},
                {"$project": {"title": 1}},
                {"$limit": 1},
            ],
            "as": "_sample_track",
        }},
        {"$addFields": {
            "representative_title": {
                "$ifNull": [
                    {"$arrayElemAt": ["$_sample_track.title", 0]},
                    None,
                ]
            }
        }},
    ]
    docs = await db["duplicate_groups"].aggregate(pipeline).to_list(page.limit)
    return [_group_to_response(d, d.get("representative_title")) for d in docs], total


async def get_group_detail(db: AsyncIOMotorDatabase, group_id: str) -> DuplicateGroupDetailResponse:
    doc = await _get_group(db, group_id)
    base = _group_to_response(doc)

    track_ids = [ObjectId(str(tid)) for tid in doc.get("track_ids", [])]
    track_docs = await db["tracks"].find({"_id": {"$in": track_ids}}).to_list(50)

    # Build score lookup from stored scores
    stored: dict[str, dict] = {
        str(s["track_id"]): s for s in doc.get("track_scores", [])
    }

    s = get_settings()
    entries: list[DuplicateTrackEntry] = []

    for td in track_docs:
        tid_str = str(td["_id"])
        # Priority: 1) precomputed on track doc, 2) stored in duplicate group, 3) live compute
        if td.get("quality_score") is not None:
            qs = td["quality_score"]
            qb = QualityBreakdownSchema(**(td.get("quality_breakdown") or {}))
        elif tid_str in stored:
            sc = stored[tid_str]
            qb = QualityBreakdownSchema(**sc.get("quality_breakdown", {}))
            qs = sc.get("quality_score", 0)
        else:
            qs, bd = score_track(td)
            qb = QualityBreakdownSchema(**bd.model_dump())

        # Inject artist name
        if td.get("artist_id"):
            a = await db["artists"].find_one({"_id": td["artist_id"]}, {"display_name": 1})
            td["artist_name"] = a["display_name"] if a else None

        # Presigned stream URL
        stream_url: str | None = None
        if td.get("r2_key_raw"):
            try:
                stream_url = generate_presigned_url(td["r2_key_raw"], expires=3600)
            except Exception:
                pass

        # Convert raw MongoDB doc (_id) to TrackResponse (id) via TrackDocument
        track_data = TrackDocument.model_validate(td).model_dump(by_alias=False)
        if td.get("artwork_r2_key"):
            try:
                track_data["artwork_url"] = generate_presigned_url(td["artwork_r2_key"], expires=3600)
            except Exception:
                track_data["artwork_url"] = None
        if td.get("artist_name"):
            track_data["artist_name"] = td["artist_name"]
        track_resp = TrackResponse.model_validate(track_data)
        entries.append(DuplicateTrackEntry(
            track=track_resp,
            quality_score=qs,
            quality_breakdown=qb,
            stream_url=stream_url,
        ))

    # Sort by quality score desc
    entries.sort(key=lambda e: e.quality_score, reverse=True)

    return DuplicateGroupDetailResponse(
        **base.model_dump(),
        tracks=entries,
    )


async def resolve_group(
    db: AsyncIOMotorDatabase,
    group_id: str,
    body: ResolveGroupRequest,
    actor_id: str,
) -> DuplicateGroupResponse:
    doc = await _get_group(db, group_id)
    canonical_id = ObjectId(body.canonical_track_id)

    track_ids = [ObjectId(str(tid)) for tid in doc.get("track_ids", [])]
    if canonical_id not in track_ids:
        raise NotFoundError("canonical_track_id is not part of this group")

    s = get_settings()
    r2 = get_r2_client()
    loser_ids = [tid for tid in track_ids if tid != canonical_id]
    loop = asyncio.get_running_loop()

    bytes_freed = 0
    for loser_id in loser_ids:
        td = await db["tracks"].find_one({"_id": loser_id}, {"r2_key_raw": 1, "file_size_bytes": 1})
        if not td:
            continue
        file_size = td.get("file_size_bytes", 0) or 0
        raw_key = td.get("r2_key_raw", "")
        if raw_key:
            dest_key = raw_key.replace("music/raw/", "music/removed-duplicates/", 1)
            if not dest_key.startswith("music/removed-duplicates/"):
                dest_key = f"music/removed-duplicates/{raw_key.lstrip('/')}"

            def _r2_move(src=raw_key, dst=dest_key):
                r2.copy_object(
                    Bucket=s.r2_bucket,
                    CopySource={"Bucket": s.r2_bucket, "Key": src},
                    Key=dst,
                )
                r2.delete_object(Bucket=s.r2_bucket, Key=src)

            try:
                await loop.run_in_executor(None, _r2_move)
            except Exception:
                pass  # R2 archival is best-effort; dedup is logical, not physical

        # Count bytes freed regardless of R2 outcome — the canonical selection is the dedup action
        bytes_freed += file_size

        await db["tracks"].update_one(
            {"_id": loser_id},
            {"$set": {
                "status": "archived",
                "is_canonical": False,
                "duplicate_group_id": ObjectId(group_id),
                "updated_at": _utc_now(),
            }},
        )

    await db["tracks"].update_one(
        {"_id": canonical_id},
        {"$set": {"is_canonical": True, "duplicate_group_id": ObjectId(group_id), "updated_at": _utc_now()}},
    )

    await db["duplicate_groups"].update_one(
        {"_id": ObjectId(group_id)},
        {"$set": {
            "canonical_track_id": canonical_id,
            "status": "resolved",
            "reviewed_by": ObjectId(actor_id),
            "reviewed_at": _utc_now(),
            "bytes_freed": bytes_freed,
            "updated_at": _utc_now(),
        }},
    )

    updated = await _get_group(db, group_id)
    await write_audit_log(
        db,
        actor_id=actor_id,
        actor_role="",
        actor_ip="",
        actor_ua="",
        action="duplicate.resolve",
        entity_type="duplicate_group",
        entity_id=group_id,
        after={"canonical_track_id": str(canonical_id), "losers": [str(i) for i in loser_ids], "bytes_freed": bytes_freed},
    )
    return _group_to_response(updated)
