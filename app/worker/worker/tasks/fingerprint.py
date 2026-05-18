from __future__ import annotations

import os
import tempfile

import structlog
from bson import ObjectId
from celery import Task

from worker.celery_app import app
from worker.config import get_settings
from worker.db.mongo import get_db
from worker.fingerprint.engine import fingerprint_file
from worker.fingerprint.store import FingerprintStore
from worker.storage.r2 import download_to_file

logger = structlog.get_logger(__name__)


def _store() -> FingerprintStore:
    return FingerprintStore(get_settings().fingerprint_db_path)


@app.task(bind=True, max_retries=3, default_retry_delay=60,
          queue="default", name="worker.tasks.fingerprint.fingerprint_track")
def fingerprint_track(self: Task, track_id: str) -> dict:
    db = get_db()
    doc = db["tracks"].find_one({"_id": ObjectId(track_id)})
    if not doc:
        return {"status": "skipped", "reason": "not_found"}

    r2_key = doc.get("r2_key_transcoded") or doc.get("r2_key_raw")
    if not r2_key:
        return {"status": "skipped", "reason": "no_r2_key"}

    store = _store()
    tid_bytes = ObjectId(track_id).binary

    if store.is_indexed(tid_bytes):
        store.close()
        return {"status": "skipped", "reason": "already_indexed"}

    tmp_path: str | None = None
    try:
        suffix = os.path.splitext(r2_key)[1] or ".bin"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            tmp_path = f.name

        download_to_file(r2_key, tmp_path)
        fps = fingerprint_file(tmp_path)

        if not fps:
            store.close()
            return {"status": "skipped", "reason": "no_fingerprints"}

        store.put(tid_bytes, fps)
        store.close()

        db["tracks"].update_one(
            {"_id": ObjectId(track_id)},
            {"$set": {"fingerprinted": True, "fingerprint_count": len(fps)}},
        )
        logger.info("fingerprint.indexed", track_id=track_id, count=len(fps))
        return {"status": "ok", "fingerprints": len(fps)}

    except Exception as exc:
        if store:
            try:
                store.close()
            except Exception:
                pass
        logger.error("fingerprint.error", track_id=track_id, error=str(exc))
        raise self.retry(exc=exc)
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@app.task(name="worker.tasks.fingerprint.fingerprint_all")
def fingerprint_all() -> dict:
    """Dispatch fingerprint_track for every canonical / non-duplicate unindexed track."""
    db = get_db()
    store = _store()

    cursor = db["tracks"].find(
        {
            "$and": [
                {"$or": [
                    {"is_canonical": True},
                    {"duplicate_group_id": {"$exists": False}},
                ]},
                {"$or": [
                    {"r2_key_transcoded": {"$exists": True, "$ne": ""}},
                    {"r2_key_raw": {"$exists": True, "$ne": ""}},
                ]},
            ],
            "status": {"$nin": ["archived", "deleted"]},
        },
        {"_id": 1},
    )

    dispatched = skipped = 0
    for doc in cursor:
        tid_bytes = doc["_id"].binary
        if store.is_indexed(tid_bytes):
            skipped += 1
            continue
        fingerprint_track.delay(str(doc["_id"]))
        dispatched += 1

    store.close()
    logger.info("fingerprint.all_dispatched", dispatched=dispatched, skipped=skipped)
    return {"dispatched": dispatched, "skipped": skipped}
