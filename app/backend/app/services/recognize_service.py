from __future__ import annotations

import asyncio
from collections import Counter

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import get_settings
from app.fingerprint.engine import fingerprint_bytes
from app.fingerprint.store import FingerprintStore
from app.schemas.recognize import RecognizeResponse
from app.utils.r2 import generate_presigned_url

# Minimum aligned time-delta matches required to declare a hit
_CONFIDENCE_THRESHOLD = 5
# Score at which confidence saturates to 1.0
_MAX_SCORE = 50


def _align_score(matches: dict[bytes, list[tuple[int, int]]]) -> list[tuple[bytes, int]]:
    scores: list[tuple[bytes, int]] = []
    for tid_bytes, pairs in matches.items():
        deltas = Counter(stored - query for stored, query in pairs)
        best = deltas.most_common(1)[0][1] if deltas else 0
        scores.append((tid_bytes, best))
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores


async def recognize(db: AsyncIOMotorDatabase, audio_bytes: bytes) -> RecognizeResponse:
    settings = get_settings()
    loop = asyncio.get_running_loop()

    # CPU-bound + subprocess — run off the event loop
    fps = await loop.run_in_executor(None, fingerprint_bytes, audio_bytes)
    if not fps:
        return RecognizeResponse(match=False, score=0)

    def _query() -> dict[bytes, list[tuple[int, int]]]:
        store = FingerprintStore(settings.fingerprint_db_path, read_only=True)
        try:
            return store.query(fps)
        finally:
            store.close()

    matches = await loop.run_in_executor(None, _query)
    if not matches:
        return RecognizeResponse(match=False, score=0)

    scores = _align_score(matches)
    best_tid_bytes, best_score = scores[0]

    if best_score < _CONFIDENCE_THRESHOLD:
        return RecognizeResponse(match=False, score=best_score)

    track_id = ObjectId(best_tid_bytes)
    doc = await db["tracks"].find_one(
        {"_id": track_id},
        {"title": 1, "artist_id": 1, "artwork_r2_key": 1},
    )
    if not doc:
        return RecognizeResponse(match=False, score=best_score)

    artist_name: str | None = None
    if doc.get("artist_id"):
        artist_doc = await db["artists"].find_one({"_id": doc["artist_id"]}, {"name": 1})
        if artist_doc:
            artist_name = artist_doc.get("name")

    artwork_url: str | None = None
    if doc.get("artwork_r2_key"):
        try:
            artwork_url = generate_presigned_url(doc["artwork_r2_key"], expires=3600)
        except Exception:
            pass

    confidence = min(1.0, best_score / _MAX_SCORE)

    return RecognizeResponse(
        match=True,
        confidence=confidence,
        score=best_score,
        track_id=str(track_id),
        title=doc.get("title"),
        artist=artist_name,
        artwork_url=artwork_url,
    )
