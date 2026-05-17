from __future__ import annotations

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from motor.motor_asyncio import AsyncIOMotorDatabase
from redis.asyncio import Redis

from app.core.exceptions import UnauthorizedError
from app.core.security import decode_token
from app.db.mongo import get_database
from app.db.redis import get_redis as _get_redis_client

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)


async def get_db() -> AsyncIOMotorDatabase:
    return get_database()


async def get_redis() -> Redis:
    return _get_redis_client()


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    from bson import ObjectId
    from app.models.user import UserDocument

    if not token:
        raise UnauthorizedError("Authentication required")

    payload = decode_token(token)

    if payload.get("type") != "access":
        raise UnauthorizedError("Not an access token")

    user_id = payload.get("sub")
    if not user_id:
        raise UnauthorizedError("Invalid token payload")

    try:
        doc = await db["users"].find_one({"_id": ObjectId(user_id)})
    except Exception:
        doc = None

    if not doc:
        raise UnauthorizedError("User not found")

    return UserDocument.model_validate(doc)


async def get_current_active_user(
    current_user=Depends(get_current_user),
):
    if not current_user.is_active:
        raise UnauthorizedError("Account is deactivated")
    return current_user
