from __future__ import annotations

from app.core.celery_app import celery_app


def dispatch_backup_sync_task(destination: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.backup.sync_to_destination",
        kwargs={"destination": destination},
        queue="backup",
    )
    return result.id
