from __future__ import annotations

from app.core.celery_app import celery_app


def dispatch_fingerprint_all() -> str:
    result = celery_app.send_task(
        "worker.tasks.fingerprint.fingerprint_all",
        queue="default",
    )
    return result.id


def dispatch_fingerprint_track(track_id: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.fingerprint.fingerprint_track",
        kwargs={"track_id": track_id},
        queue="default",
    )
    return result.id
