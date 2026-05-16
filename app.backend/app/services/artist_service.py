from __future__ import annotations

import re

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.audit import write_audit_log
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.core.pagination import PageParams
from app.models.artist import ArtistDocument, OwnershipRequest
from app.models.user import UserDocument
from app.schemas.artist import ArtistCreateRequest, ArtistUpdateRequest, OwnershipRequestReview
from app.tasks.email import dispatch_artist_approval_email
from app.utils.datetime_utils import utc_now
from app.utils.object_id import PyObjectId


def _slugify(name: str) -> str:
    slug = re.sub(r"[^\w\s-]", "", name.lower())
    return re.sub(r"[\s_-]+", "-", slug).strip("-")


def _doc_to_model(doc: dict) -> ArtistDocument:
    return ArtistDocument.model_validate(doc)


async def _get_artist_doc(db: AsyncIOMotorDatabase, artist_id: str) -> dict:
    try:
        doc = await db["artists"].find_one({"_id": ObjectId(artist_id)})
    except Exception:
        doc = None
    if not doc:
        raise NotFoundError(f"Artist {artist_id} not found")
    return doc


async def create_artist(
    db: AsyncIOMotorDatabase,
    body: ArtistCreateRequest,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> ArtistDocument:
    base_slug = _slugify(body.display_name)
    slug = base_slug
    counter = 1
    while await db["artists"].find_one({"slug": slug}):
        slug = f"{base_slug}-{counter}"
        counter += 1

    now = utc_now()
    doc = {
        "user_id": None,
        "slug": slug,
        "display_name": body.display_name,
        "bio": body.bio,
        "image_url": body.image_url,
        "country": body.country,
        "genres": body.genres,
        "is_band": body.is_band,
        "status": "pending",
        "approved_by": None,
        "approved_at": None,
        "ownership_requests": [],
        "created_by": ObjectId(str(actor.id)),
        "created_at": now,
        "updated_at": now,
    }
    result = await db["artists"].insert_one(doc)
    artist_id = str(result.inserted_id)
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="artist.create", entity_type="artist", entity_id=artist_id,
        after={"display_name": body.display_name, "slug": slug},
        request_id=request_id,
    )
    created = await db["artists"].find_one({"_id": result.inserted_id})
    return _doc_to_model(created)


async def get_artist(db: AsyncIOMotorDatabase, artist_id: str) -> ArtistDocument:
    return _doc_to_model(await _get_artist_doc(db, artist_id))


async def get_artist_by_slug(db: AsyncIOMotorDatabase, slug: str) -> ArtistDocument:
    doc = await db["artists"].find_one({"slug": slug})
    if not doc:
        raise NotFoundError(f"Artist with slug '{slug}' not found")
    return _doc_to_model(doc)


async def list_artists(
    db: AsyncIOMotorDatabase,
    page: PageParams,
    status: str | None = None,
    genre: str | None = None,
    search: str | None = None,
    is_band: bool | None = None,
) -> tuple[list[ArtistDocument], int]:
    query: dict = {}
    if status:
        query["status"] = status
    if genre:
        query["genres"] = genre
    if search:
        query["display_name"] = {"$regex": search, "$options": "i"}
    if is_band is not None:
        query["is_band"] = is_band
    total = await db["artists"].count_documents(query)
    cursor = db["artists"].find(query).skip(page.skip).limit(page.limit)
    docs = await cursor.to_list(length=page.limit)
    return [_doc_to_model(d) for d in docs], total


async def update_artist(
    db: AsyncIOMotorDatabase,
    artist_id: str,
    body: ArtistUpdateRequest,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> ArtistDocument:
    doc = await _get_artist_doc(db, artist_id)
    if actor.role == "artist":
        if not doc.get("user_id") or str(doc["user_id"]) != str(actor.id):
            raise ForbiddenError("You can only update your own artist profile")

    updates: dict = {}
    for field in ("display_name", "bio", "image_url", "country", "genres", "is_band", "status"):
        val = getattr(body, field)
        if val is not None:
            updates[field] = val

    if not updates:
        return _doc_to_model(doc)

    updates["updated_at"] = utc_now()
    before = {k: doc.get(k) for k in updates}
    await db["artists"].update_one({"_id": doc["_id"]}, {"$set": updates})
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="artist.update", entity_type="artist", entity_id=artist_id,
        before=before, after=updates, request_id=request_id,
    )
    updated = await db["artists"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)


async def approve_artist(
    db: AsyncIOMotorDatabase,
    artist_id: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> ArtistDocument:
    doc = await _get_artist_doc(db, artist_id)
    now = utc_now()
    await db["artists"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": "approved", "approved_by": ObjectId(str(actor.id)), "approved_at": now, "updated_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="artist.approve", entity_type="artist", entity_id=artist_id,
        before={"status": doc.get("status")}, after={"status": "approved"},
        request_id=request_id,
    )
    # Notify linked user if any
    if doc.get("user_id"):
        user_doc = await db["users"].find_one({"_id": doc["user_id"]})
        if user_doc:
            try:
                dispatch_artist_approval_email(str(doc["user_id"]), user_doc["email"], "approved")
            except Exception:
                pass
    updated = await db["artists"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)


async def reject_artist(
    db: AsyncIOMotorDatabase,
    artist_id: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> ArtistDocument:
    doc = await _get_artist_doc(db, artist_id)
    now = utc_now()
    await db["artists"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"status": "rejected", "updated_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="artist.reject", entity_type="artist", entity_id=artist_id,
        before={"status": doc.get("status")}, after={"status": "rejected"},
        request_id=request_id,
    )
    if doc.get("user_id"):
        user_doc = await db["users"].find_one({"_id": doc["user_id"]})
        if user_doc:
            try:
                dispatch_artist_approval_email(str(doc["user_id"]), user_doc["email"], "rejected")
            except Exception:
                pass
    updated = await db["artists"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)


async def request_ownership(
    db: AsyncIOMotorDatabase,
    artist_id: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> ArtistDocument:
    doc = await _get_artist_doc(db, artist_id)
    for req in doc.get("ownership_requests", []):
        if str(req.get("user_id")) == str(actor.id) and req.get("status") == "pending":
            raise ConflictError("You already have a pending ownership request for this artist")

    new_req = {
        "_id": ObjectId(),
        "user_id": ObjectId(str(actor.id)),
        "status": "pending",
        "notes": None,
        "requested_at": utc_now(),
        "reviewed_at": None,
        "reviewed_by": None,
    }
    now = utc_now()
    await db["artists"].update_one(
        {"_id": doc["_id"]},
        {"$push": {"ownership_requests": new_req}, "$set": {"updated_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="artist.ownership_request", entity_type="artist", entity_id=artist_id,
        request_id=request_id,
    )
    updated = await db["artists"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)


async def review_ownership_request(
    db: AsyncIOMotorDatabase,
    artist_id: str,
    req_id: str,
    body: OwnershipRequestReview,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> ArtistDocument:
    doc = await _get_artist_doc(db, artist_id)
    now = utc_now()
    await db["artists"].update_one(
        {"_id": doc["_id"], "ownership_requests._id": ObjectId(req_id)},
        {"$set": {
            "ownership_requests.$.status": body.status,
            "ownership_requests.$.notes": body.notes,
            "ownership_requests.$.reviewed_at": now,
            "ownership_requests.$.reviewed_by": ObjectId(str(actor.id)),
            "updated_at": now,
        }},
    )
    # If approved, link the user as owner
    if body.status == "approved":
        req = next(
            (r for r in doc.get("ownership_requests", []) if str(r.get("_id")) == req_id),
            None,
        )
        if req:
            user_id_obj = req.get("user_id")
            await db["artists"].update_one(
                {"_id": doc["_id"]},
                {"$set": {"user_id": user_id_obj}},
            )
            await db["users"].update_one(
                {"_id": user_id_obj},
                {"$set": {"artist_id": doc["_id"], "updated_at": now}},
            )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action=f"artist.ownership_{body.status}", entity_type="artist", entity_id=artist_id,
        after={"req_id": req_id, "status": body.status},
        request_id=request_id,
    )
    updated = await db["artists"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)


async def delete_artist(
    db: AsyncIOMotorDatabase,
    artist_id: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> None:
    doc = await _get_artist_doc(db, artist_id)
    await db["artists"].delete_one({"_id": doc["_id"]})
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="artist.delete", entity_type="artist", entity_id=artist_id,
        before={"display_name": doc.get("display_name")},
        request_id=request_id,
    )
