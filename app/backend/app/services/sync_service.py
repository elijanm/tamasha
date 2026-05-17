from __future__ import annotations

import structlog
from bson import ObjectId
from celery.result import AsyncResult
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.audit import write_audit_log
from app.core.celery_app import celery_app
from app.core.exceptions import NotFoundError
from app.core.pagination import PageParams
from app.models.sync_job import SyncJobDocument
from app.models.user import UserDocument
from app.schemas.sync_job import SyncJobTriggerRequest
from app.tasks.sync import (
    dispatch_batch_enrich_task,
    dispatch_full_scan_task,
    dispatch_incremental_sync_task,
    dispatch_integrity_scan_task,
    dispatch_pool_all_task,
    dispatch_reconciliation_task,
)
from app.utils.datetime_utils import utc_now

logger = structlog.get_logger(__name__)

_DISPATCH_MAP = {
    "incremental": dispatch_incremental_sync_task,
    "metadata_reconciliation": dispatch_reconciliation_task,
    "full_scan": dispatch_full_scan_task,
    "integrity_scan": dispatch_integrity_scan_task,
}


def _doc_to_model(doc: dict) -> SyncJobDocument:
    return SyncJobDocument.model_validate(doc)


async def _get_job_doc(db: AsyncIOMotorDatabase, job_id: str) -> dict:
    try:
        doc = await db["sync_jobs"].find_one({"_id": ObjectId(job_id)})
    except Exception:
        doc = None
    if not doc:
        raise NotFoundError(f"Sync job {job_id} not found")
    return doc


async def trigger_sync(
    db: AsyncIOMotorDatabase,
    request: SyncJobTriggerRequest,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> SyncJobDocument:
    now = utc_now()
    doc = {
        "mode": request.mode,
        "triggered_by": ObjectId(str(actor.id)),
        "status": "queued",
        "celery_task_id": None,
        "objects_scanned": 0,
        "objects_new": 0,
        "objects_updated": 0,
        "objects_orphaned": 0,
        "errors": [],
        "started_at": None,
        "completed_at": None,
        "created_at": now,
    }
    result = await db["sync_jobs"].insert_one(doc)
    job_id = str(result.inserted_id)

    task_id = None
    try:
        if request.mode == "pool_all":
            task_id = dispatch_pool_all_task(
                job_id,
                prefix=request.prefix,
                dispatch=request.dispatch,
            )
        elif request.mode == "batch_enrich_metadata":
            task_id = dispatch_batch_enrich_task(
                job_id,
                batch_size=request.batch_size,
                only_missing_artist=request.only_missing_artist,
            )
        else:
            dispatcher = _DISPATCH_MAP.get(request.mode)
            if dispatcher:
                task_id = dispatcher(job_id)
    except Exception as exc:
        logger.warning("sync_dispatch_failed", mode=request.mode, job_id=job_id, error=str(exc))

    await db["sync_jobs"].update_one(
        {"_id": result.inserted_id},
        {"$set": {"celery_task_id": task_id}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="sync_job.trigger", entity_type="sync_job", entity_id=job_id,
        after={"mode": request.mode}, request_id=request_id,
    )
    created = await db["sync_jobs"].find_one({"_id": result.inserted_id})
    return _doc_to_model(created)


async def get_sync_job(db: AsyncIOMotorDatabase, job_id: str) -> SyncJobDocument:
    doc = await _get_job_doc(db, job_id)
    # Refresh status from Celery if still running
    task_id = doc.get("celery_task_id")
    if task_id and doc.get("status") in ("queued", "running"):
        try:
            result = AsyncResult(task_id, app=celery_app)
            if result.state == "SUCCESS":
                await db["sync_jobs"].update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"status": "complete", "completed_at": utc_now()}},
                )
                doc["status"] = "complete"
            elif result.state == "FAILURE":
                await db["sync_jobs"].update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"status": "failed", "completed_at": utc_now()}},
                )
                doc["status"] = "failed"
        except Exception as exc:
            logger.warning("celery_poll_failed", task_id=task_id, error=str(exc))
    return _doc_to_model(doc)


async def list_sync_jobs(
    db: AsyncIOMotorDatabase,
    page: PageParams,
    mode: str | None = None,
    status: str | None = None,
) -> tuple[list[SyncJobDocument], int]:
    query: dict = {}
    if mode:
        query["mode"] = mode
    if status:
        query["status"] = status
    total = await db["sync_jobs"].count_documents(query)
    cursor = db["sync_jobs"].find(query).sort("created_at", -1).skip(page.skip).limit(page.limit)
    docs = await cursor.to_list(length=page.limit)
    return [_doc_to_model(d) for d in docs], total


async def cancel_sync_job(
    db: AsyncIOMotorDatabase,
    job_id: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> SyncJobDocument:
    doc = await _get_job_doc(db, job_id)
    if doc.get("status") not in ("queued", "running"):
        raise NotFoundError("Job is not in a cancellable state")

    task_id = doc.get("celery_task_id")
    if task_id:
        try:
            celery_app.control.revoke(task_id, terminate=True)
        except Exception as exc:
            logger.warning("celery_revoke_failed", task_id=task_id, error=str(exc))

    now = utc_now()
    await db["sync_jobs"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": "cancelled", "completed_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="sync_job.cancel", entity_type="sync_job", entity_id=job_id,
        request_id=request_id,
    )
    updated = await db["sync_jobs"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)
