from __future__ import annotations

import tempfile
import os
from datetime import datetime, timezone

import structlog
from bson import ObjectId
from celery import Task

from worker.celery_app import app
from worker.db.mongo import get_db
from worker.storage.r2 import download_to_file, object_exists
from worker.utils.hashing import sha256_file, md5_file

logger = structlog.get_logger(__name__)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _fingerprint(path: str) -> str | None:
    """Return chromaprint acoustic fingerprint, or None if acoustid not available."""
    try:
        import acoustid
        duration, fp = acoustid.fingerprint_file(path)
        return fp
    except Exception:
        return None


def _find_or_create_duplicate_group(db, track_ids: list, method: str, confidence: float) -> str:
    """Find an existing group containing any of *track_ids* or create a new one."""
    existing = db["duplicate_groups"].find_one(
        {"track_ids": {"$in": [ObjectId(tid) for tid in track_ids]}}
    )
    if existing:
        # Merge any new IDs into the existing group
        all_ids = list({str(oid) for oid in existing["track_ids"]} | set(track_ids))
        db["duplicate_groups"].update_one(
            {"_id": existing["_id"]},
            {"$set": {
                "track_ids": [ObjectId(tid) for tid in all_ids],
                "updated_at": _utc_now(),
            }},
        )
        return str(existing["_id"])

    result = db["duplicate_groups"].insert_one({
        "detection_method": method,
        "confidence": confidence,
        "track_ids": [ObjectId(tid) for tid in track_ids],
        "canonical_track_id": None,
        "status": "pending_review",
        "reviewed_by": None,
        "reviewed_at": None,
        "notes": None,
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
    })
    return str(result.inserted_id)


@app.task(
    name="worker.tasks.dedup.check_duplicate",
    bind=True,
    max_retries=3,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def check_duplicate(self: Task, track_id: str, sha256: str, md5: str) -> dict:
    """Check if *track_id* is an exact or near-duplicate of any existing track."""
    log = logger.bind(task_id=self.request.id, track_id=track_id)
    log.info("dedup_start")

    db = get_db()
    track_doc = db["tracks"].find_one({"_id": ObjectId(track_id)})
    if not track_doc:
        log.warning("track_not_found")
        return {"track_id": track_id, "status": "skipped"}

    # ── If sha256 is missing, compute it ─────────────────────────────────────
    computed_sha256 = sha256
    computed_md5 = md5
    if not computed_sha256:
        r2_key = track_doc.get("r2_key_raw", "")
        if r2_key and object_exists(r2_key):
            with tempfile.TemporaryDirectory(prefix="tamasha_dedup_") as tmp:
                ext = os.path.splitext(r2_key)[1] or ".audio"
                local = os.path.join(tmp, f"raw{ext}")
                download_to_file(r2_key, local)
                computed_sha256 = sha256_file(local)
                computed_md5 = md5_file(local)

    # Update track with computed hashes
    if computed_sha256:
        db["tracks"].update_one(
            {"_id": ObjectId(track_id)},
            {"$set": {"sha256": computed_sha256, "md5": computed_md5, "updated_at": _utc_now()}},
        )

    result = {"track_id": track_id, "duplicate_found": False, "group_id": None}

    # ── Exact duplicate: same SHA256 ─────────────────────────────────────────
    if computed_sha256:
        exact_matches = list(db["tracks"].find(
            {"sha256": computed_sha256, "_id": {"$ne": ObjectId(track_id)}},
            {"_id": 1},
        ))
        if exact_matches:
            match_ids = [str(m["_id"]) for m in exact_matches]
            group_id = _find_or_create_duplicate_group(
                db, [track_id] + match_ids, method="sha256", confidence=1.0
            )
            db["tracks"].update_one(
                {"_id": ObjectId(track_id)},
                {"$set": {"duplicate_group_id": ObjectId(group_id), "updated_at": _utc_now()}},
            )
            result["duplicate_found"] = True
            result["duplicate_type"] = "exact"
            result["group_id"] = group_id
            log.info("exact_duplicate_found", matches=len(exact_matches), group_id=group_id)
            return result

    # ── Near-duplicate: acoustic fingerprint (optional, requires fpcalc) ─────
    r2_key = track_doc.get("r2_key_raw", "")
    if r2_key and object_exists(r2_key):
        with tempfile.TemporaryDirectory(prefix="tamasha_fp_") as tmp:
            ext = os.path.splitext(r2_key)[1] or ".audio"
            local = os.path.join(tmp, f"raw{ext}")
            try:
                download_to_file(r2_key, local)
                fp = _fingerprint(local)
                if fp:
                    # Store fingerprint for later comparison
                    db["tracks"].update_one(
                        {"_id": ObjectId(track_id)},
                        {"$set": {"fingerprint": fp, "updated_at": _utc_now()}},
                    )
                    # Check for existing tracks with same fingerprint
                    fp_match = db["tracks"].find_one(
                        {"fingerprint": fp, "_id": {"$ne": ObjectId(track_id)}}
                    )
                    if fp_match:
                        group_id = _find_or_create_duplicate_group(
                            db, [track_id, str(fp_match["_id"])],
                            method="fingerprint", confidence=0.95,
                        )
                        db["tracks"].update_one(
                            {"_id": ObjectId(track_id)},
                            {"$set": {"duplicate_group_id": ObjectId(group_id), "updated_at": _utc_now()}},
                        )
                        result["duplicate_found"] = True
                        result["duplicate_type"] = "fingerprint"
                        result["group_id"] = group_id
                        log.info("near_duplicate_found", group_id=group_id)
            except Exception as exc:
                log.warning("fingerprint_check_failed", error=str(exc))

    log.info("dedup_complete", duplicate_found=result["duplicate_found"])
    return result


@app.task(
    name="worker.tasks.dedup.full_dedup_scan",
    bind=True,
    max_retries=1,
    ignore_result=False,
)
def full_dedup_scan(self: Task) -> dict:
    """Full scan: group all tracks by SHA256 and create duplicate groups."""
    log = logger.bind(task_id=self.request.id)
    log.info("full_dedup_scan_start")

    db = get_db()
    pipeline = [
        {"$match": {"sha256": {"$ne": "", "$exists": True}}},
        {"$group": {"_id": "$sha256", "track_ids": {"$push": "$_id"}, "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": 1}}},
    ]
    groups_created = 0
    for group in db["tracks"].aggregate(pipeline):
        track_ids = [str(tid) for tid in group["track_ids"]]
        _find_or_create_duplicate_group(db, track_ids, method="sha256", confidence=1.0)
        groups_created += 1

    log.info("full_dedup_scan_complete", groups_created=groups_created)
    return {"groups_created": groups_created}
