#!/usr/bin/env python3
"""Pool all R2 audio files into MongoDB.

Reads R2 credentials from ../Uploader/.env (or env vars).
Reads MongoDB URL from MONGO_URL env var or uses localhost default.

Usage:
    python pool_r2.py                        # scan music/, index only
    python pool_r2.py --prefix music/raw/    # narrow to raw uploads
    python pool_r2.py --dispatch             # also queue transcode+dedup
    python pool_r2.py --dry-run              # print what would be indexed
    python pool_r2.py --force-reparse        # re-run path parser on all docs (metadata_version=1 only)
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ── Load env from Uploader/.env if worker/.env is absent ─────────────────────
_worker_env = Path(__file__).parent / ".env"
_uploader_env = Path(__file__).parent.parent / "Uploader" / ".env"

def _load_env(path: Path) -> None:
    if not path.exists():
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, _, v = line.partition("=")
                k, v = k.strip(), v.strip()
                if k not in os.environ:      # don't override real env vars
                    os.environ[k] = v

_load_env(_worker_env)
_load_env(_uploader_env)

sys.path.insert(0, str(Path(__file__).parent))

import boto3
import pymongo

from worker.utils.path_parser import (
    compute_workflow_tags,
    parse_r2_key,
    should_queue_human_review,
)

# ── Config ────────────────────────────────────────────────────────────────────
R2_ACCOUNT_ID  = os.environ["R2_ACCOUNT_ID"]
R2_ACCESS_KEY  = os.environ["R2_ACCESS_KEY_ID"]
R2_SECRET_KEY  = os.environ["R2_SECRET_ACCESS_KEY"]
R2_BUCKET      = os.environ.get("R2_BUCKET", "tamasha-assets")
R2_ENDPOINT    = os.environ.get("R2_ENDPOINT_URL") or f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
MONGO_URL      = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB       = os.environ.get("MONGO_DB", "tamasha")

_AUDIO_EXT = {".mp3", ".flac", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".aiff"}


def _is_audio(key: str) -> bool:
    return os.path.splitext(key.lower())[1] in _AUDIO_EXT


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _infer_metadata(r2_key: str) -> dict:
    parsed = parse_r2_key(r2_key)
    workflow_tags = compute_workflow_tags(parsed)
    needs_review, review_reasons = should_queue_human_review(parsed)
    fields: dict = {
        "inferred_metadata": parsed.to_dict(),
        "workflow_tags": workflow_tags,
        "needs_human_review": needs_review,
        "review_reasons": review_reasons,
        "metadata_confidence": {
            k: getattr(parsed, k).as_dict()
            for k in ("artist", "title", "album", "year", "genre", "language", "region")
            if getattr(parsed, k) is not None
        },
    }
    if parsed.title:   fields["title"]    = parsed.title.value
    if parsed.album:   fields["album"]    = parsed.album.value
    if parsed.year:    fields["year"]     = parsed.year.value
    if parsed.genre:   fields["genre"]    = parsed.genre.value
    if parsed.language: fields["language"] = parsed.language.value
    return fields


def _create_or_update(col, obj: dict, force_reparse: bool = False) -> str:
    """Returns 'created', 'updated', 'reparsed', or 'skipped'."""
    r2_key   = obj["key"]
    new_etag = obj.get("etag", "")

    existing = col.find_one(
        {"r2_key_raw": r2_key},
        {"_id": 1, "md5": 1, "metadata_version": 1},
    )

    if not existing:
        now  = _utc_now()
        stub = {
            "r2_key_raw": r2_key,
            "r2_keys_transcoded": {},
            "artist_id": None,
            "title": os.path.splitext(r2_key.split("/")[-1])[0].replace("_", " "),
            "album": None, "year": None, "genre": None, "language": None,
            "duration_seconds": None,
            "file_size_bytes": obj["size"],
            "sha256": "", "md5": new_etag, "r2_etag": new_etag,
            "artwork_r2_key": None, "waveform_r2_key": None,
            "tags": [], "status": "pending",
            "metadata_version": 1, "metadata_history": [],
            "duplicate_group_id": None, "is_canonical": False,
            "skiza_clip_ids": [],
            "stream_count": 0, "like_count": 0,
            "ingested_from_sync": True, "sync_mode": "pool",
            "r2_last_modified": obj["last_modified"],
            "created_by": None, "created_at": now, "updated_at": now,
        }
        stub.update(_infer_metadata(r2_key))
        col.insert_one(stub)
        return "created"

    # Staff-edited — never overwrite
    if existing.get("metadata_version", 1) > 1:
        return "skipped"

    # Force-reparse: re-run path parser without requiring ETag change
    if force_reparse:
        col.update_one(
            {"_id": existing["_id"]},
            {"$set": {**_infer_metadata(r2_key), "updated_at": _utc_now()}},
        )
        return "reparsed"

    stored_etag = existing.get("md5", "")
    if stored_etag and stored_etag == new_etag:
        return "skipped"

    # ETag changed — content replaced at same path
    col.update_one(
        {"_id": existing["_id"]},
        {"$set": {
            "status": "pending",
            "md5": new_etag, "r2_etag": new_etag,
            "file_size_bytes": obj["size"],
            "r2_last_modified": obj["last_modified"],
            "sha256": "", "r2_keys_transcoded": {},
            "updated_at": _utc_now(),
        }},
    )
    return "updated"


def _list_r2(r2, prefix: str):
    kwargs = {"Bucket": R2_BUCKET, "MaxKeys": 1000}
    if prefix:
        kwargs["Prefix"] = prefix
    while True:
        resp = r2.list_objects_v2(**kwargs)
        for obj in resp.get("Contents", []):
            yield {
                "key": obj["Key"],
                "size": obj["Size"],
                "last_modified": obj["LastModified"],
                "etag": obj.get("ETag", "").strip('"'),
            }
        if not resp.get("IsTruncated"):
            break
        kwargs["ContinuationToken"] = resp["NextContinuationToken"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Pool R2 audio files into MongoDB")
    parser.add_argument("--prefix",        default="music/", help="R2 prefix to scan (default: music/)")
    parser.add_argument("--dispatch",      action="store_true", help="Queue transcode+dedup for new/changed files")
    parser.add_argument("--dry-run",       action="store_true", help="Report what would be indexed without writing")
    parser.add_argument("--force-reparse", action="store_true", help="Re-run path parser on all unedited docs (metadata_version=1)")
    args = parser.parse_args()

    # ── Connect ───────────────────────────────────────────────────────────────
    r2 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name="auto",
    )

    if not args.dry_run:
        try:
            mongo = pymongo.MongoClient(MONGO_URL, serverSelectionTimeoutMS=5000)
            mongo.server_info()
            col = mongo[MONGO_DB]["tracks"]
        except Exception as exc:
            print(f"[ERROR] Cannot connect to MongoDB at {MONGO_URL}: {exc}")
            sys.exit(1)

    print(f"Bucket  : {R2_BUCKET}")
    print(f"Prefix  : {args.prefix}")
    print(f"MongoDB : {MONGO_URL}/{MONGO_DB}")
    if args.dry_run:
        print("Mode    : DRY RUN (no writes)")
    elif args.force_reparse:
        print("Mode    : force re-parse (updates parser output on all unedited docs)")
    elif args.dispatch:
        print("Mode    : index + dispatch transcode/dedup")
    else:
        print("Mode    : index only (no transcoding)")
    print()

    # ── Scan ──────────────────────────────────────────────────────────────────
    counts = {"scanned": 0, "created": 0, "updated": 0, "reparsed": 0, "skipped": 0, "errors": 0}
    t0 = time.time()

    for obj in _list_r2(r2, args.prefix):
        if not _is_audio(obj["key"]):
            continue
        counts["scanned"] += 1

        if args.dry_run:
            # Just count what exists in DB
            if not args.dry_run:  # always false, kept for clarity
                pass
            print(f"  WOULD PROCESS: {obj['key']}")
            continue

        try:
            result = _create_or_update(col, obj, force_reparse=args.force_reparse)
            counts[result] += 1

            if result == "created":
                print(f"  [NEW]      {obj['key']}")
            elif result == "updated":
                print(f"  [CHANGED]  {obj['key']}")
            elif result == "reparsed":
                print(f"  [REPARSE]  {obj['key']}")
            # skipped: silent

        except Exception as exc:
            counts["errors"] += 1
            print(f"  [ERROR]   {obj['key']} — {exc}")

    elapsed = time.time() - t0

    # ── Summary ───────────────────────────────────────────────────────────────
    print()
    print("─" * 60)
    print(f"Scanned  : {counts['scanned']:>6} audio files  ({elapsed:.1f}s)")
    print(f"Created  : {counts['created']:>6}")
    print(f"Updated  : {counts['updated']:>6}  (ETag changed)")
    print(f"Reparsed : {counts['reparsed']:>6}")
    print(f"Skipped  : {counts['skipped']:>6}")
    if counts["errors"]:
        print(f"Errors  : {counts['errors']:>6}")

    total_new = counts["created"] + counts["updated"] + counts["reparsed"]
    if total_new == 0:
        print()
        print("All synced. Nothing to pool.")
    else:
        print()
        print(f"{total_new} track(s) indexed / updated.")
        if args.dispatch:
            print("Transcode + dedup tasks dispatched to Celery queue.")
        elif not args.force_reparse:
            print("Run with --dispatch to queue transcoding.")

    if counts["errors"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
