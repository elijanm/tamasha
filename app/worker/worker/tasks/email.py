from __future__ import annotations

import resend
import structlog
from celery import Task
from jinja2 import Environment, DictLoader

from worker.celery_app import app
from worker.config import get_settings

logger = structlog.get_logger(__name__)

# ── HTML shell ────────────────────────────────────────────────────────────────

def _wrap(body: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f4;padding:32px 16px;">
  <tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e7e5e4;">

    <tr>
      <td style="background:#1c1917;padding:24px 32px;">
        <span style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Tamasha</span>
        <span style="font-size:11px;color:#78716c;margin-left:8px;letter-spacing:2px;text-transform:uppercase;">Platform</span>
      </td>
    </tr>

    <tr>
      <td style="padding:32px;color:#1c1917;font-size:15px;line-height:1.6;">
        {body}
      </td>
    </tr>

    <tr>
      <td style="background:#f5f5f4;padding:20px 32px;border-top:1px solid #e7e5e4;">
        <p style="margin:0;font-size:12px;color:#a8a29e;">This is an automated message from the Tamasha archive platform. Do not reply to this email.</p>
      </td>
    </tr>

  </table>
  </td></tr>
</table>
</body>
</html>"""


# ── Template helpers ──────────────────────────────────────────────────────────

_BTN_PURPLE = "background:#7c3aed"
_BTN_RED    = "background:#dc2626"

def _render(name: str, ctx: dict) -> str:
    body = _jinja.get_template(name).render(**ctx)
    return _wrap(body)


# ── Email templates (body fragments only) ────────────────────────────────────

_TEMPLATES: dict[str, str] = {

"verification": """
<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1c1917;">Verify your Tamasha account</h2>
<p style="margin:0 0 20px;font-size:15px;color:#44403c;line-height:1.6;">
  Click the button below to confirm your email address and activate your account.
</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
  <tr><td style="background:#7c3aed;border-radius:6px;">
    <a href="{{ base_url }}/verify-email?token={{ token }}"
       style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
      Verify Email
    </a>
  </td></tr>
</table>
<p style="margin:0;font-size:13px;color:#78716c;line-height:1.6;">
  This link expires in <strong>24 hours</strong>. If you did not create a Tamasha account, ignore this email.
</p>
""",

"password_reset": """
<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1c1917;">Reset your password</h2>
<p style="margin:0 0 20px;font-size:15px;color:#44403c;line-height:1.6;">
  We received a request to reset the password for your Tamasha account.
</p>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
  <tr><td style="background:#dc2626;border-radius:6px;">
    <a href="{{ base_url }}/reset-password?token={{ token }}"
       style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
      Reset Password
    </a>
  </td></tr>
</table>
<p style="margin:0;font-size:13px;color:#78716c;line-height:1.6;">
  This link expires in <strong>1 hour</strong>. If you did not request a password reset, no action is needed.
</p>
""",

"suspicious_login": """
<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1c1917;">New sign-in detected</h2>
<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:0 4px 4px 0;margin:0 0 16px;">
  <p style="margin:0;font-size:14px;color:#1c1917;">
    A sign-in was detected from a new IP address: <strong>{{ ip }}</strong>
  </p>
</div>
<p style="margin:0 0 12px;font-size:15px;color:#44403c;line-height:1.6;">
  If this was you, no action is needed.
</p>
<p style="margin:0;font-size:15px;color:#dc2626;line-height:1.6;">
  If you do not recognise this sign-in, <strong>reset your password immediately</strong> and contact your administrator.
</p>
""",

"artist_approval": """
{% if status == "approved" %}
<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1c1917;">Artist profile approved</h2>
<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:0 4px 4px 0;margin:0 0 16px;">
  <p style="margin:0;font-size:14px;color:#1c1917;">Congratulations — your artist profile is now active on Tamasha.</p>
</div>
<p style="margin:0;font-size:15px;color:#44403c;line-height:1.6;">
  Log in to your Artist Portal to manage your catalogue, view analytics, and track royalties.
</p>
{% else %}
<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1c1917;">Artist profile not approved</h2>
<div style="background:#fef2f2;border-left:4px solid #dc2626;padding:12px 16px;border-radius:0 4px 4px 0;margin:0 0 16px;">
  <p style="margin:0;font-size:14px;color:#1c1917;">Your artist profile submission was not approved at this time.</p>
</div>
<p style="margin:0;font-size:15px;color:#44403c;line-height:1.6;">
  Please contact your administrator for more information and to discuss next steps.
</p>
{% endif %}
""",

"upload_complete": """
<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1c1917;">Upload complete</h2>
<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="border:1px solid #e7e5e4;border-radius:6px;overflow:hidden;margin:0 0 16px;">
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;width:40%;">Upload ID</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;font-weight:600;">{{ upload_id }}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;">Status</td>
    <td style="padding:10px 16px;font-size:13px;color:#16a34a;font-weight:600;">Processed</td>
  </tr>
</table>
<p style="margin:0;font-size:15px;color:#44403c;line-height:1.6;">
  Visit your dashboard to review the tracks, check metadata, and approve them for the catalogue.
</p>
""",

"invite": """
<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1c1917;">You've been added to Tamasha</h2>
<p style="margin:0 0 16px;font-size:15px;color:#44403c;line-height:1.6;">
  Hi <strong>{{ username }}</strong>,<br>
  <strong>{{ invited_by }}</strong> has created a <strong>{{ role }}</strong> account for you on the Tamasha archive platform.
</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="border:1px solid #e7e5e4;border-radius:6px;overflow:hidden;margin:0 0 20px;">
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;width:40%;">Email</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;font-weight:600;">{{ email }}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;">Role</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;font-weight:600;">{{ role | title }}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;">Sign-in URL</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;font-weight:600;">{{ base_url }}/login</td>
  </tr>
</table>
<table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;">
  <tr><td style="background:#7c3aed;border-radius:6px;">
    <a href="{{ base_url }}/login"
       style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
      Sign In
    </a>
  </td></tr>
</table>
<p style="margin:0;font-size:13px;color:#78716c;line-height:1.6;">
  Use your email address and the password provided. You can update your password from account settings after signing in.
</p>
""",

"billing_reminder": """
{% if days_until_due == 0 %}
  {% set due_label = "today" %}
  {% set alert_bg = "#fef2f2" %}
  {% set alert_border = "#dc2626" %}
{% elif days_until_due == 1 %}
  {% set due_label = "tomorrow" %}
  {% set alert_bg = "#fef2f2" %}
  {% set alert_border = "#dc2626" %}
{% else %}
  {% set due_label = "in " + days_until_due | string + " days" %}
  {% set alert_bg = "#fef3c7" %}
  {% set alert_border = "#d97706" %}
{% endif %}

<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1c1917;">Invoice Payment Reminder</h2>

<div style="background:{{ alert_bg }};border-left:4px solid {{ alert_border }};padding:12px 16px;border-radius:0 4px 4px 0;margin:0 0 20px;">
  <p style="margin:0;font-size:14px;color:#1c1917;">
    Your invoice for <strong>{{ period_label }}</strong> is due <strong>{{ due_label }}</strong>.
  </p>
</div>

<!-- Invoice summary -->
<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="border:1px solid #e7e5e4;border-radius:6px;overflow:hidden;margin:0 0 20px;">
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;width:45%;">Period</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;font-weight:600;">{{ period_label }}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;">Due</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;font-weight:600;">{{ due_label | title }}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;">Total Due</td>
    <td style="padding:10px 16px;font-size:15px;color:#1c1917;font-weight:700;">${{ "%.2f" | format(amount_usd) }}</td>
  </tr>
</table>

{% if line_items %}
<!-- Line items -->
<p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:0.05em;">Invoice Breakdown</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="border:1px solid #e7e5e4;border-radius:6px;overflow:hidden;margin:0 0 20px;">
  <tr style="background:#f5f5f4;">
    <td style="padding:8px 16px;font-size:12px;font-weight:600;color:#78716c;border-bottom:1px solid #e7e5e4;">Description</td>
    <td style="padding:8px 16px;font-size:12px;font-weight:600;color:#78716c;border-bottom:1px solid #e7e5e4;text-align:right;">Amount</td>
  </tr>
  {% for item in line_items %}
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#44403c;border-bottom:1px solid #f5f5f4;">{{ item.description }}</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;font-weight:600;text-align:right;border-bottom:1px solid #f5f5f4;">${{ "%.2f" | format(item.amount_usd) }}</td>
  </tr>
  {% endfor %}
  <tr style="background:#f5f5f4;">
    <td style="padding:10px 16px;font-size:13px;font-weight:700;color:#1c1917;">Total</td>
    <td style="padding:10px 16px;font-size:14px;font-weight:700;color:#1c1917;text-align:right;">${{ "%.2f" | format(amount_usd) }}</td>
  </tr>
</table>
{% endif %}

<p style="margin:0;font-size:15px;color:#44403c;line-height:1.6;">
  Please log in to your billing dashboard to make payment and avoid service interruption.
</p>
""",

"payment_receipt": """
{% if is_paid_in_full %}
<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:0 4px 4px 0;margin:0 0 20px;">
  <p style="margin:0;font-size:14px;font-weight:600;color:#15803d;">Invoice fully paid — thank you!</p>
</div>
{% else %}
<div style="background:#fef3c7;border-left:4px solid #d97706;padding:12px 16px;border-radius:0 4px 4px 0;margin:0 0 20px;">
  <p style="margin:0;font-size:14px;color:#92400e;">Partial payment received — balance outstanding.</p>
</div>
{% endif %}

<h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#1c1917;">Payment Receipt</h2>
<p style="margin:0 0 24px;font-size:13px;color:#78716c;">Invoice #{{ invoice_id }} · {{ period_label }}</p>

<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="border:1px solid #e7e5e4;border-radius:6px;overflow:hidden;margin:0 0 24px;">
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;width:50%;">Payment Date</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;font-weight:600;">{{ payment_date }}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;">Amount Received</td>
    <td style="padding:10px 16px;font-size:15px;color:#16a34a;border-bottom:1px solid #e7e5e4;font-weight:700;">${{ "%.2f" | format(payment_amount_usd) }}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;">Invoice Total</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;font-weight:600;">${{ "%.2f" | format(invoice_amount_usd) }}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;">Total Paid</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;font-weight:600;">${{ "%.2f" | format(total_paid_usd) }}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;">Balance Remaining</td>
    {% if balance_usd <= 0 %}
    <td style="padding:10px 16px;font-size:13px;color:#16a34a;font-weight:700;">$0.00 — Paid in Full</td>
    {% else %}
    <td style="padding:10px 16px;font-size:13px;color:#dc2626;font-weight:700;">${{ "%.2f" | format(balance_usd) }}</td>
    {% endif %}
  </tr>
</table>

{% if line_items %}
<p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:0.05em;">Invoice Breakdown</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="border:1px solid #e7e5e4;border-radius:6px;overflow:hidden;margin:0 0 24px;">
  <tr style="background:#f5f5f4;">
    <td style="padding:8px 16px;font-size:12px;font-weight:600;color:#78716c;border-bottom:1px solid #e7e5e4;">Description</td>
    <td style="padding:8px 16px;font-size:12px;font-weight:600;color:#78716c;border-bottom:1px solid #e7e5e4;text-align:right;white-space:nowrap;">Amount</td>
  </tr>
  {% for item in line_items %}
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#44403c;border-bottom:1px solid #f5f5f4;">{{ item.description }}</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;font-weight:600;text-align:right;border-bottom:1px solid #f5f5f4;white-space:nowrap;">${{ "%.2f" | format(item.amount_usd) }}</td>
  </tr>
  {% endfor %}
  <tr style="background:#f5f5f4;">
    <td style="padding:12px 16px;font-size:14px;font-weight:700;color:#1c1917;">Total</td>
    <td style="padding:12px 16px;font-size:16px;font-weight:700;color:#1c1917;text-align:right;">${{ "%.2f" | format(invoice_amount_usd) }}</td>
  </tr>
</table>
{% endif %}

{% if notes %}
<p style="margin:0;font-size:13px;color:#78716c;line-height:1.6;font-style:italic;">Note: {{ notes }}</p>
{% endif %}
""",

"invoice_created": """
<h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:#1c1917;">Invoice — {{ period_label }}</h2>
<p style="margin:0 0 24px;font-size:13px;color:#78716c;">Invoice #{{ invoice_id }}</p>

<!-- Invoice meta -->
<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="border:1px solid #e7e5e4;border-radius:6px;overflow:hidden;margin:0 0 24px;">
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;width:45%;">Period</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;font-weight:600;">{{ period_label }}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;">Status</td>
    <td style="padding:10px 16px;font-size:13px;color:#d97706;border-bottom:1px solid #e7e5e4;font-weight:600;">Pending Payment</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;">Issue Date</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;font-weight:600;">{{ issued_date }}</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;">Due Date</td>
    <td style="padding:10px 16px;font-size:13px;color:#dc2626;font-weight:600;">{{ due_date }}</td>
  </tr>
</table>

<!-- Line items -->
<p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:0.05em;">Charges</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="border:1px solid #e7e5e4;border-radius:6px;overflow:hidden;margin:0 0 24px;">
  <tr style="background:#f5f5f4;">
    <td style="padding:8px 16px;font-size:12px;font-weight:600;color:#78716c;border-bottom:1px solid #e7e5e4;">Description</td>
    <td style="padding:8px 16px;font-size:12px;font-weight:600;color:#78716c;border-bottom:1px solid #e7e5e4;white-space:nowrap;">Type</td>
    <td style="padding:8px 16px;font-size:12px;font-weight:600;color:#78716c;border-bottom:1px solid #e7e5e4;text-align:right;white-space:nowrap;">Amount</td>
  </tr>
  {% for item in line_items %}
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#44403c;border-bottom:1px solid #f5f5f4;">{{ item.description }}</td>
    <td style="padding:10px 16px;font-size:12px;color:#78716c;border-bottom:1px solid #f5f5f4;white-space:nowrap;">{{ item.type | title }}</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;font-weight:600;text-align:right;border-bottom:1px solid #f5f5f4;white-space:nowrap;">${{ "%.2f" | format(item.amount_usd) }}</td>
  </tr>
  {% endfor %}
  <tr style="background:#f5f5f4;">
    <td colspan="2" style="padding:12px 16px;font-size:14px;font-weight:700;color:#1c1917;">Total Due</td>
    <td style="padding:12px 16px;font-size:16px;font-weight:700;color:#1c1917;text-align:right;white-space:nowrap;">${{ "%.2f" | format(amount_usd) }}</td>
  </tr>
</table>

<p style="margin:0;font-size:15px;color:#44403c;line-height:1.6;">
  Please log in to your billing dashboard to make payment before the due date to avoid service interruption.
</p>
""",

"data_export_ready": """
<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#1c1917;">Platform Data Export Ready</h2>

<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:12px 16px;border-radius:0 4px 4px 0;margin:0 0 20px;">
  <p style="margin:0;font-size:14px;color:#1c1917;">
    Your full platform data export has been prepared and is available for download.
  </p>
</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0"
       style="border:1px solid #e7e5e4;border-radius:6px;overflow:hidden;margin:0 0 20px;">
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;width:45%;">Contents</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;font-weight:600;">Tracks, Artists, Users, Billing records</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;">Audio files</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;">Remain in Cloudflare R2 — contact support for bulk download</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;border-bottom:1px solid #e7e5e4;">Download valid for</td>
    <td style="padding:10px 16px;font-size:13px;color:#1c1917;border-bottom:1px solid #e7e5e4;font-weight:600;">{{ download_days }} days</td>
  </tr>
  <tr>
    <td style="padding:10px 16px;font-size:13px;color:#78716c;background:#f5f5f4;">Expires</td>
    <td style="padding:10px 16px;font-size:13px;color:#dc2626;font-weight:600;">{{ expires_at[:10] }}</td>
  </tr>
</table>

<p style="margin:0;font-size:15px;color:#44403c;line-height:1.6;">
  Log in to your billing dashboard to access the download link.
</p>
""",

}

_jinja = Environment(loader=DictLoader(_TEMPLATES), autoescape=True)


# ── Email transport ───────────────────────────────────────────────────────────

# These email types are routed to INVOICE_EMAIL instead of the addressed recipient
_INVOICE_EMAIL_TYPES = {"invoice_created", "billing_reminder", "payment_receipt"}


def _parse_invoice_emails(raw: str) -> tuple[str, list[str]]:
    """Return (to, bcc_list) from a comma-separated INVOICE_EMAIL value."""
    parts = [e.strip() for e in raw.split(",") if e.strip()]
    return parts[0], parts[1:]


def _send_email(to_email: str, subject: str, html_body: str, *, use_invoice_email: bool = False) -> None:
    settings = get_settings()
    resend.api_key = settings.resend_api_key

    to: str
    bcc: list[str] = []

    if settings.sandbox_email:
        to = settings.sandbox_email
        logger.debug("email_sandbox_redirect", original_to=to_email, sandbox=to)
    elif use_invoice_email and settings.invoice_email:
        to, bcc = _parse_invoice_emails(settings.invoice_email)
    else:
        to = to_email

    payload: dict = {
        "from": settings.email_from,
        "to": [to],
        "subject": subject,
        "html": html_body,
    }
    if bcc:
        payload["bcc"] = bcc

    try:
        resend.Emails.send(payload)
        if bcc:
            logger.debug("email_sent_with_bcc", to=to, bcc=bcc, subject=subject)
    except Exception as exc:
        logger.error("email_send_failed", to=to, subject=subject, error=str(exc))
        raise


# ── Tasks ─────────────────────────────────────────────────────────────────────

@app.task(
    name="worker.tasks.email.send_verification",
    bind=True, max_retries=3, default_retry_delay=30,
    autoretry_for=(Exception,), retry_backoff=True,
)
def send_verification(self: Task, user_id: str, email: str, token: str) -> dict:
    settings = get_settings()
    html = _wrap(_jinja.get_template("verification").render(base_url=settings.app_base_url, token=token))
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
    html = _wrap(_jinja.get_template("password_reset").render(base_url=settings.app_base_url, token=token))
    _send_email(email, "Reset your Tamasha password", html)
    logger.info("password_reset_email_sent", user_id=user_id)
    return {"user_id": user_id, "sent": True}


@app.task(
    name="worker.tasks.email.send_suspicious_login",
    bind=True, max_retries=3, default_retry_delay=30,
    autoretry_for=(Exception,), retry_backoff=True,
)
def send_suspicious_login(self: Task, user_id: str, email: str, ip: str) -> dict:
    html = _wrap(_jinja.get_template("suspicious_login").render(ip=ip))
    _send_email(email, "New sign-in to your Tamasha account", html, use_invoice_email=True)
    logger.info("suspicious_login_email_sent", user_id=user_id, ip=ip)
    return {"user_id": user_id, "sent": True}


@app.task(
    name="worker.tasks.email.send_artist_approval",
    bind=True, max_retries=3, default_retry_delay=30,
    autoretry_for=(Exception,), retry_backoff=True,
)
def send_artist_approval(self: Task, user_id: str, email: str, status: str) -> dict:
    html = _wrap(_jinja.get_template("artist_approval").render(status=status))
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
    html = _wrap(_jinja.get_template("upload_complete").render(upload_id=upload_id))
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
    html = _wrap(_jinja.get_template("invite").render(
        base_url=settings.app_base_url, email=email,
        username=username, role=role, invited_by=invited_by,
    ))
    _send_email(email, "You have been added to Tamasha", html)
    logger.info("invite_email_sent", user_id=user_id, role=role)
    return {"user_id": user_id, "sent": True}


_BILLING_SUBJECTS = {
    "invoice_created":   "Invoice — Tamasha Platform",
    "payment_receipt":   "Payment Receipt — Tamasha Platform",
    "billing_reminder":  "Invoice Payment Reminder — Tamasha Platform",
    "data_export_ready": "Your Tamasha Data Export is Ready",
}


@app.task(
    name="worker.tasks.email.send_billing_notification",
    bind=True, max_retries=3, default_retry_delay=60,
    autoretry_for=(Exception,), retry_backoff=True,
)
def send_billing_notification(self: Task, email: str, email_type: str, context: dict) -> dict:
    html = _wrap(_jinja.get_template(email_type).render(**context))
    subject = _BILLING_SUBJECTS.get(email_type, "Tamasha Billing Notification")
    _send_email(email, subject, html, use_invoice_email=email_type in _INVOICE_EMAIL_TYPES)
    logger.info("billing_notification_sent", email_type=email_type, email=email)
    return {"email_type": email_type, "sent": True}
