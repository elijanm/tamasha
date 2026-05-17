from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.config import get_settings
from app.core.exceptions import ForbiddenError, NotFoundError
from app.dependencies import get_current_active_user, get_db
from app.models.user import UserDocument
from app.schemas.billing import (
    AddInvoiceLineItemRequest,
    AddLineItemRequest,
    BillingGateStatus,
    CreateArrangementRequest,
    GenerateInvoiceRequest,
    InvoiceResponse,
    PaymentArrangementResponse,
    PaymentProofResponse,
    PlatformCostResponse,
    RecordPaymentRequest,
    RequestArrangementRequest,
    SetReminderDaysRequest,
    UpdateLineItemRequest,
)
from app.services import billing_service, user_service

router = APIRouter(prefix="/billing", tags=["billing"])


def _require_superadmin(actor: UserDocument = Depends(get_current_active_user)) -> UserDocument:
    if actor.role != "superadmin":
        raise ForbiddenError("Only superadmin can manage billing")
    return actor


def _require_billing_view(actor: UserDocument = Depends(get_current_active_user)) -> UserDocument:
    """Superadmin always allowed; admin requires the 'accounting' extra permission."""
    if actor.role == "superadmin":
        return actor
    if actor.role == "admin" and "accounting" in (actor.extra_permissions or []):
        return actor
    raise ForbiddenError("You need the Accounting permission to view billing")


# ── Gate status (all authenticated users) ─────────────────────────────────────

@router.get("/gate-status", response_model=BillingGateStatus)
async def gate_status(
    actor: UserDocument = Depends(get_current_active_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> BillingGateStatus:
    """Returns the current billing gate state. Superadmin can see invoice state but is never gated."""
    result = await billing_service.get_gate_status(db, user_id=str(actor.id))
    if actor.role == "superadmin":
        result.is_gated = False
    settings = get_settings()
    if (
        settings.billing_banner_accounting
        and actor.role == "admin"
        and "accounting" in (actor.extra_permissions or [])
    ):
        result.show_accounting_banner = True
    return result


# ── Platform cost config (superadmin only) ────────────────────────────────────

@router.get("/config", response_model=PlatformCostResponse | None)
async def get_config(
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> PlatformCostResponse | None:
    doc = await billing_service._get_cost_doc(db)
    if not doc:
        return None
    return billing_service._cost_to_response(doc)


@router.post("/config/items", response_model=PlatformCostResponse, status_code=201)
async def add_line_item(
    body: AddLineItemRequest,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> PlatformCostResponse:
    return await billing_service.add_line_item(
        db,
        description=body.description,
        amount_usd=body.amount_usd,
        item_type=body.type,
        created_by=str(actor.id),
    )


@router.patch("/config/items/{item_id}", response_model=PlatformCostResponse)
async def update_line_item(
    item_id: str,
    body: UpdateLineItemRequest,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> PlatformCostResponse:
    return await billing_service.update_line_item(
        db,
        item_id=item_id,
        description=body.description,
        amount_usd=body.amount_usd,
        is_active=body.is_active,
    )


@router.delete("/config/items/{item_id}", response_model=PlatformCostResponse)
async def remove_line_item(
    item_id: str,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> PlatformCostResponse:
    return await billing_service.remove_line_item(db, item_id=item_id)


@router.patch("/config/reminders", response_model=PlatformCostResponse)
async def set_reminder_days(
    body: SetReminderDaysRequest,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> PlatformCostResponse:
    return await billing_service.set_reminder_days(
        db,
        reminder_days=body.reminder_days,
        created_by=str(actor.id),
    )


# ── Invoices ──────────────────────────────────────────────────────────────────

@router.get("/invoices", response_model=dict)
async def list_invoices(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    actor: UserDocument = Depends(_require_billing_view),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> dict:
    docs, total = await billing_service.list_invoices(db, skip=skip, limit=limit)
    return {
        "items": [billing_service._to_invoice_response(d) for d in docs],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.post("/invoices", response_model=InvoiceResponse, status_code=201)
async def create_invoice(
    body: GenerateInvoiceRequest,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> InvoiceResponse:
    snapshot = await billing_service._snapshot_line_items(db)
    amount = body.amount_usd
    if amount is None:
        amount = sum(i["amount_usd"] for i in snapshot)
        if amount == 0:
            raise HTTPException(400, "No platform cost configured and no amount provided")

    doc = await billing_service.create_invoice(
        db,
        month=body.month,
        year=body.year,
        amount_usd=amount,
        created_by=str(actor.id),
        notes=body.notes,
        line_items=snapshot,
    )
    await billing_service._mark_one_time_items_used(db, str(doc["_id"]))
    return billing_service._to_invoice_response(doc)


@router.get("/invoices/{invoice_id}", response_model=InvoiceResponse)
async def get_invoice(
    invoice_id: str,
    actor: UserDocument = Depends(_require_billing_view),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> InvoiceResponse:
    doc = await billing_service.get_invoice(db, invoice_id)
    if not doc:
        raise NotFoundError("Invoice not found")
    return billing_service._to_invoice_response(doc)


@router.post("/invoices/{invoice_id}/pay", response_model=InvoiceResponse)
async def record_payment(
    invoice_id: str,
    body: RecordPaymentRequest,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> InvoiceResponse:
    doc = await billing_service.record_payment(
        db,
        invoice_id=invoice_id,
        amount_usd=body.amount_usd,
        recorded_by=str(actor.id),
        notes=body.notes,
    )
    return billing_service._to_invoice_response(doc)


@router.post("/invoices/{invoice_id}/items", response_model=InvoiceResponse, status_code=201)
async def add_invoice_line_item(
    invoice_id: str,
    body: AddInvoiceLineItemRequest,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> InvoiceResponse:
    try:
        doc = await billing_service.add_invoice_line_item(
            db,
            invoice_id=invoice_id,
            description=body.description,
            amount_usd=body.amount_usd,
            item_type=body.type,
        )
    except ValueError as e:
        raise NotFoundError(str(e))
    return billing_service._to_invoice_response(doc)


@router.delete("/invoices/{invoice_id}/items/{item_id}", response_model=InvoiceResponse)
async def remove_invoice_line_item(
    invoice_id: str,
    item_id: str,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> InvoiceResponse:
    try:
        doc = await billing_service.remove_invoice_line_item(db, invoice_id, item_id)
    except ValueError as e:
        raise NotFoundError(str(e))
    return billing_service._to_invoice_response(doc)


@router.post("/invoices/{invoice_id}/send-email", status_code=204)
async def send_invoice_email(
    invoice_id: str,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    """Send the invoice to INVOICE_EMAIL + all admins with the accounting permission."""
    doc = await billing_service.get_invoice(db, invoice_id)
    if not doc:
        raise NotFoundError("Invoice not found")
    from app.tasks.billing import dispatch_send_invoice_email
    accounting_emails = await user_service.get_accounting_admin_emails(db)
    context = billing_service._build_invoice_email_context(doc)
    dispatch_send_invoice_email(accounting_emails=accounting_emails, context=context)


@router.post("/invoices/{invoice_id}/proof", response_model=PaymentProofResponse, status_code=201)
async def submit_payment_proof(
    invoice_id: str,
    notes: str | None = Form(default=None),
    installment_index: int | None = Form(default=None),
    file: UploadFile | None = File(default=None),
    actor: UserDocument = Depends(_require_billing_view),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> PaymentProofResponse:
    """Submit payment proof (text + optional file) for a whole invoice or a specific installment."""
    doc = await billing_service.get_invoice(db, invoice_id)
    if not doc:
        raise NotFoundError("Invoice not found")

    r2_key: str | None = None
    filename: str | None = None
    content_type: str | None = None

    if file and file.filename:
        allowed = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
        ct = file.content_type or ""
        if ct not in allowed:
            raise HTTPException(400, "Proof file must be a JPEG, PNG, WebP image, or PDF")
        data = await file.read()
        if len(data) > 10 * 1024 * 1024:
            raise HTTPException(400, "Proof file must be under 10 MB")
        from app.utils.r2 import get_r2_client
        from app.config import get_settings as _gs
        settings = _gs()
        ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
        r2_key = f"billing/proofs/{invoice_id}/{uuid.uuid4().hex}.{ext}"
        get_r2_client().put_object(
            Bucket=settings.r2_bucket,
            Key=r2_key,
            Body=data,
            ContentType=ct,
        )
        filename = file.filename
        content_type = ct

    display_name = actor.profile.display_name if actor.profile and actor.profile.display_name else actor.username  # type: ignore[union-attr]
    return await billing_service.submit_payment_proof(
        db,
        invoice_id=invoice_id,
        submitted_by=str(actor.id),
        submitted_by_name=display_name,
        notes=notes,
        r2_key=r2_key,
        filename=filename,
        content_type=content_type,
        installment_index=installment_index,
    )


@router.get("/invoices/{invoice_id}/proofs", response_model=list[PaymentProofResponse])
async def list_payment_proofs(
    invoice_id: str,
    actor: UserDocument = Depends(_require_billing_view),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> list[PaymentProofResponse]:
    doc = await billing_service.get_invoice(db, invoice_id)
    if not doc:
        raise NotFoundError("Invoice not found")
    return await billing_service.list_payment_proofs(db, invoice_id)


@router.delete("/invoices/{invoice_id}", status_code=204)
async def delete_invoice(
    invoice_id: str,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    deleted = await billing_service.delete_invoice(db, invoice_id)
    if not deleted:
        raise NotFoundError("Invoice not found")


@router.get("/invoices/{invoice_id}/arrangement", response_model=PaymentArrangementResponse | None)
async def get_invoice_arrangement(
    invoice_id: str,
    actor: UserDocument = Depends(get_current_active_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> PaymentArrangementResponse | None:
    doc = await billing_service.get_arrangement_for_invoice(db, invoice_id)
    if not doc:
        return None
    return billing_service._to_arrangement_response(doc)


@router.post("/invoices/{invoice_id}/arrangement/request", response_model=PaymentArrangementResponse, status_code=201)
async def request_arrangement(
    invoice_id: str,
    body: RequestArrangementRequest,
    actor: UserDocument = Depends(get_current_active_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> PaymentArrangementResponse:
    try:
        arr = await billing_service.request_arrangement_by_user(
            db,
            invoice_id=invoice_id,
            installments=body.installments,
            due_dates=body.due_dates,
            requested_by=str(actor.id),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return billing_service._to_arrangement_response(arr)


@router.post("/invoices/{invoice_id}/arrangement", response_model=PaymentArrangementResponse)
async def create_arrangement(
    invoice_id: str,
    body: CreateArrangementRequest,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> PaymentArrangementResponse:
    arr = await billing_service.create_arrangement(
        db,
        invoice_id=invoice_id,
        installments=body.installments,
        created_by=str(actor.id),
    )
    return billing_service._to_arrangement_response(arr)


@router.post("/arrangements/{arrangement_id}/installments/{index}/pay", response_model=PaymentArrangementResponse)
async def mark_installment_paid(
    arrangement_id: str,
    index: int,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> PaymentArrangementResponse:
    try:
        arr = await billing_service.mark_installment_paid(
            db,
            arrangement_id=arrangement_id,
            installment_index=index,
            recorded_by=str(actor.id),
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return billing_service._to_arrangement_response(arr)


@router.post("/arrangements/{arrangement_id}/clear-block", status_code=204)
async def clear_arrangement_block(
    arrangement_id: str,
    actor: UserDocument = Depends(_require_superadmin),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> None:
    """Superadmin clears the arrangement block for the user who owns this arrangement."""
    try:
        await billing_service.clear_arrangement_block(db, arrangement_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
