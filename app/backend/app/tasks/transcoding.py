from __future__ import annotations

from app.core.celery_app import celery_app


def dispatch_transcode_task(track_id: str, r2_key_raw: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.transcoding.transcode_track",
        kwargs={"track_id": track_id, "r2_key_raw": r2_key_raw},
        queue="transcoding",
    )
    return result.id


def dispatch_waveform_task(track_id: str, r2_key_raw: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.transcoding.generate_waveform",
        kwargs={"track_id": track_id, "r2_key_raw": r2_key_raw},
        queue="transcoding",
    )
    return result.id
