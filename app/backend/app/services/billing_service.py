from __future__ import annotations

import calendar
from datetime import datetime, timedelta, timezone

import structlog
from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.models.billing import (
    CostLineItem,
    InvoiceDocument,
    PaymentArrangementDocument,
    PaymentRecordDocument,
    PlatformCostDocument,
)
from app.schemas.billing import (
    BillingGateStatus,
    CostLineItemResponse,
    InvoiceLineItemResponse,
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
    line_items = [
        InvoiceLineItemResponse(
            id=li.get("id", ""),
            description=li.get("description", ""),
            amount_usd=li.get("amount_usd", 0.0),
            type=li.get("type", "monthly"),
        )
        for li in (doc.get("line_items") or [])
    ]
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
        line_items=line_items,
        data_export_r2_key=inv.data_export_r2_key,
        data_export_expires_at=inv.data_export_expires_at,
        days_overdue=days_overdue,
        created_at=inv.created_at,
        updated_at=inv.updated_at,
    )


async def _snapshot_line_items(db: AsyncIOMotorDatabase) -> list[dict]:
    """Return active cost line items as plain dicts for invoice snapshot."""
    doc = await _get_cost_doc(db)
    if not doc:
        return []
    return [
        {
            "id": i["id"],
            "description": i["description"],
            "amount_usd": i["amount_usd"],
            "type": i["type"],
        }
        for i in doc.get("line_items", [])
        if i.get("is_active") and (
            i.get("type") == "monthly"
            or (i.get("type") == "one_time" and not i.get("used_in_invoice_id"))
        )
    ]


# ── Platform cost config ───────────────────────────────────────────────────────

async def _get_cost_doc(db: AsyncIOMotorDatabase) -> dict | None:
    return await db["platform_cost"].find_one({}, sort=[("created_at", -1)])


async def _ensure_cost_doc(db: AsyncIOMotorDatabase, created_by: str) -> dict:
    doc = await _get_cost_doc(db)
    if doc:
        return doc
    now = _utc_now()
    new_doc = {
        "line_items": [],
        "reminder_days": [14, 7, 1],
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    result = await db["platform_cost"].insert_one(new_doc)
    new_doc["_id"] = result.inserted_id
    return new_doc


async def get_platform_cost(db: AsyncIOMotorDatabase) -> PlatformCostDocument | None:
    doc = await _get_cost_doc(db)
    return PlatformCostDocument.model_validate(doc) if doc else None


def _cost_to_response(doc: dict) -> PlatformCostResponse:
    items = [CostLineItem.model_validate(i) for i in doc.get("line_items", [])]
    monthly_total = sum(i.amount_usd for i in items if i.type == "monthly" and i.is_active)
    one_time_total = sum(i.amount_usd for i in items if i.type == "one_time" and i.is_active and not i.used_in_invoice_id)
    return PlatformCostResponse(
        id=str(doc["_id"]),
        line_items=[
            CostLineItemResponse(
                id=i.id,
                description=i.description,
                amount_usd=i.amount_usd,
                type=i.type,
                is_active=i.is_active,
                used_in_invoice_id=i.used_in_invoice_id,
                created_at=i.created_at,
            )
            for i in items
        ],
        reminder_days=doc.get("reminder_days", [14, 7, 1]),
        monthly_total_usd=round(monthly_total, 2),
        one_time_total_usd=round(one_time_total, 2),
        created_at=doc["created_at"],
        updated_at=doc["updated_at"],
    )


async def add_line_item(
    db: AsyncIOMotorDatabase,
    description: str,
    amount_usd: float,
    item_type: str,
    created_by: str,
) -> PlatformCostResponse:
    import uuid
    now = _utc_now()
    doc = await _ensure_cost_doc(db, created_by)
    new_item = {
        "id": str(uuid.uuid4()),
        "description": description,
        "amount_usd": amount_usd,
        "type": item_type,
        "is_active": True,
        "used_in_invoice_id": None,
        "created_at": now,
    }
    await db["platform_cost"].update_one(
        {"_id": doc["_id"]},
        {"$push": {"line_items": new_item}, "$set": {"updated_at": now}},
    )
    updated = await _get_cost_doc(db)
    return _cost_to_response(updated)


async def update_line_item(
    db: AsyncIOMotorDatabase,
    item_id: str,
    description: str | None,
    amount_usd: float | None,
    is_active: bool | None,
) -> PlatformCostResponse:
    now = _utc_now()
    updates: dict = {"updated_at": now}
    if description is not None:
        updates["line_items.$[elem].description"] = description
    if amount_usd is not None:
        updates["line_items.$[elem].amount_usd"] = amount_usd
    if is_active is not None:
        updates["line_items.$[elem].is_active"] = is_active
    await db["platform_cost"].update_one(
        {},
        {"$set": updates},
        array_filters=[{"elem.id": item_id}],
    )
    doc = await _get_cost_doc(db)
    return _cost_to_response(doc)


async def remove_line_item(db: AsyncIOMotorDatabase, item_id: str) -> PlatformCostResponse:
    now = _utc_now()
    await db["platform_cost"].update_one(
        {},
        {"$pull": {"line_items": {"id": item_id}}, "$set": {"updated_at": now}},
    )
    doc = await _get_cost_doc(db)
    return _cost_to_response(doc)


async def set_reminder_days(db: AsyncIOMotorDatabase, reminder_days: list[int], created_by: str) -> PlatformCostResponse:
    now = _utc_now()
    doc = await _ensure_cost_doc(db, created_by)
    await db["platform_cost"].update_one(
        {"_id": doc["_id"]},
        {"$set": {"reminder_days": sorted(reminder_days, reverse=True), "updated_at": now}},
    )
    updated = await _get_cost_doc(db)
    return _cost_to_response(updated)


async def _compute_invoice_amount(db: AsyncIOMotorDatabase) -> float:
    """Sum active monthly + pending one-time line items."""
    doc = await _get_cost_doc(db)
    if not doc:
        return 0.0
    items = [CostLineItem.model_validate(i) for i in doc.get("line_items", [])]
    total = sum(i.amount_usd for i in items if i.is_active and (
        i.type == "monthly" or (i.type == "one_time" and not i.used_in_invoice_id)
    ))
    return round(total, 2)


async def _mark_one_time_items_used(db: AsyncIOMotorDatabase, invoice_id: str) -> None:
    """After an invoice is created, mark all pending one-time items as used."""
    now = _utc_now()
    await db["platform_cost"].update_one(
        {},
        {"$set": {
            "line_items.$[elem].used_in_invoice_id": invoice_id,
            "updated_at": now,
        }},
        array_filters=[{"elem.type": "one_time", "elem.is_active": True, "elem.used_in_invoice_id": None}],
    )


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
    line_items: list[dict] | None = None,
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
        "line_items": line_items or [],
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


async def delete_invoice(db: AsyncIOMotorDatabase, invoice_id: str) -> bool:
    result = await db["invoices"].delete_one({"_id": ObjectId(invoice_id)})
    if result.deleted_count:
        await db["payment_records"].delete_many({"invoice_id": invoice_id})
        await db["payment_arrangements"].delete_many({"invoice_id": invoice_id})
    return result.deleted_count > 0


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
    next_month_cost = await _compute_invoice_amount(db)
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
