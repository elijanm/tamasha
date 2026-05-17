from __future__ import annotations

import structlog
from pymongo import MongoClient
from pymongo.database import Database

from worker.config import get_settings

logger = structlog.get_logger(__name__)

_client: MongoClient | None = None


def get_client() -> MongoClient:
    global _client
    if _client is None:
        settings = get_settings()
        _client = MongoClient(settings.mongo_url, serverSelectionTimeoutMS=5000)
    return _client


def get_db() -> Database:
    settings = get_settings()
    return get_client()[settings.mongo_db]


def close_client() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
