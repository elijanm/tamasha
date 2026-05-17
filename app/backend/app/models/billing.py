from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.utils.object_id import PyObjectId

InvoiceStatus = Literal[
    "pending",        # Created, due date not yet reached or recently due
    "overdue",        # Past due, 0-30 day grace period active
    "suspended",      # 30-40 days overdue — deletion warning shown
    "data_available", # 40+ days — data archive ready to download (90-day window)
    "deleted",        # 130+ days (40 overdue + 90-day download window expired)
    "paid",
    "partial",        # Payment arrangement active
]

CostLineType = Literal["monthly", "one_time"]


class CostLineItem(BaseModel):
    """Embedded sub-document inside PlatformCostDocument.line_items."""
    id: str                         # uuid4 string
    description: str
    amount_usd: float
    type: CostLineType = "monthly"  # monthly = recurring; one_time = included once then deactivated
    is_active: bool = True
    used_in_invoice_id: str | None = None  # set when a one_time item is billed
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PlatformCostDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: PyObjectId | None = Field(default=None, alias="_id")
    line_items: list[CostLineItem] = Field(default_factory=list)
    reminder_days: list[int] = Field(default_factory=lambda: [14, 7, 1])
    created_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class InvoiceDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: PyObjectId | None = Field(default=None, alias="_id")
    period_month: int   # 1–12
    period_year: int
    amount_usd: float
    paid_amount_usd: float = 0.0
    status: str = "pending"
    due_date: datetime                    # last day of the billing month (UTC midnight)
    paid_at: datetime | None = None
    notes: str | None = None
    data_export_r2_key: str | None = None
    data_export_expires_at: datetime | None = None
    reminders_sent: list[int] = Field(default_factory=list)  # days-before already sent
    created_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class PaymentRecordDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: PyObjectId | None = Field(default=None, alias="_id")
    invoice_id: str
    amount_usd: float
    recorded_by: str
    notes: str | None = None
    is_arrangement_installment: bool = False
    recorded_at: datetime = Field(default_factory=datetime.utcnow)


class PaymentArrangementDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, arbitrary_types_allowed=True)

    id: PyObjectId | None = Field(default=None, alias="_id")
    invoice_id: str
    installments: int = 2
    amounts_usd: list[float]    # one per installment, sums to total_usd
    due_dates: list[datetime]
    total_usd: float            # invoice balance + next-month recurring
    status: str = "active"      # active | completed | defaulted
    created_by: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
