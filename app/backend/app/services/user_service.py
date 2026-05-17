from __future__ import annotations

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

import hashlib

from app.core.audit import write_audit_log
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.core.pagination import PageParams
from app.core.security import hash_password
from app.models.user import UserDocument
from app.schemas.user import AdminCreateUserRequest, UserRoleUpdateRequest, UserUpdateRequest
from app.utils.datetime_utils import utc_now
from app.utils.r2 import generate_presigned_url, get_r2_client


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
    search: str | None = None,
    caller_role: str = "admin",
) -> tuple[list[UserDocument], int]:
    query: dict = {}
    if role:
        # Non-superadmin callers can never list superadmin accounts
        if role == "superadmin" and caller_role != "superadmin":
            return [], 0
        query["role"] = role
    elif caller_role != "superadmin":
        query["role"] = {"$ne": "superadmin"}
    if search:
        import re
        pattern = re.compile(re.escape(search), re.IGNORECASE)
        query["$or"] = [{"username": pattern}, {"email": pattern}]
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
    # Non-admin can only edit own profile; admin cannot edit superadmin profiles
    if actor.role not in ("admin", "superadmin") and str(doc["_id"]) != str(actor.id):
        raise ForbiddenError("You can only update your own profile")
    if doc.get("role") == "superadmin" and actor.role != "superadmin":
        raise ForbiddenError("You cannot modify a superadmin account")

    updates: dict = {}
    if body.display_name is not None:
        updates["profile.display_name"] = body.display_name
    if body.bio is not None:
        updates["profile.bio"] = body.bio
    if body.avatar_url is not None:
        updates["profile.avatar_url"] = body.avatar_url
    if body.phone is not None:
        updates["profile.phone"] = body.phone or None
    if body.email is not None:
        email_str = str(body.email)
        existing = await db["users"].find_one({"email": email_str, "_id": {"$ne": doc["_id"]}})
        if existing:
            raise ConflictError("That email address is already in use")
        updates["email"] = email_str
        updates["is_verified"] = False

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
    # Only superadmin can interact with superadmin accounts or promote to superadmin
    if actor.role != "superadmin":
        if before_role == "superadmin":
            raise ForbiddenError("You cannot modify a superadmin account")
        if body.role == "superadmin":
            raise ForbiddenError("You cannot promote a user to superadmin")
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


GRANTABLE_PERMISSIONS = {"accounting"}


async def grant_permission(
    db: AsyncIOMotorDatabase,
    user_id: str,
    permission: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> UserDocument:
    if permission not in GRANTABLE_PERMISSIONS:
        raise ForbiddenError(f"Permission '{permission}' cannot be granted")
    doc = await _get_user_doc(db, user_id)
    if doc.get("role") not in ("admin",):
        raise ForbiddenError("Extra permissions can only be granted to admin users")
    now = utc_now()
    await db["users"].update_one(
        {"_id": doc["_id"]},
        {"$addToSet": {"extra_permissions": permission}, "$set": {"updated_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="user.permission_grant", entity_type="user", entity_id=user_id,
        before={}, after={"permission": permission},
        request_id=request_id,
    )
    updated = await db["users"].find_one({"_id": doc["_id"]})
    return _doc_to_model(updated)


async def revoke_permission(
    db: AsyncIOMotorDatabase,
    user_id: str,
    permission: str,
    actor: UserDocument,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> UserDocument:
    if permission not in GRANTABLE_PERMISSIONS:
        raise ForbiddenError(f"Permission '{permission}' cannot be revoked")
    doc = await _get_user_doc(db, user_id)
    now = utc_now()
    await db["users"].update_one(
        {"_id": doc["_id"]},
        {"$pull": {"extra_permissions": permission}, "$set": {"updated_at": now}},
    )
    await write_audit_log(
        db, actor_id=str(actor.id), actor_role=actor.role,
        actor_ip=actor_ip, actor_ua=actor_ua,
        action="user.permission_revoke", entity_type="user", entity_id=user_id,
        before={"permission": permission}, after={},
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


async def get_accounting_admin_emails(db: AsyncIOMotorDatabase) -> list[str]:
    """Return email addresses of all active admin users who have the 'accounting' permission."""
    cursor = db["users"].find(
        {"role": "admin", "is_active": True, "extra_permissions": "accounting"},
        {"email": 1},
    )
    return [doc["email"] async for doc in cursor]


async def upload_avatar(
    db: AsyncIOMotorDatabase,
    user_id: str,
    file_bytes: bytes,
    content_type: str,
) -> UserDocument:
    from app.config import get_settings
    settings = get_settings()
    sha = hashlib.sha256(file_bytes).hexdigest()[:12]
    ext = "jpg" if "jpeg" in content_type or "jpg" in content_type else "png" if "png" in content_type else "webp"
    r2_key = f"profiles/avatars/{user_id}_{sha}.{ext}"
    get_r2_client().put_object(
        Bucket=settings.r2_bucket,
        Key=r2_key,
        Body=file_bytes,
        ContentType=content_type,
    )
    avatar_url = generate_presigned_url(r2_key, expires=3600 * 24 * 30)
    now = utc_now()
    await db["users"].update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"profile.avatar_r2_key": r2_key, "profile.avatar_url": avatar_url, "updated_at": now}},
    )
    updated = await db["users"].find_one({"_id": ObjectId(user_id)})
    return _doc_to_model(updated)
