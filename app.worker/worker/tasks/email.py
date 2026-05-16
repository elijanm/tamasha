from __future__ import annotations

import smtplib
import ssl
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import structlog
from celery import Task
from jinja2 import Environment, DictLoader

from worker.celery_app import app
from worker.config import get_settings

logger = structlog.get_logger(__name__)

# ── Email templates ───────────────────────────────────────────────────────────

_TEMPLATES = {
    "verification": """
<h2>Verify your Tamasha account</h2>
<p>Click the link below to verify your email address:</p>
<p><a href="{{ base_url }}/verify-email?token={{ token }}">Verify Email</a></p>
<p>This link expires in 24 hours.</p>
""",
    "password_reset": """
<h2>Reset your Tamasha password</h2>
<p>Click the link below to reset your password:</p>
<p><a href="{{ base_url }}/reset-password?token={{ token }}">Reset Password</a></p>
<p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
""",
    "suspicious_login": """
<h2>New login to your Tamasha account</h2>
<p>A login was detected from a new IP address: <strong>{{ ip }}</strong></p>
<p>If this was you, no action is needed. If not, please reset your password immediately.</p>
""",
    "artist_approval": """
<h2>Your Tamasha artist profile has been {{ status }}</h2>
{% if status == "approved" %}
<p>Congratulations! Your artist profile is now active on Tamasha.</p>
{% else %}
<p>Unfortunately your artist profile was not approved at this time. Please contact support for more information.</p>
{% endif %}
""",
    "upload_complete": """
<h2>Your Tamasha upload is complete</h2>
<p>Upload <strong>{{ upload_id }}</strong> has finished processing.</p>
<p>Visit your dashboard to review the uploaded tracks.</p>
""",
    "invite": """
<h2>You have been added to Tamasha</h2>
<p>Hi <strong>{{ username }}</strong>,</p>
<p><strong>{{ invited_by }}</strong> has created a <strong>{{ role }}</strong> account for you on the Tamasha archive platform.</p>
<p>Your account is active and ready to use. Sign in at:</p>
<p><a href="{{ base_url }}/login">{{ base_url }}/login</a></p>
<p>Use your email address <strong>{{ email }}</strong> and the password you were given. You can change your password after signing in.</p>
<p style="color:#888;font-size:12px">If you were not expecting this, please contact your administrator.</p>
""",
}

_jinja = Environment(loader=DictLoader(_TEMPLATES), autoescape=True)


def _send_email(to_email: str, subject: str, html_body: str) -> None:
    settings = get_settings()
    msg = MIMEMultipart("alternative")
    msg["From"] = settings.smtp_from
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.attach(MIMEText(html_body, "html"))

    context = ssl.create_default_context() if settings.smtp_tls else None
    try:
        if settings.smtp_tls:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
                server.ehlo()
                server.starttls(context=context)
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.sendmail(settings.smtp_from, to_email, msg.as_string())
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password)
                server.sendmail(settings.smtp_from, to_email, msg.as_string())
    except Exception as exc:
        logger.error("email_send_failed", to=to_email, subject=subject, error=str(exc))
        raise


# ── Tasks ─────────────────────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.email.send_verification",
    bind=True, max_retries=3, default_retry_delay=30,
    autoretry_for=(Exception,), retry_backoff=True,
)
def send_verification(self: Task, user_id: str, email: str, token: str) -> dict:
    settings = get_settings()
    html = _jinja.get_template("verification").render(
        base_url=settings.app_base_url, token=token
    )
    _send_email(email, "Verify your Tamasha account", html)
    logger.info("verification_email_sent", user_id=user_id)
    return {"user_id": user_id, "sent": True}


@app.task(
    name="worker.tasks.email.send_password_reset",
    bind=True, max_retries=3, default_retry_delay=30,
    autoretry_for=(Exception,), retry_backoff=True,
)
def send_password_reset(self: Task, user_id: str, email: str, token: str) -> dict:
    settings = get_settings()
    html = _jinja.get_template("password_reset").render(
        base_url=settings.app_base_url, token=token
    )
    _send_email(email, "Reset your Tamasha password", html)
    logger.info("password_reset_email_sent", user_id=user_id)
    return {"user_id": user_id, "sent": True}


@app.task(
    name="worker.tasks.email.send_suspicious_login",
    bind=True, max_retries=3, default_retry_delay=30,
    autoretry_for=(Exception,), retry_backoff=True,
)
def send_suspicious_login(self: Task, user_id: str, email: str, ip: str) -> dict:
    html = _jinja.get_template("suspicious_login").render(ip=ip)
    _send_email(email, "New login to your Tamasha account", html)
    logger.info("suspicious_login_email_sent", user_id=user_id, ip=ip)
    return {"user_id": user_id, "sent": True}


@app.task(
    name="worker.tasks.email.send_artist_approval",
    bind=True, max_retries=3, default_retry_delay=30,
    autoretry_for=(Exception,), retry_backoff=True,
)
def send_artist_approval(self: Task, user_id: str, email: str, status: str) -> dict:
    html = _jinja.get_template("artist_approval").render(status=status)
    subject = f"Your Tamasha artist profile has been {status}"
    _send_email(email, subject, html)
    logger.info("artist_approval_email_sent", user_id=user_id, status=status)
    return {"user_id": user_id, "sent": True}


@app.task(
    name="worker.tasks.email.send_upload_complete",
    bind=True, max_retries=3, default_retry_delay=30,
    autoretry_for=(Exception,), retry_backoff=True,
)
def send_upload_complete(self: Task, user_id: str, email: str, upload_id: str) -> dict:
    html = _jinja.get_template("upload_complete").render(upload_id=upload_id)
    _send_email(email, "Your Tamasha upload is complete", html)
    logger.info("upload_complete_email_sent", user_id=user_id, upload_id=upload_id)
    return {"user_id": user_id, "sent": True}


@app.task(
    name="worker.tasks.email.send_invite",
    bind=True, max_retries=3, default_retry_delay=30,
    autoretry_for=(Exception,), retry_backoff=True,
)
def send_invite(self: Task, user_id: str, email: str, username: str, role: str, invited_by: str) -> dict:
    settings = get_settings()
    html = _jinja.get_template("invite").render(
        base_url=settings.app_base_url,
        email=email,
        username=username,
        role=role,
        invited_by=invited_by,
    )
    _send_email(email, "You have been added to Tamasha", html)
    logger.info("invite_email_sent", user_id=user_id, role=role)
    return {"user_id": user_id, "sent": True}
