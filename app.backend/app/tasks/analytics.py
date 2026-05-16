from __future__ import annotations

from app.core.celery_app import celery_app


def dispatch_analytics_aggregate_task(entity_type: str, entity_id: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.analytics.aggregate_metrics",
        kwargs={"entity_type": entity_type, "entity_id": entity_id},
        queue="default",
    )
    return result.id
