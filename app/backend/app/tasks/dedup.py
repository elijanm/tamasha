from __future__ import annotations

from app.core.celery_app import celery_app


def dispatch_dedup_task(track_id: str, sha256: str, md5: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.dedup.check_duplicate",
        kwargs={"track_id": track_id, "sha256": sha256, "md5": md5},
        queue="default",
    )
    return result.id


def dispatch_dedup_scan_task(job_id: str | None = None) -> str:
    result = celery_app.send_task(
        "worker.tasks.dedup.full_dedup_scan",
        kwargs={"job_id": job_id},
        queue="default",
    )
    return result.id
