from __future__ import annotations

import structlog
from celery import Celery
from celery.schedules import crontab

from worker.config import get_settings

structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ]
)

settings = get_settings()

app = Celery(
    "tamasha",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "worker.tasks.transcoding",
        "worker.tasks.dedup",
        "worker.tasks.email",
        "worker.tasks.sync",
        "worker.tasks.metadata",
        "worker.tasks.analytics",
        "worker.tasks.backup",
        "worker.tasks.billing",
    ],
)

app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,           # re-queue on worker crash
    worker_prefetch_multiplier=1,  # one task at a time per worker thread (safe for heavy FFmpeg)
    task_routes={
        "worker.tasks.transcoding.*": {"queue": "transcoding"},
        "worker.tasks.sync.*": {"queue": "sync"},
        "worker.tasks.email.*": {"queue": "email"},
        "worker.tasks.backup.*": {"queue": "backup"},
        "worker.tasks.dedup.*": {"queue": "default"},
        "worker.tasks.analytics.*": {"queue": "analytics"},
        "worker.tasks.metadata.*": {"queue": "default"},
    },
    beat_schedule={
        "incremental-sync": {
            "task": "worker.tasks.sync.incremental_sync",
            "schedule": 900,  # 15 minutes
            "kwargs": {"job_id": "cron"},
        },
        "hourly-reconciliation": {
            "task": "worker.tasks.sync.metadata_reconciliation",
            "schedule": 3600,
            "kwargs": {"job_id": "cron"},
        },
        "nightly-full-sync": {
            "task": "worker.tasks.sync.full_scan",
            "schedule": crontab(hour=2, minute=0),
            "kwargs": {"job_id": "cron"},
        },
        "weekly-integrity": {
            "task": "worker.tasks.sync.integrity_scan",
            "schedule": crontab(day_of_week=0, hour=3),
            "kwargs": {"job_id": "cron"},
        },
        "daily-platform-rollup": {
            "task": "worker.tasks.analytics.daily_platform_rollup",
            "schedule": crontab(hour=1, minute=0),   # 01:00 UTC daily
        },
        "daily-artist-rollup": {
            "task": "worker.tasks.analytics.rollup_all_artists",
            "schedule": crontab(hour=1, minute=30),  # after platform rollup
        },
        "nightly-backup": {
            "task": "worker.tasks.backup.full_backup",
            "schedule": crontab(hour=3, minute=0),   # 03:00 UTC daily
        },
        "weekly-backup-verify": {
            "task": "worker.tasks.backup.verify_backup_coverage",
            "schedule": crontab(day_of_week=1, hour=4),  # Monday 04:00 UTC
            "kwargs": {"destination": "b2"},
        },
        # ── Billing ──────────────────────────────────────────────────────────
        "monthly-invoice-generation": {
            "task": "worker.tasks.billing.generate_monthly_invoice",
            "schedule": crontab(day_of_month=1, hour=0, minute=0),  # 1st of each month
        },
        "daily-billing-escalation": {
            "task": "worker.tasks.billing.escalate_invoices",
            "schedule": crontab(hour=6, minute=0),   # 06:00 UTC daily
        },
        "daily-billing-reminders": {
            "task": "worker.tasks.billing.send_billing_reminders",
            "schedule": crontab(hour=8, minute=0),   # 08:00 UTC daily
        },
    },
)
