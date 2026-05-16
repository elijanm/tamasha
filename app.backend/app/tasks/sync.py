from __future__ import annotations

from app.core.celery_app import celery_app


def dispatch_incremental_sync_task(job_id: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.sync.incremental_sync",
        kwargs={"job_id": job_id},
        queue="sync",
    )
    return result.id


def dispatch_full_scan_task(job_id: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.sync.full_scan",
        kwargs={"job_id": job_id},
        queue="sync",
    )
    return result.id


def dispatch_reconciliation_task(job_id: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.sync.metadata_reconciliation",
        kwargs={"job_id": job_id},
        queue="sync",
    )
    return result.id


def dispatch_integrity_scan_task(job_id: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.sync.integrity_scan",
        kwargs={"job_id": job_id},
        queue="sync",
    )
    return result.id


def dispatch_pool_all_task(job_id: str, prefix: str = "music/", dispatch: bool = False) -> str:
    result = celery_app.send_task(
        "worker.tasks.sync.pool_all",
        kwargs={"job_id": job_id, "prefix": prefix, "dispatch": dispatch},
        queue="sync",
    )
    return result.id


def dispatch_batch_enrich_task(
    job_id: str,
    batch_size: int = 100,
    only_missing_artist: bool = False,
) -> str:
    result = celery_app.send_task(
        "worker.tasks.metadata.batch_enrich_metadata",
        kwargs={"job_id": job_id, "batch_size": batch_size, "only_missing_artist": only_missing_artist},
        queue="default",
    )
    return result.id
