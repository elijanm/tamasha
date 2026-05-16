from __future__ import annotations

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.audit import write_audit_log
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.core.pagination import PageParams
from app.core.security import hash_password
from app.models.user import UserDocument
from app.schemas.user import AdminCreateUserRequest, UserRoleUpdateRequest, UserUpdateRequest
from app.utils.datetime_utils import utc_now


async def _get_user_doc(db: AsyncIOMotorDatabase, user_id: str) -> dict:
    try:
        doc = await db["users"].find_one({"_id": ObjectId(user_id)})
    except Exception:
        doc = None
    if not doc:
        raise NotFoundError(f"User {user_id} not found")
    return doc


def _doc_to_model(doc: dict) -> UserDocument:
    doc["_id"] = doc.get("_id")
    return UserDocument.model_validate(doc)


async def get_user(db: AsyncIOMotorDatabase, user_id: str) -> UserDocument:
    return _doc_to_model(await _get_user_doc(db, user_id))


async def admin_create_user(
    db: AsyncIOMotorDatabase,
    body: AdminCreateUserRequest,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> UserDocument:
    existing = await db["users"].find_one({"email": body.email.lower()})
    if existing:
        raise ConflictError(f"Email {body.email} is already registered")
    existing_uname = await db["users"].find_one({"username": body.username})
    if existing_uname:
        raise ConflictError(f"Username {body.username} is already taken")

    now = utc_now()
    doc = {
        "email": body.email.lower(),
        "username": body.username,
        "hashed_password": hash_password(body.password),
        "role": body.role,
        "is_active": True,
        "is_verified": True,
        "email_verified_at": now,
        "profile": {"display_name": body.username, "avatar_url": None, "bio": None},
        "artist_id": None,
        "last_login_at": None,
        "last_login_ip": None,
        "refresh_token_hash": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await db["users"].insert_one(doc)
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="user.admin_create", entity_type="user", entity_id=str(result.inserted_id),
        before={}, after={"email": doc["email"], "role": doc["role"]},
        request_id=request_id,
    )
    created = await db["users"].find_one({"_id": result.inserted_id})
    return _doc_to_model(created)


async def list_users(
    db: AsyncIOMotorDatabase,
    page: PageParams,
    role: str | None = None,
) -> tuple[list[UserDocument], int]:
    query: dict = {}
    if role:
        query["role"] = role
    total = await db["users"].count_documents(query)
    cursor = db["users"].find(query).skip(page.skip).limit(page.limit)
    docs = await cursor.to_list(length=page.limit)
    return [_doc_to_model(d) for d in docs], total


async def update_user(
    db: AsyncIOMotorDatabase,
    user_id: str,
    body: UserUpdateRequest,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> UserDocument:
    doc = await _get_user_doc(db, user_id)
    # Non-admin can only edit own profile
    if actor.role != "admin" and str(doc["_id"]) != str(actor.id):
        raise ForbiddenError("You can only update your own profile")

    updates: dict = {}
    if body.display_name is not None:
        updates["profile.display_name"] = body.display_name
    if body.bio is not None:
        updates["profile.bio"] = body.bio
    if body.avatar_url is not None:
        updates["profile.avatar_url"] = body.avatar_url

    if not updates:
        return _doc_to_model(doc)

    updates["updated_at"] = utc_now()
    before = {k: doc.get(k) for k in updates}
    await db["users"].update_one({"_id": doc["_id"]}, {"$set": updates})

    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="user.update", entity_type="user", entity_id=user_id,
        before=before, after=updates, request_id=request_id,
    )
    updated = await db["users"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)


async def change_role(
    db: AsyncIOMotorDatabase,
    user_id: str,
    body: UserRoleUpdateRequest,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> UserDocument:
    doc = await _get_user_doc(db, user_id)
    before_role = doc.get("role")
    now = utc_now()
    await db["users"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"role": body.role, "updated_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="user.role_change", entity_type="user", entity_id=user_id,
        before={"role": before_role}, after={"role": body.role},
        request_id=request_id,
    )
    updated = await db["users"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)


async def deactivate_user(
    db: AsyncIOMotorDatabase,
    user_id: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> UserDocument:
    doc = await _get_user_doc(db, user_id)
    now = utc_now()
    await db["users"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"is_active": False, "refresh_token_hash": None, "updated_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="user.deactivate", entity_type="user", entity_id=user_id,
        request_id=request_id,
    )
    updated = await db["users"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)


async def activate_user(
    db: AsyncIOMotorDatabase,
    user_id: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> UserDocument:
    doc = await _get_user_doc(db, user_id)
    now = utc_now()
    await db["users"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"is_active": True, "updated_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="user.activate", entity_type="user", entity_id=user_id,
        request_id=request_id,
    )
    updated = await db["users"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)
