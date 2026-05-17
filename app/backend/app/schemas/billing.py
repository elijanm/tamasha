from __future__ import annotations

from calendar import monthrange
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class CostLineItemResponse(BaseModel):
    id: str
    description: str
    amount_usd: float
    type: Literal["monthly", "one_time"]
    is_active: bool
    used_in_invoice_id: str | None
    created_at: datetime


class PlatformCostResponse(BaseModel):
    id: str
    line_items: list[CostLineItemResponse]
    reminder_days: list[int]
    monthly_total_usd: float   # sum of active monthly items
    one_time_total_usd: float  # sum of active one_time items (pending billing)
    created_at: datetime
    updated_at: datetime


class AddLineItemRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=200)
    amount_usd: float = Field(..., gt=0)
    type: Literal["monthly", "one_time"] = "monthly"


class UpdateLineItemRequest(BaseModel):
    description: str | None = Field(default=None, min_length=1, max_length=200)
    amount_usd: float | None = Field(default=None, gt=0)
    is_active: bool | None = None


class SetReminderDaysRequest(BaseModel):
    reminder_days: list[int] = Field(..., min_length=1)


class InvoiceLineItemResponse(BaseModel):
    id: str
    description: str
    amount_usd: float
    type: Literal["monthly", "one_time"]


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
    line_items: list[InvoiceLineItemResponse] = Field(default_factory=list)
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


class AddInvoiceLineItemRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=200)
    amount_usd: float = Field(..., gt=0)
    type: Literal["monthly", "one_time"] = "monthly"


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
