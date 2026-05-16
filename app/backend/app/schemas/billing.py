from __future__ import annotations

from calendar import monthrange
from datetime import datetime

from pydantic import BaseModel, Field


class PlatformCostResponse(BaseModel):
    id: str
    monthly_amount_usd: float
    description: str
    is_active: bool
    reminder_days: list[int]
    created_at: datetime


class SetPlatformCostRequest(BaseModel):
    monthly_amount_usd: float = Field(..., gt=0, description="Monthly cost in USD")
    description: str = "Monthly platform operating costs"
    reminder_days: list[int] = Field(default=[14, 7, 1])


class InvoiceResponse(BaseModel):
    id: str
    period_month: int
    period_year: int
    period_label: str        # e.g. "May 2026"
    amount_usd: float
    paid_amount_usd: float
    balance_usd: float
    status: str
    due_date: datetime
    paid_at: datetime | None
    notes: str | None
    data_export_r2_key: str | None
    data_export_expires_at: datetime | None
    days_overdue: int
    created_at: datetime
    updated_at: datetime


class PaymentRecordResponse(BaseModel):
    id: str
    invoice_id: str
    amount_usd: float
    recorded_by: str
    notes: str | None
    is_arrangement_installment: bool
    recorded_at: datetime


class ArrangementInstallment(BaseModel):
    amount_usd: float
    due_date: datetime
    paid: bool = False


class PaymentArrangementResponse(BaseModel):
    id: str
    invoice_id: str
    installments: int
    amounts_usd: list[float]
    due_dates: list[datetime]
    total_usd: float
    status: str
    created_at: datetime


class RecordPaymentRequest(BaseModel):
    amount_usd: float = Field(..., gt=0)
    notes: str | None = None


class CreateArrangementRequest(BaseModel):
    installments: int = Field(2, ge=2, le=3)
    notes: str | None = None


class BillingGateStatus(BaseModel):
    is_gated: bool
    phase: str              # none | grace | warning | data_available | deleted
    gate_message: str
    current_invoice: InvoiceResponse | None = None
    grace_days_remaining: int | None = None
    deletion_days_remaining: int | None = None
    download_days_remaining: int | None = None
    data_export_url: str | None = None


class GenerateInvoiceRequest(BaseModel):
    month: int = Field(..., ge=1, le=12)
    year: int = Field(..., ge=2024)
    amount_usd: float | None = None  # overrides platform cost config if set
    notes: str | None = None
