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
    RequestArrangementRequest,
)

logger = structlog.get_logger(__name__)

OVERDUE_WARN_DAYS = 3 # days after due before hard gating (banner-only warning window)
GRACE_DAYS = 30       # days after hard gate before deletion warning begins
WARNING_DAYS = 10     # days of warning before data becomes available for download
DOWNLOAD_DAYS = 90    # days the data export URL remains valid
DELETED_DAYS = OVERDUE_WARN_DAYS + GRACE_DAYS + WARNING_DAYS + DOWNLOAD_DAYS  # 133


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
    doc = await db["platform_cost"].find_one({}, sort=[("created_at", -1)])
    if doc:
        await _repair_orphaned_one_time_items(db, doc)
        doc = await db["platform_cost"].find_one({"_id": doc["_id"]})
    return doc


async def _repair_orphaned_one_time_items(db: AsyncIOMotorDatabase, cost_doc: dict) -> None:
    """Clear used_in_invoice_id on one-time items whose invoice was deleted."""
    orphaned_ids = {
        i["used_in_invoice_id"]
        for i in cost_doc.get("line_items", [])
        if i.get("type") == "one_time" and i.get("used_in_invoice_id")
    }
    if not orphaned_ids:
        return
    from bson import ObjectId as _ObjId
    existing = await db["invoices"].distinct(
        "_id",
        {"_id": {"$in": [_ObjId(oid) for oid in orphaned_ids if len(oid) == 24]}},
    )
    existing_strs = {str(oid) for oid in existing}
    truly_orphaned = orphaned_ids - existing_strs
    if not truly_orphaned:
        return
    now = _utc_now()
    for orphan_id in truly_orphaned:
        await db["platform_cost"].update_one(
            {"_id": cost_doc["_id"]},
            {"$set": {"line_items.$[elem].used_in_invoice_id": None, "updated_at": now}},
            array_filters=[{"elem.used_in_invoice_id": orphan_id}],
        )


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
    """Return the most relevant unpaid invoice (drives the gate).

    Priority order: partial > overdue > suspended > data_available > pending.
    Partial is checked first because it may have an active payment arrangement
    that should restore services. Within the same priority, newest due_date wins.
    """
    STATUS_PRIORITY = ["partial", "overdue", "suspended", "data_available", "pending", "deleted"]
    for status in STATUS_PRIORITY:
        doc = await db["invoices"].find_one(
            {"status": status},
            sort=[("due_date", -1)],
        )
        if doc:
            return doc
    return None


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


async def add_invoice_line_item(
    db: AsyncIOMotorDatabase,
    invoice_id: str,
    description: str,
    amount_usd: float,
    item_type: str,
) -> dict:
    import uuid
    now = _utc_now()
    invoice = await get_invoice(db, invoice_id)
    if not invoice:
        raise ValueError("Invoice not found")
    new_item = {
        "id": str(uuid.uuid4()),
        "description": description,
        "amount_usd": amount_usd,
        "type": item_type,
    }
    new_amount = round(invoice["amount_usd"] + amount_usd, 2)
    await db["invoices"].update_one(
        {"_id": ObjectId(invoice_id)},
        {
            "$push": {"line_items": new_item},
            "$set": {"amount_usd": new_amount, "updated_at": now},
        },
    )
    return await get_invoice(db, invoice_id)


async def remove_invoice_line_item(
    db: AsyncIOMotorDatabase,
    invoice_id: str,
    item_id: str,
) -> dict:
    now = _utc_now()
    invoice = await get_invoice(db, invoice_id)
    if not invoice:
        raise ValueError("Invoice not found")
    item = next((i for i in invoice.get("line_items", []) if i["id"] == item_id), None)
    if not item:
        raise ValueError("Line item not found")
    new_amount = max(0.0, round(invoice["amount_usd"] - item["amount_usd"], 2))
    await db["invoices"].update_one(
        {"_id": ObjectId(invoice_id)},
        {
            "$pull": {"line_items": {"id": item_id}},
            "$set": {"amount_usd": new_amount, "updated_at": now},
        },
    )
    return await get_invoice(db, invoice_id)


async def delete_invoice(db: AsyncIOMotorDatabase, invoice_id: str) -> bool:
    result = await db["invoices"].delete_one({"_id": ObjectId(invoice_id)})
    if result.deleted_count:
        await db["payment_records"].delete_many({"invoice_id": invoice_id})
        await db["payment_arrangements"].delete_many({"invoice_id": invoice_id})
        # Restore any one-time items that were marked as used by this invoice
        now = _utc_now()
        await db["platform_cost"].update_one(
            {},
            {"$set": {
                "line_items.$[elem].used_in_invoice_id": None,
                "updated_at": now,
            }},
            array_filters=[{"elem.used_in_invoice_id": invoice_id}],
        )
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

    updated = await get_invoice(db, invoice_id)

    # Send receipt to all superadmin users
    try:
        from app.tasks.email import dispatch_payment_receipt_email
        period_label = datetime(updated["period_year"], updated["period_month"], 1).strftime("%B %Y")
        receipt_ctx = {
            "invoice_id": invoice_id,
            "period_label": period_label,
            "payment_date": now.strftime("%d %b %Y"),
            "payment_amount_usd": amount_usd,
            "invoice_amount_usd": updated["amount_usd"],
            "total_paid_usd": new_paid,
            "balance_usd": round(updated["amount_usd"] - new_paid, 2),
            "is_paid_in_full": new_status == "paid",
            "line_items": updated.get("line_items", []),
            "notes": notes,
        }
        cursor = db["users"].find({"role": "superadmin", "is_active": True})
        async for user in cursor:
            dispatch_payment_receipt_email(user["email"], receipt_ctx)
    except Exception:
        pass  # receipt email failure must never block payment recording

    return updated


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
        "paid_flags": [False] * installments,
        "paid_at_list": [None] * installments,
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


def _to_arrangement_response(doc: dict) -> PaymentArrangementResponse:
    n = doc["installments"]
    return PaymentArrangementResponse(
        id=str(doc["_id"]),
        invoice_id=doc["invoice_id"],
        installments=n,
        amounts_usd=doc["amounts_usd"],
        due_dates=doc["due_dates"],
        total_usd=doc["total_usd"],
        status=doc["status"],
        paid_flags=doc.get("paid_flags") or [False] * n,
        paid_at_list=doc.get("paid_at_list") or [None] * n,
        created_at=doc["created_at"],
    )


async def get_active_arrangement_for_invoice(db: AsyncIOMotorDatabase, invoice_id: str) -> dict | None:
    return await db["payment_arrangements"].find_one(
        {"invoice_id": invoice_id, "status": "active"},
        sort=[("created_at", -1)],
    )


async def get_arrangement_for_invoice(db: AsyncIOMotorDatabase, invoice_id: str) -> dict | None:
    """Get the most recent arrangement (any status) for an invoice."""
    return await db["payment_arrangements"].find_one(
        {"invoice_id": invoice_id},
        sort=[("created_at", -1)],
    )


async def request_arrangement_by_user(
    db: AsyncIOMotorDatabase,
    invoice_id: str,
    installments: int,
    due_dates: list[str],
    requested_by: str,
) -> dict:
    from datetime import timedelta
    now = _utc_now()
    max_date = (now + timedelta(days=7)).replace(hour=23, minute=59, second=59)

    if len(due_dates) != installments:
        raise ValueError("Number of due_dates must equal installments")

    parsed: list[datetime] = []
    for d in due_dates:
        try:
            dt = datetime.strptime(d, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59, tzinfo=timezone.utc
            )
        except ValueError:
            raise ValueError(f"Invalid date format: {d!r} — use YYYY-MM-DD")
        if dt > max_date:
            raise ValueError(f"Date {d} exceeds the 7-day maximum ({max_date.date()})")
        if dt < now:
            raise ValueError(f"Date {d} is in the past")
        parsed.append(dt)

    for i in range(1, len(parsed)):
        if parsed[i] <= parsed[i - 1]:
            raise ValueError("Due dates must be in ascending order")

    # Block if the user has ANY uncleared defaulted arrangement on their account
    if await _is_arrangement_blocked(db, requested_by):
        raise ValueError("Payment arrangement requests are disabled for this account due to a previous default. Contact support.")

    # Block if a defaulted arrangement already exists for this invoice
    has_defaulted = await db["payment_arrangements"].find_one(
        {"invoice_id": invoice_id, "status": "defaulted"}
    )
    if has_defaulted:
        raise ValueError("A previous arrangement defaulted — no further arrangements are allowed for this invoice")

    # Block if an active arrangement already exists
    existing = await get_active_arrangement_for_invoice(db, invoice_id)
    if existing:
        raise ValueError("An active payment arrangement already exists")

    invoice = await get_invoice(db, invoice_id)
    if not invoice:
        raise ValueError("Invoice not found")

    balance = round(invoice["amount_usd"] - invoice["paid_amount_usd"], 2)
    base = round(balance / installments, 2)
    amounts = [base] * (installments - 1) + [round(balance - base * (installments - 1), 2)]

    arr_doc = {
        "invoice_id": invoice_id,
        "installments": installments,
        "amounts_usd": amounts,
        "due_dates": parsed,
        "total_usd": balance,
        "status": "active",
        "paid_flags": [False] * installments,
        "paid_at_list": [None] * installments,
        "requested_by": requested_by,
        "created_by": requested_by,
        "created_at": now,
        "updated_at": now,
    }
    await db["payment_arrangements"].insert_one(arr_doc)
    await db["invoices"].update_one(
        {"_id": ObjectId(invoice_id)},
        {"$set": {"status": "partial", "updated_at": now}},
    )
    return arr_doc


async def mark_installment_paid(
    db: AsyncIOMotorDatabase,
    arrangement_id: str,
    installment_index: int,
    recorded_by: str,
) -> dict:
    now = _utc_now()
    arr = await db["payment_arrangements"].find_one({"_id": ObjectId(arrangement_id)})
    if not arr:
        raise ValueError("Arrangement not found")

    n = arr["installments"]
    paid_flags: list[bool] = list(arr.get("paid_flags") or [False] * n)
    paid_at_list: list = list(arr.get("paid_at_list") or [None] * n)

    if installment_index < 0 or installment_index >= n:
        raise ValueError(f"Invalid installment index {installment_index}")
    if paid_flags[installment_index]:
        raise ValueError("Installment already marked as paid")

    paid_flags[installment_index] = True
    paid_at_list[installment_index] = now

    # Record payment
    amount = arr["amounts_usd"][installment_index]
    await db["payment_records"].insert_one({
        "invoice_id": arr["invoice_id"],
        "amount_usd": amount,
        "recorded_by": recorded_by,
        "notes": f"Installment {installment_index + 1} of {n}",
        "is_arrangement_installment": True,
        "recorded_at": now,
    })

    # Update invoice paid amount
    invoice = await get_invoice(db, arr["invoice_id"])
    new_paid = round(invoice["paid_amount_usd"] + amount, 2)
    all_paid = all(paid_flags)
    new_arr_status = "completed" if all_paid else "active"
    new_inv_status = "paid" if new_paid >= invoice["amount_usd"] else ("partial" if not all_paid else invoice["status"])

    await db["payment_arrangements"].update_one(
        {"_id": ObjectId(arrangement_id)},
        {"$set": {"paid_flags": paid_flags, "paid_at_list": paid_at_list,
                  "status": new_arr_status, "updated_at": now}},
    )
    await db["invoices"].update_one(
        {"_id": ObjectId(arr["invoice_id"])},
        {"$set": {"paid_amount_usd": new_paid, "status": new_inv_status,
                  "paid_at": now if all_paid else None, "updated_at": now}},
    )
    return await db["payment_arrangements"].find_one({"_id": ObjectId(arrangement_id)})


async def _default_arrangement(db: AsyncIOMotorDatabase, arrangement_id: str) -> None:
    now = _utc_now()
    await db["payment_arrangements"].update_one(
        {"_id": ObjectId(arrangement_id)},
        {"$set": {"status": "defaulted", "updated_at": now}},
    )


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

        hard_days = days_late - OVERDUE_WARN_DAYS
        if hard_days >= GRACE_DAYS + WARNING_DAYS:  # 43+
            new_status = "data_available"
        elif hard_days >= GRACE_DAYS:               # 33+
            new_status = "suspended"
        elif days_late >= OVERDUE_WARN_DAYS and current == "pending":  # 3+
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

async def _is_arrangement_blocked(db: AsyncIOMotorDatabase, user_id: str) -> bool:
    """True if the user has a defaulted arrangement on any active (non-deleted, non-paid) invoice."""
    pipeline = [
        {"$match": {"requested_by": user_id, "status": "defaulted"}},
        {"$addFields": {"invoice_oid": {"$toObjectId": "$invoice_id"}}},
        {"$lookup": {
            "from": "invoices",
            "localField": "invoice_oid",
            "foreignField": "_id",
            "as": "invoice",
        }},
        {"$unwind": "$invoice"},
        {"$match": {"invoice.status": {"$nin": ["deleted", "paid"]}}},
        {"$limit": 1},
    ]
    results = await db["payment_arrangements"].aggregate(pipeline).to_list(1)
    return len(results) > 0


async def clear_arrangement_block(db: AsyncIOMotorDatabase, arrangement_id: str) -> None:
    """Superadmin clears the block by marking all defaulted arrangements for that
    user as 'defaulted_cleared', restoring their ability to request arrangements."""
    arr = await db["payment_arrangements"].find_one({"_id": ObjectId(arrangement_id)})
    if not arr or not arr.get("requested_by"):
        raise ValueError("Arrangement not found or has no requesting user")
    user_id = arr["requested_by"]
    await db["payment_arrangements"].update_many(
        {"requested_by": user_id, "status": "defaulted"},
        {"$set": {"status": "defaulted_cleared", "updated_at": _utc_now()}},
    )


async def get_gate_status(
    db: AsyncIOMotorDatabase,
    data_export_url: str | None = None,
    user_id: str | None = None,
) -> BillingGateStatus:
    blocked = await _is_arrangement_blocked(db, user_id) if user_id else False

    invoice_doc = await get_active_invoice(db)
    if not invoice_doc:
        return BillingGateStatus(is_gated=False, phase="none", gate_message="", arrangement_blocked=blocked)

    inv = _to_invoice_response(invoice_doc)
    now = _utc_now()
    days_late = inv.days_overdue
    invoice_id = str(invoice_doc["_id"])

    # Not yet past main due date — check arrangement state
    if inv.status in ("pending", "partial") and days_late == 0:
        arr = await get_active_arrangement_for_invoice(db, invoice_id)
        if arr:
            n = arr["installments"]
            paid_flags = arr.get("paid_flags") or [False] * n
            current_idx = next((i for i, p in enumerate(paid_flags) if not p), None)
            if current_idx is not None:
                due_dt = arr["due_dates"][current_idx]
                if due_dt.tzinfo is None:
                    due_dt = due_dt.replace(tzinfo=timezone.utc)
                if now <= due_dt:
                    return BillingGateStatus(
                        is_gated=False, phase="arrangement",
                        gate_message=f"Payment arrangement active. Installment {current_idx + 1} of {n} due {due_dt.strftime('%B %d, %Y')}.",
                        current_invoice=inv,
                        active_arrangement=_to_arrangement_response(arr),
                        next_installment_amount=arr["amounts_usd"][current_idx],
                        next_installment_due=due_dt,
                        arrangement_blocked=blocked,
                    )
                # Installment date passed — default arrangement and revert invoice
                await _default_arrangement(db, str(arr["_id"]))
                blocked = True  # just defaulted — block immediately
                if inv.status == "partial":
                    await db["invoices"].update_one(
                        {"_id": invoice_doc["_id"]},
                        {"$set": {"status": "overdue", "updated_at": now}},
                    )

        # Check if a previous arrangement defaulted — gate immediately
        defaulted_arr = await db["payment_arrangements"].find_one(
            {"invoice_id": invoice_id, "status": "defaulted"}
        )
        if defaulted_arr:
            arr_resp = _to_arrangement_response(defaulted_arr)
            return BillingGateStatus(
                is_gated=True, phase="grace",
                gate_message="Installment missed. Services suspended. Contact support to resolve the outstanding balance.",
                current_invoice=inv,
                active_arrangement=arr_resp,
                grace_days_remaining=GRACE_DAYS,
                arrangement_blocked=True,
            )

        return BillingGateStatus(is_gated=False, phase="none", gate_message="", current_invoice=inv, arrangement_blocked=blocked)

    if inv.status == "deleted":
        return BillingGateStatus(
            is_gated=True, phase="deleted",
            gate_message="Services have been terminated due to non-payment.",
            current_invoice=inv,
            arrangement_blocked=blocked,
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
            arrangement_blocked=blocked,
        )

    # Check for an active arrangement — if current installment still pending, restore services
    arr = await get_active_arrangement_for_invoice(db, invoice_id)
    if arr:
        n = arr["installments"]
        paid_flags = arr.get("paid_flags") or [False] * n
        current_idx = next((i for i, p in enumerate(paid_flags) if not p), None)
        if current_idx is not None:
            due_dt = arr["due_dates"][current_idx]
            if due_dt.tzinfo is None:
                due_dt = due_dt.replace(tzinfo=timezone.utc)
            if now <= due_dt:
                # Services temporarily restored
                return BillingGateStatus(
                    is_gated=False, phase="arrangement",
                    gate_message=f"Payment arrangement active. Installment {current_idx + 1} of {n} due {due_dt.strftime('%B %d, %Y')}.",
                    current_invoice=inv,
                    active_arrangement=_to_arrangement_response(arr),
                    next_installment_amount=arr["amounts_usd"][current_idx],
                    next_installment_due=due_dt,
                    arrangement_blocked=blocked,
                )
            else:
                # Installment overdue — default and fall through to gate
                await _default_arrangement(db, str(arr["_id"]))
                blocked = True

    if inv.status == "suspended":
        days_until_deletion = max(0, GRACE_DAYS + WARNING_DAYS - days_late)
        arr_doc = await get_arrangement_for_invoice(db, invoice_id)
        arr_resp = _to_arrangement_response(arr_doc) if arr_doc else None
        return BillingGateStatus(
            is_gated=True, phase="warning",
            gate_message=f"Services are suspended. Data will be deleted in {days_until_deletion} day(s) if payment is not received.",
            current_invoice=inv,
            active_arrangement=arr_resp,
            deletion_days_remaining=days_until_deletion,
            arrangement_blocked=blocked,
        )

    # Soft warning window — invoice overdue but within 3-day grace
    if days_late <= OVERDUE_WARN_DAYS:
        days_until_gate = OVERDUE_WARN_DAYS - days_late
        return BillingGateStatus(
            is_gated=False, phase="overdue",
            gate_message=f"Invoice overdue by {days_late} day(s). Services will be suspended in {days_until_gate} day(s).",
            current_invoice=inv,
            arrangement_blocked=blocked,
        )

    # Hard gate — grace period before deletion warning
    grace_remaining = max(0, GRACE_DAYS - (days_late - OVERDUE_WARN_DAYS))
    arr_doc = await get_arrangement_for_invoice(db, invoice_id)
    arr_resp = _to_arrangement_response(arr_doc) if arr_doc else None
    return BillingGateStatus(
        is_gated=True, phase="grace",
        gate_message=f"Invoice overdue. Services suspended. {grace_remaining} day(s) remaining in grace period.",
        current_invoice=inv,
        active_arrangement=arr_resp,
        grace_days_remaining=grace_remaining,
        arrangement_blocked=blocked,
    )
