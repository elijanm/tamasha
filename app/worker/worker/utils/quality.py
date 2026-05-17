from __future__ import annotations

import os

_FORMAT_SCORES: dict[str, int] = {
    ".flac": 30, ".wav": 30, ".aiff": 28,
    ".m4a": 22, ".aac": 22,
    ".mp3": 0,
    ".ogg": 16, ".opus": 18, ".wma": 10,
}


def score_track(doc: dict) -> tuple[int, dict]:
    """Compute a 0–100 quality score for a track document.

    Returns (total_score, breakdown_dict).
    """
    ext = os.path.splitext(doc.get("r2_key_raw", ""))[1].lower()
    size = doc.get("file_size_bytes", 0) or 0
    duration = doc.get("duration_seconds") or 0

    # Format score (30 pts max)
    fmt = _FORMAT_SCORES.get(ext, 5)
    if ext == ".mp3" and duration > 0:
        kbps = (size * 8) / duration / 1000
        fmt = 22 if kbps >= 300 else 18 if kbps >= 240 else 14 if kbps >= 180 else 8

    # Bitrate score (25 pts max)
    bitrate_score = 0
    if duration > 0 and size > 0:
        kbps = (size * 8) / duration / 1000
        bitrate_score = min(25, int((min(kbps, 320) / 320) * 25))

    # Duration score (20 pts max — > 5 min = full marks)
    dur_score = min(20, int((min(duration, 300) / 300) * 20)) if duration > 0 else 0

    # Metadata completeness (15 pts max)
    md = 0
    if doc.get("title"):          md += 2
    if doc.get("artist_id"):      md += 3
    if doc.get("album"):          md += 2
    if doc.get("year"):           md += 1
    if doc.get("genre"):          md += 1
    if doc.get("isrc"):           md += 2
    if doc.get("artwork_r2_key"): md += 2
    if doc.get("composer") or doc.get("producer"): md += 1
    md = min(15, md)

    # Size score (10 pts max — tiebreaker)
    mb = size / (1024 * 1024)
    size_score = min(10, int(mb / 10))

    total = fmt + bitrate_score + dur_score + md + size_score
    return total, {
        "format_score": fmt,
        "bitrate_score": bitrate_score,
        "duration_score": dur_score,
        "metadata_score": md,
        "size_score": size_score,
        "total": total,
    }
