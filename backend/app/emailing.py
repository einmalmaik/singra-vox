# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Mail delivery helpers for transactional Singra Vox emails.

The backend keeps SMTP transport in this small module so auth flows can reuse
it without sprinkling connection details across route handlers.

Templates are defined in email_templates.py (central, reusable, branded).
This module only handles: settings, message assembly, SMTP delivery.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from email.message import EmailMessage
import logging
import os
import smtplib

from app.email_templates import (
    render_invite_email,
    render_password_reset_email,
    render_security_alert_email,
    render_verification_email,
    render_welcome_email,
)

__all__ = [
    "MailSettings",
    "load_mail_settings",
    "send_email",
    "render_invite_email",
    "render_password_reset_email",
    "render_security_alert_email",
    "render_verification_email",
    "render_welcome_email",
]

logger = logging.getLogger(__name__)

# ── Re-export render functions so existing imports keep working ────────────────
# Routes that do `from app.emailing import render_verification_email` will
# continue to work without changes.


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
    except Exception as exc:
        logger.exception("Failed to deliver email to %s", to_email)
        raise RuntimeError("Failed to deliver email") from exc
