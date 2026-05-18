from __future__ import annotations

from datetime import datetime, timezone

import structlog
from bson import ObjectId
from celery import Task

import redis as redis_lib

from worker.celery_app import app
from worker.config import get_settings
from worker.db.mongo import get_db
from worker.fingerprint.engine import fingerprint_file
from worker.fingerprint.store import FingerprintStore
from worker.storage.r2 import presigned_url

logger = structlog.get_logger(__name__)

_FP_CANCEL_KEY = "fingerprint:cancel"


def _is_cancelled() -> bool:
    try:
        s = get_settings()
        r = redis_lib.from_url(s.redis_url)
        return bool(r.exists(_FP_CANCEL_KEY))
    except Exception:
        return False


def _store(max_attempts: int = 30) -> FingerprintStore:
    """Open RocksDB with retry. Lock is held only briefly (one write), so
    contention resolves fast — use shorter sleeps and more attempts."""
    import random, time
    path = get_settings().fingerprint_db_path
    for i in range(max_attempts):
        try:
            return FingerprintStore(path)
        except Exception as exc:
            if "LOCK" in str(exc) or "temporarily unavailable" in str(exc).lower():
                time.sleep(0.2 + random.random() * 0.8)  # 0.2–1s, much shorter
                continue
            raise
    raise RuntimeError("Could not acquire RocksDB write lock after retries")


@app.task(bind=True, max_retries=3, default_retry_delay=60,
          queue="default", name="worker.tasks.fingerprint.fingerprint_track")
def fingerprint_track(self: Task, track_id: str) -> dict:
    if _is_cancelled():
        return {"status": "skipped", "reason": "cancelled"}

    db = get_db()
    doc = db["tracks"].find_one({"_id": ObjectId(track_id)})
    if not doc:
        return {"status": "skipped", "reason": "not_found"}

    # Fast pre-check via MongoDB before touching RocksDB at all
    if doc.get("fingerprinted"):
        return {"status": "skipped", "reason": "already_indexed"}

    r2_key = doc.get("r2_key_transcoded") or doc.get("r2_key_raw")
    if not r2_key:
        return {"status": "skipped", "reason": "no_r2_key"}

    # --- Heavy work: download + compute fingerprints (no lock held) ---
    try:
        url = presigned_url(r2_key, expiry=300)
        fps = fingerprint_file(url)
    except Exception as exc:
        logger.error("fingerprint.compute_error", track_id=track_id, error=str(exc))
        raise self.retry(exc=exc)

    if not fps:
        return {"status": "skipped", "reason": "no_fingerprints"}

    # --- Brief critical section: acquire lock only for the write ---
    tid_bytes = ObjectId(track_id).binary
    store = _store()
    try:
        if store.is_indexed(tid_bytes):
            return {"status": "skipped", "reason": "already_indexed"}
        store.put(tid_bytes, fps)
    finally:
        store.close()

    db["tracks"].update_one(
        {"_id": ObjectId(track_id)},
        {"$set": {
            "fingerprinted": True,
            "fingerprint_count": len(fps),
            "fingerprinted_at": datetime.now(timezone.utc),
        }},
    )
    logger.info("fingerprint.indexed", track_id=track_id, count=len(fps))
    return {"status": "ok", "fingerprints": len(fps)}


@app.task(name="worker.tasks.fingerprint.fingerprint_all")
def fingerprint_all() -> dict:
    """Dispatch fingerprint_track for every canonical / non-duplicate unindexed track."""
    db = get_db()

    # Use MongoDB's fingerprinted flag for the skip check — avoid holding
    # RocksDB open while iterating thousands of tracks.
    cursor = db["tracks"].find(
        {
            "$or": [
                {"is_canonical": True},
                {"duplicate_group_id": None},
                {"duplicate_group_id": {"$exists": False}},
            ],
            "status": {"$nin": ["archived", "deleted"]},
            "r2_key_raw": {"$exists": True, "$ne": ""},
            "fingerprinted": {"$ne": True},
        },
        {"_id": 1},
    )

    dispatched = 0
    for doc in cursor:
        fingerprint_track.delay(str(doc["_id"]))
        dispatched += 1

    logger.info("fingerprint.all_dispatched", dispatched=dispatched)
    return {"dispatched": dispatched}
