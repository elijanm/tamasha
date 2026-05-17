from __future__ import annotations

from typing import Any

import structlog
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.utils.datetime_utils import utc_now

logger = structlog.get_logger(__name__)


def _clean(value: Any) -> Any:
    """Recursively convert ObjectId to str so audit snapshots are always JSON-safe."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: _clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_clean(i) for i in value]
    return value


async def write_audit_log(
    db: AsyncIOMotorDatabase,
    actor_id: str | None,
    actor_role: str,
    actor_ip: str,
    actor_ua: str,
    action: str,
    entity_type: str,
    entity_id: str,
    before: dict | None = None,
    after: dict | None = None,
    request_id: str = "",
) -> None:
    """Insert an audit log entry. Never raises — errors are logged and swallowed."""
    try:
        doc = {
            "actor_id": actor_id,
            "actor_role": actor_role,
            "actor_ip": actor_ip,
            "actor_ua": actor_ua,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "before": _clean(before),
            "after": _clean(after),
            "request_id": request_id,
            "occurred_at": utc_now(),
        }
        await db["audit_logs"].insert_one(doc)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "audit_log_write_failed",
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            error=str(exc),
        )
