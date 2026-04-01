"""
Mail delivery helpers for transactional Singra Vox emails.

The backend keeps email templating and SMTP transport in one small module so
auth flows can reuse it without sprinkling connection details across route
handlers.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from email.message import EmailMessage
import logging
import os
import smtplib
from typing import Tuple

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class MailSettings:
    host: str
    port: int
    username: str
    password: str
    from_email: str
    from_name: str
    use_tls: bool
    use_ssl: bool


def load_mail_settings() -> MailSettings:
    return MailSettings(
        host=os.environ.get("SMTP_HOST", "").strip(),
        port=int(os.environ.get("SMTP_PORT", "1025")),
        username=os.environ.get("SMTP_USERNAME", "").strip(),
        password=os.environ.get("SMTP_PASSWORD", "").strip(),
        from_email=os.environ.get("SMTP_FROM_EMAIL", "no-reply@singravox.local").strip(),
        from_name=os.environ.get("SMTP_FROM_NAME", "Singra Vox").strip(),
        use_tls=os.environ.get("SMTP_USE_TLS", "false").lower() == "true",
        use_ssl=os.environ.get("SMTP_USE_SSL", "false").lower() == "true",
    )


def _render_code_email(
    *,
    app_name: str,
    instance_name: str,
    title: str,
    intro: str,
    code: str,
    expires_minutes: int,
    outro: str,
) -> Tuple[str, str, str]:
    subject = f"{app_name}: {title}"
    text_body = (
        f"{title} for {instance_name or app_name}\n\n"
        f"{intro}\n\n"
        f"Your code is: {code}\n\n"
        f"This code expires in {expires_minutes} minutes.\n"
        f"{outro}"
    )
    html_body = f"""
    <html>
      <body style="font-family: Arial, sans-serif; background: #0a0a0a; color: #ffffff; padding: 24px;">
        <div style="max-width: 520px; margin: 0 auto; background: #121212; border: 1px solid #27272A; border-radius: 16px; padding: 24px;">
          <p style="margin: 0 0 12px; color: #A1A1AA; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase;">
            {app_name}
          </p>
          <h1 style="margin: 0 0 12px; font-size: 24px;">{title}</h1>
          <p style="margin: 0 0 18px; color: #D4D4D8; line-height: 1.6;">
            {intro}
            <strong>{instance_name or app_name}</strong>.
          </p>
          <div style="margin: 0 0 18px; padding: 18px; border-radius: 14px; background: #18181B; border: 1px solid #27272A; text-align: center;">
            <span style="font-size: 34px; letter-spacing: 0.28em; font-weight: 700;">{code}</span>
          </div>
          <p style="margin: 0 0 8px; color: #A1A1AA;">This code expires in {expires_minutes} minutes.</p>
          <p style="margin: 0; color: #71717A; font-size: 13px;">
            {outro}
          </p>
        </div>
      </body>
    </html>
    """.strip()
    return subject, text_body, html_body


def render_verification_email(
    *,
    app_name: str,
    instance_name: str,
    code: str,
    expires_minutes: int,
) -> Tuple[str, str, str]:
    return _render_code_email(
        app_name=app_name,
        instance_name=instance_name,
        title="Verify your email",
        intro="Use the following code to finish setting up your account for",
        code=code,
        expires_minutes=expires_minutes,
        outro="If you did not create this account, you can ignore this message.",
    )


def render_password_reset_email(
    *,
    app_name: str,
    instance_name: str,
    code: str,
    expires_minutes: int,
) -> Tuple[str, str, str]:
    return _render_code_email(
        app_name=app_name,
        instance_name=instance_name,
        title="Reset your password",
        intro="Use the following code to reset the password for",
        code=code,
        expires_minutes=expires_minutes,
        outro="If you did not request a password reset, you can ignore this message.",
    )


def _deliver_message(message: EmailMessage, settings: MailSettings) -> None:
    if not settings.host:
        raise RuntimeError("SMTP is not configured")

    if settings.use_ssl:
        with smtplib.SMTP_SSL(settings.host, settings.port, timeout=20) as client:
            if settings.username:
                client.login(settings.username, settings.password)
            client.send_message(message)
        return

    with smtplib.SMTP(settings.host, settings.port, timeout=20) as client:
        if settings.use_tls:
            client.starttls()
        if settings.username:
            client.login(settings.username, settings.password)
        client.send_message(message)


async def send_email(
    *,
    to_email: str,
    subject: str,
    text_body: str,
    html_body: str,
) -> None:
    settings = load_mail_settings()
    message = EmailMessage()
    sender_name = settings.from_name or "Singra Vox"
    message["From"] = f"{sender_name} <{settings.from_email}>"
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    try:
        await asyncio.to_thread(_deliver_message, message, settings)
    except Exception as exc:  # pragma: no cover - exercised through API smoke.
        logger.exception("Failed to deliver email to %s", to_email)
        raise RuntimeError("Failed to deliver email") from exc
