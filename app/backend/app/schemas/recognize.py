from __future__ import annotations

from pydantic import BaseModel


class RecognizeResponse(BaseModel):
    match: bool
    confidence: float = 0.0
    score: int = 0
    track_id: str | None = None
    title: str | None = None
    artist: str | None = None
    artwork_url: str | None = None
