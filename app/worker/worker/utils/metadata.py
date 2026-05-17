from __future__ import annotations

import os

import structlog

logger = structlog.get_logger(__name__)

_MIME_TO_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def extract_artwork(path: str) -> tuple[bytes | None, str, str]:
    """Return (image_bytes, mime_type, extension) for the first embedded cover art.

    Returns (None, '', '') when no artwork is found or extraction fails.
    Handles MP3/ID3 (APIC), FLAC (Picture), MP4/M4A (covr), Ogg Vorbis (metadata_block_picture).
    """
    try:
        from mutagen import File as MutagenFile
        audio = MutagenFile(path)
        if audio is None:
            return None, "", ""

        tags = audio.tags

        # ── ID3 (MP3, AIFF, WAV) — APIC frame ───────────────────────────────
        if tags is not None:
            for key in list(tags.keys()):
                if str(key).startswith("APIC"):
                    apic = tags[key]
                    mime = getattr(apic, "mime", "image/jpeg") or "image/jpeg"
                    ext = _MIME_TO_EXT.get(mime.lower(), ".jpg")
                    return apic.data, mime, ext

        # ── FLAC — Picture block ─────────────────────────────────────────────
        if hasattr(audio, "pictures") and audio.pictures:
            pic = audio.pictures[0]
            mime = getattr(pic, "mime", "image/jpeg") or "image/jpeg"
            ext = _MIME_TO_EXT.get(mime.lower(), ".jpg")
            return pic.data, mime, ext

        # ── MP4 / M4A — covr atom ────────────────────────────────────────────
        if tags is not None and "covr" in tags:
            cover_list = tags["covr"]
            if cover_list:
                img = cover_list[0]
                try:
                    from mutagen.mp4 import MP4Cover
                    if getattr(img, "imageformat", None) == MP4Cover.FORMAT_PNG:
                        mime, ext = "image/png", ".png"
                    else:
                        mime, ext = "image/jpeg", ".jpg"
                except ImportError:
                    mime, ext = "image/jpeg", ".jpg"
                return bytes(img), mime, ext

        # ── Ogg Vorbis — metadata_block_picture ─────────────────────────────
        if tags is not None:
            mbp = None
            if hasattr(tags, "get"):
                mbp = tags.get("metadata_block_picture")
            elif hasattr(tags, "__getitem__"):
                try:
                    mbp = tags["metadata_block_picture"]
                except (KeyError, TypeError):
                    pass
            if mbp:
                import base64
                from mutagen.flac import Picture
                pic = Picture(base64.b64decode(mbp[0]))
                mime = getattr(pic, "mime", "image/jpeg") or "image/jpeg"
                ext = _MIME_TO_EXT.get(mime.lower(), ".jpg")
                return pic.data, mime, ext

    except Exception as exc:
        logger.warning("artwork_extraction_failed", path=path, error=str(exc))

    return None, "", ""


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
