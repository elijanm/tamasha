from __future__ import annotations

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.audit import write_audit_log
from app.core.exceptions import ForbiddenError, NotFoundError
from app.core.pagination import PageParams
from app.models.upload import UploadDocument
from app.models.user import UserDocument
from app.schemas.upload import (
    PresignedUploadItem,
    UploadCompleteRequest,
    UploadInitiateRequest,
    UploadInitiateResponse,
)
from app.services.storage_service import StorageService
from app.tasks.dedup import dispatch_dedup_task
from app.tasks.email import dispatch_upload_complete_email
from app.tasks.transcoding import dispatch_transcode_task
from app.utils.datetime_utils import utc_now


def _doc_to_model(doc: dict) -> UploadDocument:
    return UploadDocument.model_validate(doc)


async def _get_upload_doc(db: AsyncIOMotorDatabase, upload_id: str) -> dict:
    try:
        doc = await db["uploads"].find_one({"_id": ObjectId(upload_id)})
    except Exception:
        doc = None
    if not doc:
        raise NotFoundError(f"Upload {upload_id} not found")
    return doc


async def initiate_upload(
    db: AsyncIOMotorDatabase,
    storage: StorageService,
    body: UploadInitiateRequest,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> UploadInitiateResponse:
    now = utc_now()
    # Create the upload document first so we have the ID for key generation
    upload_doc = {
        "uploaded_by": ObjectId(str(actor.id)),
        "manifest": [],
        "total_files": len(body.files),
        "processed_files": 0,
        "failed_files": 0,
        "status": "pending",
        "source_folder": body.source_folder,
        "celery_task_id": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await db["uploads"].insert_one(upload_doc)
    upload_id = str(result.inserted_id)

    manifest_items = []
    presigned_items = []

    for file_item in body.files:
        r2_key = storage.make_track_raw_key(upload_id, file_item.original_filename)
        upload_url = await storage.generate_presigned_upload_url(r2_key)

        manifest_items.append({
            "r2_key": r2_key,
            "original_filename": file_item.original_filename,
            "file_size": file_item.file_size,
            "sha256": file_item.sha256,
            "status": "pending",
            "track_id": None,
            "error": None,
        })
        presigned_items.append(
            PresignedUploadItem(
                r2_key=r2_key,
                upload_url=upload_url,
                original_filename=file_item.original_filename,
            )
        )

    await db["uploads"].update_one(
        {"_id": result.inserted_id},
        {"$set": {"manifest": manifest_items, "updated_at": now}},
    )

    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="upload.initiate", entity_type="upload", entity_id=upload_id,
        after={"total_files": len(body.files)}, request_id=request_id,
    )
    return UploadInitiateResponse(upload_id=upload_id, items=presigned_items)


async def complete_upload(
    db: AsyncIOMotorDatabase,
    body: UploadCompleteRequest,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> UploadDocument:
    doc = await _get_upload_doc(db, body.upload_id)
    if str(doc["uploaded_by"]) != str(actor.id) and actor.role not in ("admin", "staff"):
        raise ForbiddenError("You do not own this upload")

    now = utc_now()
    confirmed_set = set(body.confirmed_keys)
    manifest = doc.get("manifest", [])
    processed = 0

    for item in manifest:
        if item["r2_key"] in confirmed_set:
            item["status"] = "complete"
            processed += 1

    failed = sum(1 for i in manifest if i["status"] == "failed")
    if processed == len(manifest):
        status = "complete"
    elif processed == 0:
        status = "failed"
    elif failed > 0:
        status = "partial_failure"
    else:
        status = "processing"

    await db["uploads"].update_one(
        {"_id": doc["_id"]},
        {"$set": {
            "manifest": manifest,
            "processed_files": processed,
            "failed_files": failed,
            "status": status,
            "updated_at": now,
        }},
    )

    # Dispatch processing tasks for confirmed files
    for item in manifest:
        if item["status"] == "complete":
            track_doc = {
                "r2_key_raw": item["r2_key"],
                "r2_keys_transcoded": {},
                "artist_id": None,
                "album": None,
                "title": item["original_filename"].rsplit(".", 1)[0],
                "year": None,
                "genre": None,
                "language": None,
                "duration_seconds": None,
                "file_size_bytes": item["file_size"],
                "sha256": item["sha256"],
                "md5": "",
                "artwork_r2_key": None,
                "waveform_r2_key": None,
                "tags": [],
                "status": "pending",
                "metadata_version": 1,
                "metadata_history": [],
                "duplicate_group_id": None,
                "is_canonical": False,
                "skiza_clip_ids": [],
                "stream_count": 0,
                "like_count": 0,
                "created_by": ObjectId(str(actor.id)),
                "created_at": now,
                "updated_at": now,
            }
            track_result = await db["tracks"].insert_one(track_doc)
            track_id = str(track_result.inserted_id)

            try:
                dispatch_transcode_task(track_id, item["r2_key"])
                dispatch_dedup_task(track_id, item["sha256"], item.get("md5", ""))
            except Exception:
                pass

            # Link track to manifest item
            await db["uploads"].update_one(
                {"_id": doc["_id"], "manifest.r2_key": item["r2_key"]},
                {"$set": {"manifest.$.track_id": track_result.inserted_id}},
            )

    # Notify uploader
    user_doc = await db["users"].find_one({"_id": doc["uploaded_by"]})
    if user_doc:
        try:
            dispatch_upload_complete_email(str(doc["uploaded_by"]), user_doc["email"], body.upload_id)
        except Exception:
            pass

    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="upload.complete", entity_type="upload", entity_id=body.upload_id,
        after={"processed": processed, "status": status}, request_id=request_id,
    )
    updated = await db["uploads"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)


async def get_upload(
    db: AsyncIOMotorDatabase,
    upload_id: str,
    actor: UserDocument,
) -> UploadDocument:
    doc = await _get_upload_doc(db, upload_id)
    if actor.role not in ("admin", "staff") and str(doc["uploaded_by"]) != str(actor.id):
        raise ForbiddenError("You do not have access to this upload")
    return _doc_to_model(doc)


async def list_uploads(
    db: AsyncIOMotorDatabase,
    page: PageParams,
    actor: UserDocument,
) -> tuple[list[UploadDocument], int]:
    query: dict = {}
    if actor.role not in ("admin", "staff"):
        query["uploaded_by"] = ObjectId(str(actor.id))
    total = await db["uploads"].count_documents(query)
    cursor = db["uploads"].find(query).sort("created_at", -1).skip(page.skip).limit(page.limit)
    docs = await cursor.to_list(length=page.limit)
    return [_doc_to_model(d) for d in docs], total


async def retry_upload(
    db: AsyncIOMotorDatabase,
    upload_id: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> UploadDocument:
    doc = await _get_upload_doc(db, upload_id)
    if actor.role not in ("admin", "staff") and str(doc["uploaded_by"]) != str(actor.id):
        raise ForbiddenError("You do not have access to this upload")

    manifest = doc.get("manifest", [])
    now = utc_now()
    for item in manifest:
        if item["status"] == "failed":
            item["status"] = "pending"
            item["error"] = None

    await db["uploads"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"manifest": manifest, "status": "pending", "updated_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="upload.retry", entity_type="upload", entity_id=upload_id,
        request_id=request_id,
    )
    updated = await db["uploads"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)
