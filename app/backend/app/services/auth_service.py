from __future__ import annotations

import secrets
from datetime import timedelta

import structlog
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import get_settings
from app.core.audit import write_audit_log
from app.core.exceptions import ConflictError, NotFoundError, UnauthorizedError
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_refresh_token,
    verify_password,
    verify_refresh_token_hash,
)
from app.models.user import UserDocument, UserProfile
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
)
from app.tasks.email import (
    dispatch_password_reset_email,
    dispatch_suspicious_login_email,
    dispatch_verification_email,
)
from app.utils.datetime_utils import utc_now

logger = structlog.get_logger(__name__)

_RESET_TOKEN_TTL_SECONDS = 3600  # 1 hour


def _build_token_response(user_id: str, role: str) -> TokenResponse:
    settings = get_settings()
    access = create_access_token(user_id, role)
    refresh = create_refresh_token(user_id)
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        token_type="bearer",
        expires_in=settings.access_token_expire_minutes * 60,
    )


async def register(
    db: AsyncIOMotorDatabase,
    request: RegisterRequest,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> TokenResponse:
    existing = await db["users"].find_one(
        {"$or": [{"email": request.email}, {"username": request.username}]}
    )
    if existing:
        field = "email" if existing.get("email") == request.email else "username"
        raise ConflictError(f"A user with that {field} already exists")

    now = utc_now()
    verification_token = secrets.token_urlsafe(32)
    doc = {
        "email": request.email,
        "username": request.username,
        "hashed_password": hash_password(request.password),
        "role": "listener",
        "is_active": True,
        "is_verified": False,
        "email_verified_at": None,
        "profile": {"display_name": request.display_name or request.username, "avatar_url": None, "bio": None},
        "artist_id": None,
        "last_login_at": now,
        "last_login_ip": actor_ip,
        "refresh_token_hash": None,
        "verification_token": hash_password(verification_token),
        "created_at": now,
        "updated_at": now,
    }
    result = await db["users"].insert_one(doc)
    user_id = str(result.inserted_id)

    token_response = _build_token_response(user_id, "listener")
    refresh_hash = hash_refresh_token(token_response.refresh_token)
    await db["users"].update_one(
        {"_id": result.inserted_id},
        {"$set": {"refresh_token_hash": refresh_hash}},
    )

    try:
        dispatch_verification_email(user_id, request.email, verification_token)
    except Exception as exc:
        logger.warning("verification_email_dispatch_failed", user_id=user_id, error=str(exc))

    await write_audit_log(
        db, actor_id=user_id, actor_role="listener", actor_ip=actor_ip,
        actor_ua=actor_ua, action="user.register", entity_type="user",
        entity_id=user_id, request_id=request_id,
    )
    return token_response


async def login(
    db: AsyncIOMotorDatabase,
    request: LoginRequest,
    actor_ip: str = "",
    actor_ua: str = "",
    request_id: str = "",
) -> TokenResponse:
    user_doc = await db["users"].find_one({"email": request.email})
    if not user_doc or not verify_password(request.password, user_doc["hashed_password"]):
        raise UnauthorizedError("Invalid email or password")

    if not user_doc.get("is_active", True):
        raise UnauthorizedError("Account is deactivated")

    user_id = str(user_doc["_id"])
    role = user_doc["role"]

    # Suspicious login detection — different IP
    last_ip = user_doc.get("last_login_ip")
    if last_ip and last_ip != actor_ip:
        try:
            dispatch_suspicious_login_email(user_id, user_doc["email"], actor_ip)
        except Exception as exc:
            logger.warning("suspicious_login_email_failed", user_id=user_id, error=str(exc))

    token_response = _build_token_response(user_id, role)
    refresh_hash = hash_refresh_token(token_response.refresh_token)
    now = utc_now()
    await db["users"].update_one(
        {"_id": user_doc["_id"]},
        {"$set": {"refresh_token_hash": refresh_hash, "last_login_at": now, "last_login_ip": actor_ip}},
    )

    await write_audit_log(
        db, actor_id=user_id, actor_role=role, actor_ip=actor_ip,
        actor_ua=actor_ua, action="user.login", entity_type="user",
        entity_id=user_id, request_id=request_id,
    )
    return token_response


async def refresh_tokens(
    db: AsyncIOMotorDatabase,
    request: RefreshRequest,
) -> TokenResponse:
    try:
        payload = decode_token(request.refresh_token)
    except Exception as exc:
        raise UnauthorizedError("Invalid refresh token") from exc

    if payload.get("type") != "refresh":
        raise UnauthorizedError("Not a refresh token")

    user_doc = await db["users"].find_one({"_id": ObjectId(payload["sub"])})
    if not user_doc:
        raise UnauthorizedError("User not found")

    stored_hash = user_doc.get("refresh_token_hash")
    if not stored_hash or not verify_refresh_token_hash(request.refresh_token, stored_hash):
        raise UnauthorizedError("Refresh token has been revoked")

    user_id = str(user_doc["_id"])
    role = user_doc["role"]
    token_response = _build_token_response(user_id, role)
    new_hash = hash_refresh_token(token_response.refresh_token)
    await db["users"].update_one(
        {"_id": user_doc["_id"]},
        {"$set": {"refresh_token_hash": new_hash}},
    )
    return token_response


async def logout(db: AsyncIOMotorDatabase, user_id: str) -> None:
    await db["users"].update_one(
        {"_id": ObjectId(user_id)},
        {"$set": {"refresh_token_hash": None}},
    )


async def verify_email(db: AsyncIOMotorDatabase, token: str) -> None:
    # Token was stored as a bcrypt hash — iterate pending users
    # In production use a Redis key:token mapping for O(1) lookup
    cursor = db["users"].find({"is_verified": False, "verification_token": {"$exists": True}})
    async for user_doc in cursor:
        stored = user_doc.get("verification_token", "")
        if stored and verify_password(token, stored):
            now = utc_now()
            await db["users"].update_one(
                {"_id": user_doc["_id"]},
                {"$set": {"is_verified": True, "email_verified_at": now, "updated_at": now},
                 "$unset": {"verification_token": ""}},
            )
            return
    raise UnauthorizedError("Invalid or expired verification token")


async def forgot_password(db: AsyncIOMotorDatabase, email: str) -> None:
    user_doc = await db["users"].find_one({"email": email})
    if not user_doc:
        return  # silently ignore unknown emails

    reset_token = secrets.token_urlsafe(32)
    now = utc_now()
    expires_at = now + timedelta(seconds=_RESET_TOKEN_TTL_SECONDS)
    await db["users"].update_one(
        {"_id": user_doc["_id"]},
        {"$set": {
            "reset_token_hash": hash_password(reset_token),
            "reset_token_expires_at": expires_at,
            "updated_at": now,
        }},
    )
    try:
        dispatch_password_reset_email(str(user_doc["_id"]), email, reset_token)
    except Exception as exc:
        logger.warning("password_reset_email_failed", email=email, error=str(exc))


async def reset_password(
    db: AsyncIOMotorDatabase,
    request: ResetPasswordRequest,
) -> None:
    now = utc_now()
    cursor = db["users"].find({"reset_token_hash": {"$exists": True}, "reset_token_expires_at": {"$gt": now}})
    async for user_doc in cursor:
        stored = user_doc.get("reset_token_hash", "")
        if stored and verify_password(request.token, stored):
            await db["users"].update_one(
                {"_id": user_doc["_id"]},
                {"$set": {"hashed_password": hash_password(request.new_password), "updated_at": now,
                           "refresh_token_hash": None},
                 "$unset": {"reset_token_hash": "", "reset_token_expires_at": ""}},
            )
            return
    raise UnauthorizedError("Invalid or expired reset token")
