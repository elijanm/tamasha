from __future__ import annotations

import os

import structlog

logger = structlog.get_logger(__name__)


def extract_audio_metadata(path: str) -> dict:
    """Extract metadata from an audio file using mutagen.

    Returns a dict with keys: title, artist, album, year, genre,
    duration_seconds, bitrate_kbps, sample_rate, channels.
    All values may be None if not available.
    """
    result: dict = {
        "title": None,
        "artist": None,
        "album": None,
        "year": None,
        "genre": None,
        "duration_seconds": None,
        "bitrate_kbps": None,
        "sample_rate": None,
        "channels": None,
        "codec": None,
    }

    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(path, easy=True)
        if audio is None:
            return result

        # Duration and stream info
        if hasattr(audio, "info"):
            info = audio.info
            result["duration_seconds"] = round(getattr(info, "length", 0) or 0, 2)
            result["bitrate_kbps"] = round((getattr(info, "bitrate", 0) or 0) / 1000, 1)
            result["sample_rate"] = getattr(info, "sample_rate", None)
            result["channels"] = getattr(info, "channels", None)

        # Tag fields via easy interface
        def _first(key: str) -> str | None:
            vals = audio.get(key)
            return str(vals[0]).strip() if vals else None

        result["title"] = _first("title")
        result["artist"] = _first("artist")
        result["album"] = _first("album")
        result["genre"] = _first("genre")

        raw_year = _first("date") or _first("year")
        if raw_year:
            try:
                result["year"] = int(str(raw_year)[:4])
            except ValueError:
                pass

        # Codec from file extension
        ext = os.path.splitext(path)[1].lower()
        codec_map = {
            ".mp3": "mp3", ".flac": "flac", ".wav": "wav",
            ".m4a": "aac", ".aac": "aac", ".ogg": "vorbis",
            ".opus": "opus", ".wma": "wma", ".aiff": "aiff",
        }
        result["codec"] = codec_map.get(ext)

    except Exception as exc:
        logger.warning("metadata_extraction_failed", path=path, error=str(exc))

    return result
