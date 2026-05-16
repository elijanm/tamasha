from __future__ import annotations

import structlog
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import get_settings
from app.core.security import hash_password
from app.utils.datetime_utils import utc_now

logger = structlog.get_logger(__name__)


def _user_doc(email: str, username: str, password: str, role: str, display_name: str, now) -> dict:
    return {
        "email": email,
        "username": username,
        "hashed_password": hash_password(password),
        "role": role,
        "is_active": True,
        "is_verified": True,
        "email_verified_at": now,
        "profile": {"display_name": display_name, "avatar_url": None, "bio": None},
        "artist_id": None,
        "last_login_at": None,
        "last_login_ip": None,
        "refresh_token_hash": None,
        "created_at": now,
        "updated_at": now,
    }


async def ensure_admin_user(db: AsyncIOMotorDatabase) -> None:
    """Create default superadmin and admin users on first boot."""
    settings = get_settings()
    now = utc_now()

    if not await db["users"].find_one({"role": "superadmin"}):
        try:
            await db["users"].insert_one(
                _user_doc(
                    settings.seed_superadmin_email,
                    settings.seed_superadmin_username,
                    settings.seed_superadmin_password,
                    "superadmin",
                    "Super Administrator",
                    now,
                )
            )
            logger.warning(
                "seed_superadmin_created",
                email=settings.seed_superadmin_email,
                message="Default superadmin created — change the password immediately",
            )
        except Exception:
            pass

    if not await db["users"].find_one({"role": "admin"}):
        try:
            await db["users"].insert_one(
                _user_doc(
                    settings.seed_admin_email,
                    settings.seed_admin_username,
                    settings.seed_admin_password,
                    "admin",
                    "Administrator",
                    now,
                )
            )
            logger.warning(
                "seed_admin_created",
                email=settings.seed_admin_email,
                message="Default admin user created — change the password immediately",
            )
        except Exception:
            pass
