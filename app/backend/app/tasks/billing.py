from __future__ import annotations

from app.core.celery_app import celery_app


def dispatch_escalate_invoices() -> str:
    result = celery_app.send_task(
        "worker.tasks.billing.escalate_invoices",
        queue="default",
    )
    return result.id


def dispatch_send_billing_reminders() -> str:
    result = celery_app.send_task(
        "worker.tasks.billing.send_billing_reminders",
        queue="email",
    )
    return result.id


def dispatch_generate_monthly_invoice() -> str:
    result = celery_app.send_task(
        "worker.tasks.billing.generate_monthly_invoice",
        queue="default",
    )
    return result.id


def dispatch_generate_data_export(invoice_id: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.billing.generate_data_export",
        kwargs={"invoice_id": invoice_id},
        queue="backup",
    )
    return result.id
