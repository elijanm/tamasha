from __future__ import annotations

import calendar
import io
import json
import zipfile
from datetime import datetime, timedelta, timezone

import structlog
from celery import Task

from worker.celery_app import app
from worker.db.mongo import get_db
from worker.storage.r2 import upload_bytes

logger = structlog.get_logger(__name__)

GRACE_DAYS = 30
WARNING_DAYS = 10
DOWNLOAD_DAYS = 90
DELETED_DAYS = GRACE_DAYS + WARNING_DAYS + DOWNLOAD_DAYS


def _utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _month_end(year: int, month: int) -> datetime:
    last_day = calendar.monthrange(year, month)[1]
    return datetime(year, month, last_day, 23, 59, 59, tzinfo=timezone.utc)


# ── Monthly invoice auto-generation ──────────────────────────────────────────

@app.task(
    name="worker.tasks.billing.generate_monthly_invoice",
    bind=True, max_retries=3, default_retry_delay=300,
)
def generate_monthly_invoice(self: Task) -> dict:
    """Auto-create invoice for the current month if one doesn't already exist."""
    log = logger.bind(task_id=self.request.id)
    import asyncio
    return asyncio.get_event_loop().run_until_complete(_async_generate_invoice(log))


async def _async_generate_invoice(log) -> dict:
    db = get_db()
    now = _utc_now()
    month, year = now.month, now.year

    existing = await db["invoices"].find_one({"period_month": month, "period_year": year})
    if existing:
        log.info("monthly_invoice_exists", month=month, year=year)
        return {"skipped": True, "month": month, "year": year}

    cfg = await db["platform_cost"].find_one({"is_active": True})
    if not cfg:
        log.warning("no_platform_cost_configured")
        return {"skipped": True, "reason": "no_config"}

    due_date = _month_end(year, month)
    doc = {
        "period_month": month,
        "period_year": year,
        "amount_usd": cfg["monthly_amount_usd"],
        "paid_amount_usd": 0.0,
        "status": "pending",
        "due_date": due_date,
        "paid_at": None,
        "notes": cfg.get("description"),
        "data_export_r2_key": None,
        "data_export_expires_at": None,
        "reminders_sent": [],
        "created_by": "system",
        "created_at": now,
        "updated_at": now,
    }
    result = await db["invoices"].insert_one(doc)
    log.info("monthly_invoice_created", invoice_id=str(result.inserted_id), amount=cfg["monthly_amount_usd"])
    return {"invoice_id": str(result.inserted_id), "month": month, "year": year}


# ── Daily escalation ──────────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.billing.escalate_invoices",
    bind=True, max_retries=3, default_retry_delay=300,
)
def escalate_invoices(self: Task) -> dict:
    """Advance invoice statuses based on days past due."""
    import asyncio
    return asyncio.get_event_loop().run_until_complete(_async_escalate(logger.bind(task_id=self.request.id)))


async def _async_escalate(log) -> dict:
    db = get_db()
    now = _utc_now()
    updated = 0

    cursor = db["invoices"].find(
        {"status": {"$in": ["pending", "overdue", "suspended", "partial"]}}
    )
    async for doc in cursor:
        due = doc["due_date"]
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        if now <= due:
            continue

        days_late = (now - due).days
        current = doc["status"]
        new_status = current

        if days_late >= DELETED_DAYS:
            new_status = "deleted"
        elif days_late >= GRACE_DAYS + WARNING_DAYS:
            new_status = "data_available"
        elif days_late >= GRACE_DAYS:
            new_status = "suspended"
        elif current == "pending":
            new_status = "overdue"

        if new_status != current:
            await db["invoices"].update_one(
                {"_id": doc["_id"]},
                {"$set": {"status": new_status, "updated_at": now}},
            )
            updated += 1
            log.info("invoice_escalated", invoice_id=str(doc["_id"]),
                     from_status=current, to_status=new_status, days_late=days_late)

            if new_status == "data_available" and not doc.get("data_export_r2_key"):
                generate_data_export.delay(invoice_id=str(doc["_id"]))

    return {"updated": updated}


# ── Payment reminders ─────────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.billing.send_billing_reminders",
    bind=True, max_retries=3, default_retry_delay=300,
)
def send_billing_reminders(self: Task) -> dict:
    """Send reminder emails before invoice due date and for overdue invoices."""
    import asyncio
    return asyncio.get_event_loop().run_until_complete(
        _async_send_reminders(logger.bind(task_id=self.request.id))
    )


async def _async_send_reminders(log) -> dict:
    db = get_db()
    now = _utc_now()
    sent = 0

    # Pre-due reminders for pending invoices
    cursor = db["invoices"].find({"status": {"$in": ["pending", "partial"]}})
    cfg = await db["platform_cost"].find_one({"is_active": True})
    reminder_days: list[int] = cfg.get("reminder_days", [14, 7, 1]) if cfg else [14, 7, 1]

    async for doc in cursor:
        due = doc["due_date"]
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        days_until_due = (due - now).days
        already_sent: list[int] = doc.get("reminders_sent", [])

        for threshold in reminder_days:
            if days_until_due <= threshold and threshold not in already_sent:
                await _send_superadmin_email(db, "billing_reminder", {
                    "days_until_due": days_until_due,
                    "amount_usd": doc["amount_usd"],
                    "period_label": _month_label(doc["period_month"], doc["period_year"]),
                })
                await db["invoices"].update_one(
                    {"_id": doc["_id"]},
                    {"$addToSet": {"reminders_sent": threshold}, "$set": {"updated_at": now}},
                )
                sent += 1
                log.info("billing_reminder_sent", days_until_due=days_until_due)

    return {"sent": sent}


def _month_label(month: int, year: int) -> str:
    return datetime(year, month, 1).strftime("%B %Y")


async def _send_superadmin_email(db, email_type: str, context: dict) -> None:
    """Dispatch a billing email to all superadmin users."""
    cursor = db["users"].find({"role": "superadmin", "is_active": True})
    async for user in cursor:
        logger.info("billing_email_dispatch", email_type=email_type,
                    email=user["email"], context=context)
        # Celery email task — same pattern as other email dispatches
        app.send_task(
            "worker.tasks.email.send_billing_notification",
            kwargs={
                "email": user["email"],
                "email_type": email_type,
                "context": context,
            },
            queue="email",
        )


# ── Data export ───────────────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.billing.generate_data_export",
    bind=True, max_retries=2, default_retry_delay=600,
)
def generate_data_export(self: Task, invoice_id: str) -> dict:
    """Archive all platform data to R2 and store the key on the invoice."""
    import asyncio
    return asyncio.get_event_loop().run_until_complete(
        _async_generate_export(logger.bind(task_id=self.request.id), invoice_id)
    )


async def _async_generate_export(log, invoice_id: str) -> dict:
    from bson import ObjectId
    db = get_db()
    now = _utc_now()

    log.info("data_export_start", invoice_id=invoice_id)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        # Tracks metadata
        tracks = await db["tracks"].find({}, {"_id": 1, "title": 1, "artist_name": 1,
            "album": 1, "genre": 1, "language": 1, "duration_seconds": 1,
            "r2_key_raw": 1, "status": 1, "created_at": 1}).to_list(length=100_000)
        for t in tracks:
            t["_id"] = str(t["_id"])
            if "created_at" in t and hasattr(t["created_at"], "isoformat"):
                t["created_at"] = t["created_at"].isoformat()
        zf.writestr("tracks.json", json.dumps(tracks, default=str, indent=2))

        # Artists
        artists = await db["artists"].find({}, {"_id": 1, "display_name": 1, "slug": 1,
            "country": 1, "genres": 1, "status": 1}).to_list(length=10_000)
        for a in artists:
            a["_id"] = str(a["_id"])
        zf.writestr("artists.json", json.dumps(artists, default=str, indent=2))

        # Users (no hashed passwords)
        users = await db["users"].find({}, {"hashed_password": 0, "refresh_token_hash": 0}).to_list(length=10_000)
        for u in users:
            u["_id"] = str(u["_id"])
        zf.writestr("users.json", json.dumps(users, default=str, indent=2))

        # Invoices
        invoices = await db["invoices"].find({}).to_list(length=1_000)
        for i in invoices:
            i["_id"] = str(i["_id"])
        zf.writestr("billing/invoices.json", json.dumps(invoices, default=str, indent=2))

        # README
        readme = f"""Tamasha Platform Data Export
Generated: {now.isoformat()}
Invoice: {invoice_id}

Contents:
- tracks.json       All track metadata (audio files remain in Cloudflare R2)
- artists.json      All artist profiles
- users.json        All user accounts
- billing/          Billing and invoice records

Audio files are stored in Cloudflare R2. Contact support to arrange bulk download.
Download link valid for {DOWNLOAD_DAYS} days from generation date.
"""
        zf.writestr("README.txt", readme)

    buf.seek(0)
    r2_key = f"billing/exports/{now.year}-{now.month:02d}/tamasha_export_{invoice_id}_{now.strftime('%Y%m%d_%H%M%S')}.zip"
    upload_bytes(buf.read(), r2_key, content_type="application/zip")

    expires_at = now + timedelta(days=DOWNLOAD_DAYS)
    await db["invoices"].update_one(
        {"_id": ObjectId(invoice_id)},
        {"$set": {
            "data_export_r2_key": r2_key,
            "data_export_expires_at": expires_at,
            "updated_at": now,
        }},
    )

    # Notify superadmin
    await _send_superadmin_email(db, "data_export_ready", {
        "expires_at": expires_at.isoformat(),
        "download_days": DOWNLOAD_DAYS,
    })

    log.info("data_export_complete", r2_key=r2_key, expires_at=expires_at.isoformat())
    return {"r2_key": r2_key, "expires_at": expires_at.isoformat()}
