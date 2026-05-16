from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.exceptions import ForbiddenError, NotFoundError
from app.dependencies import get_current_active_user, get_db
from app.models.user import UserDocument
from app.schemas.billing import (
    BillingGateStatus,
    CreateArrangementRequest,
    GenerateInvoiceRequest,
    InvoiceResponse,
    PaymentArrangementResponse,
    PlatformCostResponse,
    RecordPaymentRequest,
    SetPlatformCostRequest,
)
from app.services import billing_service

router = APIRouter(prefix="/billing", tags=["billing"])


def _require_superadmin(actor: UserDocument = Depends(get_current_active_user)) -> UserDocument:
    if actor.role != "superadmin":
        raise ForbiddenError("Only superadmin can manage billing")
    return actor


# ── Gate status (all authenticated users) ─────────────────────────────────────

@router.get("/gate-status", response_model=BillingGateStatus)
async def gate_status(
    actor: UserDocument = Depends(get_current_active_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> BillingGateStatus:
    """Returns the current billing gate state. Superadmin is never gated."""
    status = await billing_service.get_gate_status(db)
    if actor.role == "superadmin":
        status.is_gated = False
    return status


# ── Platform cost config (superadmin only) ────────────────────────────────────

@router.get("/config", response_model=PlatformCostResponse | None)
async def get_config(
    actor: UserDocument = _require_superadmin,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    cfg = await billing_service.get_platform_cost(db)
    if not cfg:
        return None
    return PlatformCostResponse(
        id=str(cfg.id),
        monthly_amount_usd=cfg.monthly_amount_usd,
        description=cfg.description,
        is_active=cfg.is_active,
        reminder_days=cfg.reminder_days,
        created_at=cfg.created_at,
    )


@router.put("/config", response_model=PlatformCostResponse)
async def set_config(
    body: SetPlatformCostRequest,
    actor: UserDocument = _require_superadmin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> PlatformCostResponse:
    cfg = await billing_service.upsert_platform_cost(
        db,
        monthly_amount_usd=body.monthly_amount_usd,
        description=body.description,
        reminder_days=body.reminder_days,
        created_by=str(actor.id),
    )
    return PlatformCostResponse(
        id=str(cfg.id),
        monthly_amount_usd=cfg.monthly_amount_usd,
        description=cfg.description,
        is_active=cfg.is_active,
        reminder_days=cfg.reminder_days,
        created_at=cfg.created_at,
    )


# ── Invoices ──────────────────────────────────────────────────────────────────

@router.get("/invoices", response_model=dict)
async def list_invoices(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    actor: UserDocument = _require_superadmin,
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
    actor: UserDocument = _require_superadmin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> InvoiceResponse:
    # Resolve amount from config if not supplied
    amount = body.amount_usd
    if amount is None:
        cfg = await billing_service.get_platform_cost(db)
        if not cfg:
            raise HTTPException(400, "No platform cost configured and no amount provided")
        amount = cfg.monthly_amount_usd

    doc = await billing_service.create_invoice(
        db,
        month=body.month,
        year=body.year,
        amount_usd=amount,
        created_by=str(actor.id),
        notes=body.notes,
    )
    return billing_service._to_invoice_response(doc)


@router.get("/invoices/{invoice_id}", response_model=InvoiceResponse)
async def get_invoice(
    invoice_id: str,
    actor: UserDocument = _require_superadmin,
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
    actor: UserDocument = _require_superadmin,
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


@router.post("/invoices/{invoice_id}/arrangement", response_model=PaymentArrangementResponse)
async def create_arrangement(
    invoice_id: str,
    body: CreateArrangementRequest,
    actor: UserDocument = _require_superadmin,
    db: AsyncIOMotorDatabase = Depends(get_db),
) -> PaymentArrangementResponse:
    arr = await billing_service.create_arrangement(
        db,
        invoice_id=invoice_id,
        installments=body.installments,
        created_by=str(actor.id),
    )
    return PaymentArrangementResponse(
        id=str(arr["_id"]),
        invoice_id=arr["invoice_id"],
        installments=arr["installments"],
        amounts_usd=arr["amounts_usd"],
        due_dates=arr["due_dates"],
        total_usd=arr["total_usd"],
        status=arr["status"],
        created_at=arr["created_at"],
    )
