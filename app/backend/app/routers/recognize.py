from __future__ import annotations

from fastapi import APIRouter, File, UploadFile
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.dependencies import get_db
from fastapi import Depends

from app.schemas.recognize import RecognizeResponse
from app.services import recognize_service

router = APIRouter(prefix="/recognize", tags=["recognize"])


@router.post("", response_model=RecognizeResponse)
async def recognize_audio(
    file: UploadFile = File(..., description="Audio clip (WebM, MP3, WAV, M4A, …)"),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> RecognizeResponse:
    """Identify a track from a short audio clip using acoustic fingerprinting."""
    audio_bytes = await file.read()
    return await recognize_service.recognize(db, audio_bytes)
