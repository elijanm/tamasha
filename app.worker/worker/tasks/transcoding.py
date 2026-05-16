from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone

import structlog
from bson import ObjectId
from celery import Task

from worker.celery_app import app
from worker.db.mongo import get_db
from worker.storage.r2 import download_to_file, upload_file, upload_bytes
from worker.utils.ffmpeg import (
    generate_waveform_peaks,
    get_duration,
    transcode_to_hls,
    transcode_to_mp3,
)
from worker.utils.hashing import md5_file, sha256_file
from worker.utils.metadata import extract_audio_metadata
from worker.utils.path_parser import (
    ParsedMetadata,
    merge_with_embedded,
    merge_with_existing_db,
    parse_r2_key,
    compute_workflow_tags,
    should_queue_human_review,
)

logger = structlog.get_logger(__name__)

_BITRATES = ["64k", "128k", "320k"]


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _update_track(track_id: str, update: dict) -> None:
    update["updated_at"] = _utc_now()
    get_db()["tracks"].update_one({"_id": ObjectId(track_id)}, {"$set": update})


def _build_metadata_update(
    parsed: ParsedMetadata,
    existing_doc: dict,
    duration: float | None,
    sha: str,
    md5: str,
    r2_keys_transcoded: dict,
) -> dict:
    """Build the MongoDB $set payload, respecting the priority chain.

    Fields already set by staff (non-null in DB with metadata_version > 1)
    are never overwritten.
    """
    meta_version = existing_doc.get("metadata_version", 1)
    staff_edited = meta_version > 1

    update: dict = {
        "sha256": sha,
        "md5": md5,
        "r2_keys_transcoded": r2_keys_transcoded,
        "status": "ready",
        "inferred_metadata": parsed.to_dict(),
    }

    if duration:
        update["duration_seconds"] = round(duration, 2)

    # Only fill empty fields — never overwrite verified staff edits
    def _fill(field: str, cv):
        if cv is None:
            return
        current = existing_doc.get(field)
        if current and staff_edited:
            return   # staff has set this; leave it
        if not current:
            update[field] = cv.value

    _fill("title", parsed.title)
    _fill("album", parsed.album)
    _fill("genre", parsed.genre)
    _fill("language", parsed.language)

    if parsed.year and not (existing_doc.get("year") and staff_edited):
        year_val = parsed.year.value
        if year_val and not existing_doc.get("year"):
            update["year"] = year_val

    # Workflow tags (additive — never remove existing ones)
    new_tags = compute_workflow_tags(parsed)
    if new_tags:
        existing_tags = existing_doc.get("workflow_tags") or []
        merged_tags = list(dict.fromkeys(existing_tags + new_tags))
        update["workflow_tags"] = merged_tags

    # Provenance: capture confidence scores as separate doc field
    update["metadata_confidence"] = {
        k: getattr(parsed, k).as_dict()
        for k in ("artist", "title", "album", "year", "genre", "language", "region")
        if getattr(parsed, k) is not None
    }

    # Human review flag
    needs_review, reasons = should_queue_human_review(parsed)
    if needs_review:
        update["needs_human_review"] = True
        update["review_reasons"] = reasons

    return update


@app.task(
    name="worker.tasks.transcoding.transcode_track",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def transcode_track(self: Task, track_id: str, r2_key_raw: str) -> dict:
    """Download raw audio, extract/infer metadata, transcode to MP3 variants + HLS, upload to R2."""
    log = logger.bind(task_id=self.request.id, track_id=track_id, r2_key_raw=r2_key_raw)
    log.info("transcode_start")

    _update_track(track_id, {"status": "processing"})

    with tempfile.TemporaryDirectory(prefix="tamasha_tc_") as tmp:
        # ── 1. Download raw file ──────────────────────────────────────────────
        ext = os.path.splitext(r2_key_raw)[1] or ".audio"
        raw_path = os.path.join(tmp, f"raw{ext}")
        download_to_file(r2_key_raw, raw_path)
        log.info("download_complete", size=os.path.getsize(raw_path))

        # ── 2. Hashes ─────────────────────────────────────────────────────────
        sha = sha256_file(raw_path)
        md5 = md5_file(raw_path)

        # ── 3. Metadata priority chain ────────────────────────────────────────
        # Layer 1: folder/filename parsing from R2 key
        parsed = parse_r2_key(r2_key_raw)

        # Layer 2: embedded audio tags (override folder inference)
        embedded = extract_audio_metadata(raw_path)
        parsed = merge_with_embedded(parsed, embedded)

        # Layer 3: existing MongoDB (overrides everything if staff-verified)
        db = get_db()
        existing = db["tracks"].find_one(
            {"_id": ObjectId(track_id)},
            {"title": 1, "album": 1, "year": 1, "genre": 1, "language": 1,
             "metadata_version": 1, "workflow_tags": 1},
        ) or {}
        parsed = merge_with_existing_db(parsed, existing)

        # Duration
        duration = embedded.get("duration_seconds") or get_duration(raw_path)

        # ── 4. Transcode to MP3 variants ─────────────────────────────────────
        r2_keys_transcoded: dict[str, str] = {}
        for bitrate in _BITRATES:
            out_name = f"mp3_{bitrate}.mp3"
            out_path = os.path.join(tmp, out_name)
            transcode_to_mp3(raw_path, out_path, bitrate)
            r2_key = f"music/transcoded/{track_id}/{out_name}"
            upload_file(out_path, r2_key, content_type="audio/mpeg")
            r2_keys_transcoded[f"mp3_{bitrate.replace('k', '')}k"] = r2_key
            log.info("mp3_uploaded", bitrate=bitrate, r2_key=r2_key)

        # ── 5. HLS 128k ───────────────────────────────────────────────────────
        hls_dir = os.path.join(tmp, "hls_128k")
        transcode_to_hls(raw_path, hls_dir, bitrate="128k")
        for fname in sorted(os.listdir(hls_dir)):
            fpath = os.path.join(hls_dir, fname)
            content_type = "application/vnd.apple.mpegurl" if fname.endswith(".m3u8") else "video/mp2t"
            upload_file(fpath, f"music/transcoded/{track_id}/hls_128k/{fname}", content_type=content_type)
        r2_keys_transcoded["hls_128k"] = f"music/transcoded/{track_id}/hls_128k/playlist.m3u8"
        log.info("hls_uploaded")

        # ── 6. Persist metadata update ────────────────────────────────────────
        track_update = _build_metadata_update(
            parsed, existing, duration, sha, md5, r2_keys_transcoded
        )
        _update_track(track_id, track_update)
        log.info("transcode_complete", r2_keys=list(r2_keys_transcoded.keys()),
                 needs_review=track_update.get("needs_human_review", False))

        return {
            "track_id": track_id,
            "sha256": sha,
            "duration_seconds": duration,
            "r2_keys_transcoded": r2_keys_transcoded,
            "needs_human_review": track_update.get("needs_human_review", False),
        }


@app.task(
    name="worker.tasks.transcoding.generate_waveform",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    retry_backoff=True,
)
def generate_waveform(self: Task, track_id: str, r2_key_raw: str) -> dict:
    """Generate waveform peak data and upload as JSON to R2."""
    log = logger.bind(task_id=self.request.id, track_id=track_id)
    log.info("waveform_start")

    with tempfile.TemporaryDirectory(prefix="tamasha_wf_") as tmp:
        ext = os.path.splitext(r2_key_raw)[1] or ".audio"
        raw_path = os.path.join(tmp, f"raw{ext}")
        download_to_file(r2_key_raw, raw_path)

        peaks = generate_waveform_peaks(raw_path, num_peaks=1000)
        waveform_data = json.dumps({"peaks": peaks, "length": len(peaks)}).encode()

        r2_key = f"music/waveforms/{track_id}.json"
        upload_bytes(waveform_data, r2_key, content_type="application/json")

        _update_track(track_id, {"waveform_r2_key": r2_key})
        log.info("waveform_complete", peaks_count=len(peaks), r2_key=r2_key)

        return {"track_id": track_id, "r2_key": r2_key, "peaks_count": len(peaks)}
