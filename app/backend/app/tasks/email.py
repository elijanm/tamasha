from __future__ import annotations

from app.core.celery_app import celery_app


def dispatch_verification_email(user_id: str, email: str, token: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.email.send_verification",
        kwargs={"user_id": user_id, "email": email, "token": token},
        queue="email",
    )
    return result.id


def dispatch_password_reset_email(user_id: str, email: str, token: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.email.send_password_reset",
        kwargs={"user_id": user_id, "email": email, "token": token},
        queue="email",
    )
    return result.id


def dispatch_suspicious_login_email(user_id: str, email: str, ip: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.email.send_suspicious_login",
        kwargs={"user_id": user_id, "email": email, "ip": ip},
        queue="email",
    )
    return result.id


def dispatch_artist_approval_email(user_id: str, email: str, status: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.email.send_artist_approval",
        kwargs={"user_id": user_id, "email": email, "status": status},
        queue="email",
    )
    return result.id


def dispatch_upload_complete_email(user_id: str, email: str, upload_id: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.email.send_upload_complete",
        kwargs={"user_id": user_id, "email": email, "upload_id": upload_id},
        queue="email",
    )
    return result.id


def dispatch_invite_email(user_id: str, email: str, username: str, role: str, invited_by: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.email.send_invite",
        kwargs={"user_id": user_id, "email": email, "username": username, "role": role, "invited_by": invited_by},
        queue="email",
    )
    return result.id


def dispatch_invite_link_email(email: str, role: str, invited_by: str, token: str) -> str:
    result = celery_app.send_task(
        "worker.tasks.email.send_invite_link",
        kwargs={"email": email, "role": role, "invited_by": invited_by, "token": token},
        queue="email",
    )
    return result.id


def dispatch_payment_receipt_email(email: str, context: dict) -> str:
    result = celery_app.send_task(
        "worker.tasks.email.send_billing_notification",
        kwargs={"email": email, "email_type": "payment_receipt", "context": context},
        queue="email",
    )
    return result.id
