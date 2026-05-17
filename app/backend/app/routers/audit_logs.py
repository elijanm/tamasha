from __future__ import annotations

from typing import Any

from bson import ObjectId
from fastapi import APIRouter, Depends, Query
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.exceptions import NotFoundError
from app.core.pagination import PageParams
from app.core.rbac import require_permission
from app.dependencies import get_db
from app.models.user import UserDocument
from app.schemas.audit_log import AuditLogFilter, AuditLogListResponse, AuditLogResponse
from app.utils.object_id import PyObjectId

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])

_admin = require_permission("*")


def _stringify_objectids(value: Any) -> Any:
    """Recursively convert bson.ObjectId values to strings so Pydantic can serialize them."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: _stringify_objectids(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_stringify_objectids(i) for i in value]
    return value


def _prepare_doc(doc: dict) -> dict:
    doc["_id"] = str(doc["_id"])
    if doc.get("before") is not None:
        doc["before"] = _stringify_objectids(doc["before"])
    if doc.get("after") is not None:
        doc["after"] = _stringify_objectids(doc["after"])
    return doc


@router.get("/", response_model=AuditLogListResponse)
async def list_audit_logs(
    actor_id: str | None = Query(default=None),
    action: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    _actor: UserDocument = _admin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> AuditLogListResponse:
    query: dict = {}
    if actor_id:
        query["actor_id"] = actor_id
    if action:
        query["action"] = {"$regex": action, "$options": "i"}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id

    total = await db["audit_logs"].count_documents(query)
    page = PageParams(skip=skip, limit=limit)
    cursor = db["audit_logs"].find(query).sort("occurred_at", -1).skip(page.skip).limit(page.limit)
    docs = await cursor.to_list(length=page.limit)

    items = []
    for doc in docs:
        items.append(AuditLogResponse.model_validate(_prepare_doc(doc)))

    return AuditLogListResponse(items=items, total=total, skip=skip, limit=limit)


@router.get("/{log_id}", response_model=AuditLogResponse)
async def get_audit_log(
    log_id: str,
    _actor: UserDocument = _admin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> AuditLogResponse:
    from bson import ObjectId
    try:
        doc = await db["audit_logs"].find_one({"_id": ObjectId(log_id)})
    except Exception:
        doc = None
    if not doc:
        raise NotFoundError(f"Audit log {log_id} not found")
    return AuditLogResponse.model_validate(_prepare_doc(doc))
