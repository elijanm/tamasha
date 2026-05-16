from __future__ import annotations

import calendar
from datetime import datetime, timedelta, timezone

import structlog
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.billing import (
    InvoiceDocument,
    PaymentArrangementDocument,
    PaymentRecordDocument,
    PlatformCostDocument,
)
from app.schemas.billing import (
    BillingGateStatus,
    InvoiceResponse,
    PaymentArrangementResponse,
    PaymentRecordResponse,
    PlatformCostResponse,
)

logger = structlog.get_logger(__name__)

GRACE_DAYS = 30       # days after due before deletion warning
WARNING_DAYS = 10     # days of warning before data becomes available
DOWNLOAD_DAYS = 90    # days the data export URL remains valid
DELETED_DAYS = GRACE_DAYS + WARNING_DAYS + DOWNLOAD_DAYS  # 130


# ── Helpers ────────────────────────────────────────────────────────────────────

def _utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


def _month_end(year: int, month: int) -> datetime:
    last_day = calendar.monthrange(year, month)[1]
    return datetime(year, month, last_day, 23, 59, 59, tzinfo=timezone.utc)


def _month_label(month: int, year: int) -> str:
    return datetime(year, month, 1).strftime("%B %Y")


def _doc_to_invoice(doc: dict) -> InvoiceDocument:
    return InvoiceDocument.model_validate(doc)


def _to_invoice_response(doc: dict) -> InvoiceResponse:
    inv = _doc_to_invoice(doc)
    now = _utc_now()
    due = inv.due_date
    if due.tzinfo is None:
        due = due.replace(tzinfo=timezone.utc)
    days_overdue = max(0, (now - due).days) if inv.status not in ("paid",) else 0
    return InvoiceResponse(
        id=str(doc["_id"]),
        period_month=inv.period_month,
        period_year=inv.period_year,
        period_label=_month_label(inv.period_month, inv.period_year),
        amount_usd=inv.amount_usd,
        paid_amount_usd=inv.paid_amount_usd,
        balance_usd=round(inv.amount_usd - inv.paid_amount_usd, 2),
        status=inv.status,
        due_date=due,
        paid_at=inv.paid_at,
        notes=inv.notes,
        data_export_r2_key=inv.data_export_r2_key,
        data_export_expires_at=inv.data_export_expires_at,
        days_overdue=days_overdue,
        created_at=inv.created_at,
        updated_at=inv.updated_at,
    )


# ── Platform cost config ───────────────────────────────────────────────────────

async def get_platform_cost(db: AsyncIOMotorDatabase) -> PlatformCostDocument | None:
    doc = await db["platform_cost"].find_one({"is_active": True})
    return PlatformCostDocument.model_validate(doc) if doc else None


async def upsert_platform_cost(
    db: AsyncIOMotorDatabase,
    monthly_amount_usd: float,
    description: str,
    reminder_days: list[int],
    created_by: str,
) -> PlatformCostDocument:
    now = _utc_now()
    await db["platform_cost"].update_many({"is_active": True}, {"$set": {"is_active": False}})
    doc = {
        "monthly_amount_usd": monthly_amount_usd,
        "description": description,
        "is_active": True,
        "reminder_days": sorted(reminder_days, reverse=True),
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    result = await db["platform_cost"].insert_one(doc)
    doc["_id"] = result.inserted_id
    return PlatformCostDocument.model_validate(doc)


# ── Invoice CRUD ───────────────────────────────────────────────────────────────

async def list_invoices(db: AsyncIOMotorDatabase, skip: int = 0, limit: int = 20) -> tuple[list[dict], int]:
    total = await db["invoices"].count_documents({})
    cursor = db["invoices"].find().sort("due_date", -1).skip(skip).limit(limit)
    docs = await cursor.to_list(length=limit)
    return docs, total


async def get_invoice(db: AsyncIOMotorDatabase, invoice_id: str) -> dict | None:
    return await db["invoices"].find_one({"_id": ObjectId(invoice_id)})


async def get_active_invoice(db: AsyncIOMotorDatabase) -> dict | None:
    """Return the most recent unpaid invoice (drives the gate)."""
    return await db["invoices"].find_one(
        {"status": {"$in": ["pending", "overdue", "suspended", "data_available", "partial"]}},
        sort=[("due_date", -1)],
    )


async def create_invoice(
    db: AsyncIOMotorDatabase,
    month: int,
    year: int,
    amount_usd: float,
    created_by: str,
    notes: str | None = None,
) -> dict:
    now = _utc_now()
    due_date = _month_end(year, month)
    doc = {
        "period_month": month,
        "period_year": year,
        "amount_usd": amount_usd,
        "paid_amount_usd": 0.0,
        "status": "pending",
        "due_date": due_date,
        "paid_at": None,
        "notes": notes,
        "data_export_r2_key": None,
        "data_export_expires_at": None,
        "reminders_sent": [],
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    result = await db["invoices"].insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


async def record_payment(
    db: AsyncIOMotorDatabase,
    invoice_id: str,
    amount_usd: float,
    recorded_by: str,
    notes: str | None = None,
    is_arrangement_installment: bool = False,
) -> dict:
    now = _utc_now()
    invoice = await get_invoice(db, invoice_id)
    if not invoice:
        raise ValueError("Invoice not found")

    new_paid = round(invoice["paid_amount_usd"] + amount_usd, 2)
    new_status = "paid" if new_paid >= invoice["amount_usd"] else invoice["status"]
    if new_status == "paid" and invoice["status"] not in ("paid",):
        paid_at = now
    else:
        paid_at = invoice.get("paid_at")

    payment_doc = {
        "invoice_id": invoice_id,
        "amount_usd": amount_usd,
        "recorded_by": recorded_by,
        "notes": notes,
        "is_arrangement_installment": is_arrangement_installment,
        "recorded_at": now,
    }
    await db["payment_records"].insert_one(payment_doc)

    await db["invoices"].update_one(
        {"_id": ObjectId(invoice_id)},
        {"$set": {
            "paid_amount_usd": new_paid,
            "status": new_status,
            "paid_at": paid_at,
            "updated_at": now,
        }},
    )
    return await get_invoice(db, invoice_id)


async def create_arrangement(
    db: AsyncIOMotorDatabase,
    invoice_id: str,
    installments: int,
    created_by: str,
) -> dict:
    now = _utc_now()
    invoice = await get_invoice(db, invoice_id)
    if not invoice:
        raise ValueError("Invoice not found")

    balance = invoice["amount_usd"] - invoice["paid_amount_usd"]
    cost_cfg = await get_platform_cost(db)
    next_month_cost = cost_cfg.monthly_amount_usd if cost_cfg else 0.0
    total = round(balance + next_month_cost, 2)

    # Split evenly across installments, remainder added to last
    base = round(total / installments, 2)
    amounts = [base] * (installments - 1) + [round(total - base * (installments - 1), 2)]

    # Due dates: spread across following month
    invoice_month = invoice["period_month"]
    invoice_year = invoice["period_year"]
    next_month = invoice_month % 12 + 1
    next_year = invoice_year + (1 if next_month == 1 else 0)
    last_day = calendar.monthrange(next_year, next_month)[1]
    interval = last_day // installments
    due_dates = [
        datetime(next_year, next_month, min((i + 1) * interval, last_day), 23, 59, 59, tzinfo=timezone.utc)
        for i in range(installments)
    ]

    arr_doc = {
        "invoice_id": invoice_id,
        "installments": installments,
        "amounts_usd": amounts,
        "due_dates": due_dates,
        "total_usd": total,
        "status": "active",
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    await db["payment_arrangements"].insert_one(arr_doc)

    await db["invoices"].update_one(
        {"_id": ObjectId(invoice_id)},
        {"$set": {"status": "partial", "updated_at": now}},
    )
    return arr_doc


# ── Status escalation (called by daily Celery task) ───────────────────────────

async def escalate_invoice_statuses(db: AsyncIOMotorDatabase) -> int:
    """Advance invoice statuses based on days since due date. Returns number updated."""
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
            continue  # not yet due

        days_late = (now - due).days
        current = doc["status"]
        new_status = current

        if days_late >= GRACE_DAYS + WARNING_DAYS:  # 40+
            new_status = "data_available"
        elif days_late >= GRACE_DAYS:               # 30+
            new_status = "suspended"
        elif current == "pending":
            new_status = "overdue"

        if new_status != current:
            update: dict = {"status": new_status, "updated_at": now}
            if new_status == "data_available" and not doc.get("data_export_r2_key"):
                # Trigger data export task via Celery
                from app.tasks.billing import dispatch_generate_data_export
                dispatch_generate_data_export(str(doc["_id"]))
            await db["invoices"].update_one(
                {"_id": doc["_id"]}, {"$set": update}
            )
            updated += 1

        # Check for account deletion (130+ days)
        if days_late >= DELETED_DAYS and doc["status"] != "deleted":
            await db["invoices"].update_one(
                {"_id": doc["_id"]}, {"$set": {"status": "deleted", "updated_at": now}}
            )
            updated += 1

    return updated


# ── Billing gate ───────────────────────────────────────────────────────────────

async def get_gate_status(
    db: AsyncIOMotorDatabase,
    data_export_url: str | None = None,
) -> BillingGateStatus:
    invoice_doc = await get_active_invoice(db)
    if not invoice_doc:
        return BillingGateStatus(is_gated=False, phase="none", gate_message="")

    inv = _to_invoice_response(invoice_doc)
    now = _utc_now()
    days_late = inv.days_overdue

    # Not yet past due
    if inv.status in ("pending", "partial") and days_late == 0:
        return BillingGateStatus(is_gated=False, phase="none", gate_message="", current_invoice=inv)

    if inv.status == "deleted":
        return BillingGateStatus(
            is_gated=True, phase="deleted",
            gate_message="Services have been terminated due to non-payment.",
            current_invoice=inv,
        )

    if inv.status == "data_available":
        exp = inv.data_export_expires_at
        download_remaining = None
        if exp:
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            download_remaining = max(0, (exp - now).days)
        return BillingGateStatus(
            is_gated=True, phase="data_available",
            gate_message="Services are suspended. Your data is available for download.",
            current_invoice=inv,
            download_days_remaining=download_remaining,
            data_export_url=data_export_url,
        )

    if inv.status == "suspended":
        days_until_deletion = max(0, GRACE_DAYS + WARNING_DAYS - days_late)
        return BillingGateStatus(
            is_gated=True, phase="warning",
            gate_message=f"Services are suspended. Data will be deleted in {days_until_deletion} day(s) if payment is not received.",
            current_invoice=inv,
            deletion_days_remaining=days_until_deletion,
        )

    # overdue / partial — grace period
    grace_remaining = max(0, GRACE_DAYS - days_late)
    return BillingGateStatus(
        is_gated=True, phase="grace",
        gate_message=f"Invoice overdue. Services suspended. {grace_remaining} day(s) remaining in grace period.",
        current_invoice=inv,
        grace_days_remaining=grace_remaining,
    )
