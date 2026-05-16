from __future__ import annotations

import structlog
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, TEXT

from app.config import get_settings

logger = structlog.get_logger(__name__)

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


def get_client() -> AsyncIOMotorClient:
    if _client is None:
        raise RuntimeError("MongoDB client not initialised — call connect_db() first")
    return _client


def get_database() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("MongoDB not initialised — call connect_db() first")
    return _db


def get_collection(name: str):
    return get_database()[name]


async def connect_db() -> None:
    global _client, _db
    settings = get_settings()
    _client = AsyncIOMotorClient(settings.mongo_url)
    _db = _client[settings.mongo_db]
    # Verify connectivity
    await _client.admin.command("ping")
    logger.info("mongodb_connected", db=settings.mongo_db)


async def disconnect_db() -> None:
    global _client, _db
    if _client is not None:
        _client.close()
        _client = None
        _db = None
    logger.info("mongodb_disconnected")


async def create_indexes() -> None:
    """Create all collection indexes. Safe to call on every startup (idempotent)."""
    db = get_database()

    # ── users ──────────────────────────────────────────────────────────────────
    await db["users"].create_index("email", unique=True, background=True)
    await db["users"].create_index("username", unique=True, background=True)
    await db["users"].create_index("role", background=True)
    await db["users"].create_index("artist_id", background=True)

    # ── artists ────────────────────────────────────────────────────────────────
    await db["artists"].create_index("slug", unique=True, background=True)
    await db["artists"].create_index("status", background=True)
    await db["artists"].create_index("user_id", background=True)
    await db["artists"].create_index("genres", background=True)

    # ── tracks ─────────────────────────────────────────────────────────────────
    await db["tracks"].create_index("artist_id", background=True)
    await db["tracks"].create_index("status", background=True)
    await db["tracks"].create_index("sha256", background=True)
    await db["tracks"].create_index("md5", background=True)
    await db["tracks"].create_index("duplicate_group_id", background=True)
    await db["tracks"].create_index(
        [("title", TEXT), ("album", TEXT)],
        # Prevent MongoDB from treating the "language" field as a per-document language override
        language_override="__text_language__",
        background=True,
    )
    await db["tracks"].create_index(
        [("created_at", DESCENDING)], background=True
    )

    # ── uploads ────────────────────────────────────────────────────────────────
    await db["uploads"].create_index("uploaded_by", background=True)
    await db["uploads"].create_index("status", background=True)
    await db["uploads"].create_index(
        [("created_at", DESCENDING)], background=True
    )

    # ── analytics_events ───────────────────────────────────────────────────────
    await db["analytics_events"].create_index(
        [("track_id", ASCENDING), ("occurred_at", DESCENDING)], background=True
    )
    await db["analytics_events"].create_index(
        [("artist_id", ASCENDING), ("occurred_at", DESCENDING)], background=True
    )
    await db["analytics_events"].create_index("event_type", background=True)
    await db["analytics_events"].create_index("user_id", background=True)
    await db["analytics_events"].create_index(
        "occurred_at",
        expireAfterSeconds=63_072_000,  # 2 years TTL
        background=True,
    )

    # ── sync_jobs ──────────────────────────────────────────────────────────────
    await db["sync_jobs"].create_index("status", background=True)
    await db["sync_jobs"].create_index("mode", background=True)
    await db["sync_jobs"].create_index(
        [("created_at", DESCENDING)], background=True
    )

    # ── audit_logs ─────────────────────────────────────────────────────────────
    await db["audit_logs"].create_index("actor_id", background=True)
    await db["audit_logs"].create_index(
        [("entity_type", ASCENDING), ("entity_id", ASCENDING)], background=True
    )
    await db["audit_logs"].create_index("action", background=True)
    await db["audit_logs"].create_index(
        [("occurred_at", DESCENDING)], background=True
    )

    logger.info("mongodb_indexes_created")
