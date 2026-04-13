# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
╔══════════════════════════════════════════════════════════════════════════════╗
║  Singra Vox – Zentrales E-Mail-Template-System                            ║
║                                                                            ║
║  Dieses Modul stellt ein wiederverwendbares, skalierbares HTML-Template    ║
║  bereit, das für ALLE transaktionalen E-Mails genutzt wird.               ║
║                                                                            ║
║  DESIGN-PRINZIPIEN:                                                        ║
║  • Ein Base-Template für alles (DRY)                                       ║
║  • Slot-System: Jede E-Mail übergibt nur ihren spezifischen Inhalt        ║
║  • Leicht erweiterbar: Neuen Typ? → Nur neue render_*()-Funktion          ║
║  • Branding: mauntingstudios im Footer, Fuchs-Logo im Header              ║
║  • Responsive: Funktioniert in Gmail, Outlook, Apple Mail, Thunderbird    ║
║  • Kommentiert: Jede Sektion erklärt, damit andere Devs schnell starten   ║
║                                                                            ║
║  ERWEITERUNG:                                                              ║
║  1. Neue Funktion erstellen: render_welcome_email(...)                     ║
║  2. _build_email() aufrufen mit title, body_html, etc.                    ║
║  3. In der Route: subject, text, html = render_welcome_email(...)         ║
║  4. send_email(to_email=..., subject=..., ...)                            ║
║                                                                            ║
║  ──────────────────────────────────────────────────────────────────────────║
║  © mauntingstudios                                                         ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""
from __future__ import annotations

from typing import Tuple, List
import html as html_mod


# ═══════════════════════════════════════════════════════════════════════════════
#  KONFIGURATION – Hier globale Werte ändern
# ═══════════════════════════════════════════════════════════════════════════════

# Branding-Farben (identisch mit dem Frontend CSS)
COLOR_BG = "#0a0a0a"            # Seiten-Hintergrund (fast schwarz)
COLOR_CARD = "#111113"          # Karten-Hintergrund
COLOR_CARD_BORDER = "#1e1e22"   # Karten-Rahmen
COLOR_ACCENT = "#06b6d4"        # Primärfarbe (Cyan/Teal – wie das Fuchs-Logo)
COLOR_ACCENT_LIGHT = "#22d3ee"  # Heller Akzent
COLOR_ACCENT_BG = "#06b6d4"     # Button-Hintergrund
COLOR_TEXT = "#e4e4e7"          # Haupttext (zinc-200)
COLOR_TEXT_MUTED = "#a1a1aa"    # Sekundärtext (zinc-400)
COLOR_TEXT_DIM = "#71717a"      # Gedimmter Text (zinc-500)
COLOR_CODE_BG = "#18181b"       # Code-Box Hintergrund (zinc-900)
COLOR_CODE_BORDER = "#27272a"   # Code-Box Rahmen (zinc-800)
COLOR_DIVIDER = "#27272a"       # Trennlinien (zinc-800)

# Unternehmensdaten
COMPANY_NAME = "mauntingstudios"
PRODUCT_NAME = "Singra Vox"

# Fox-Logo als Base64-encodiertes PNG (identisch mit dem Logo auf dem Login-Screen).
# 48x48px, optimiert auf ~4KB – klein genug für E-Mail-Inline.
# Hinweis: Die meisten E-Mail-Clients blockieren externe Bilder, daher inline als data URI.
FOX_LOGO_BASE64 = "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"


# ═══════════════════════════════════════════════════════════════════════════════
#  BASE-TEMPLATE – Die zentrale HTML-Vorlage
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Aufbau:
#  ┌──────────────────────────────────┐
#  │  [Fuchs-Logo]  SINGRA VOX       │  ← Header (immer gleich)
#  ├──────────────────────────────────┤
#  │  {title}                         │  ← Überschrift (variabel)
#  │  {body_html}                     │  ← Inhalt (variabel, beliebig komplex)
#  ├──────────────────────────────────┤
#  │  ─────────────────               │  ← Trennlinie
#  │  {footer_hint}                   │  ← Optionaler Hinweis-Text
#  │  © mauntingstudios              │  ← Immer gleich
#  └──────────────────────────────────┘
#

def _base_template(
    *,
    title: str,
    body_html: str,
    footer_hint: str = "",
    instance_name: str = "",
) -> str:
    """
    Baut das vollständige HTML-Template zusammen.

    Parameter:
        title       – Überschrift der E-Mail (z.B. "Verify your email")
        body_html   – Der eigentliche Inhalt als HTML-String
        footer_hint – Optionaler Sicherheitshinweis unten (z.B. "Wenn du das nicht warst...")
        instance_name – Name der Instanz (z.B. "Mein Gaming Server")

    Rückgabe:
        Fertiges HTML als String, bereit zum Versenden.
    """

    # Instance-Name im Header anzeigen (wenn vorhanden)
    instance_badge = ""
    if instance_name:
        instance_badge = f"""
        <span style="
            display: inline-block;
            margin-left: 10px;
            padding: 2px 10px;
            border-radius: 99px;
            background: {COLOR_CODE_BG};
            border: 1px solid {COLOR_CODE_BORDER};
            color: {COLOR_TEXT_MUTED};
            font-size: 11px;
            letter-spacing: 0.04em;
            vertical-align: middle;
        ">{html_mod.escape(instance_name)}</span>
        """

    # Footer-Hinweis (nur rendern wenn vorhanden)
    footer_hint_html = ""
    if footer_hint:
        footer_hint_html = f"""
        <p style="
            margin: 0 0 14px;
            color: {COLOR_TEXT_DIM};
            font-size: 12px;
            line-height: 1.5;
        ">{footer_hint}</p>
        """

    # ── Das eigentliche Template ──────────────────────────────────────────────
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="color-scheme" content="dark">
    <title>{html_mod.escape(title)}</title>
</head>
<body style="
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    background-color: {COLOR_BG};
    color: {COLOR_TEXT};
    -webkit-font-smoothing: antialiased;
">
    <!--
        Äußerer Container: Zentriert die E-Mail und setzt den dunklen Hintergrund.
        width=100% für Outlook-Kompatibilität.
    -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           width="100%" style="background-color: {COLOR_BG};">
        <tr>
            <td align="center" style="padding: 40px 16px;">

                <!-- Innere Karte: Max 520px breit, abgerundete Ecken -->
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"
                       width="520" style="
                    max-width: 520px;
                    width: 100%;
                    background-color: {COLOR_CARD};
                    border: 1px solid {COLOR_CARD_BORDER};
                    border-radius: 16px;
                    overflow: hidden;
                ">
                    <!-- ═══ HEADER ═══ -->
                    <!-- Logo + Produktname + optionaler Instance-Badge -->
                    <tr>
                        <td style="padding: 28px 32px 20px;">
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                                <tr>
                                    <!-- Fuchs-Logo (AI-generiertes PNG, identisch mit Login-Screen) -->
                                    <td style="vertical-align: middle; padding-right: 12px;">
                                        <img src="data:image/png;base64,{FOX_LOGO_BASE64}"
                                             alt="{PRODUCT_NAME}"
                                             width="36" height="36"
                                             style="display: block; border: 0; border-radius: 6px;">
                                    </td>
                                    <!-- Produktname -->
                                    <td style="vertical-align: middle;">
                                        <span style="
                                            font-size: 13px;
                                            font-weight: 600;
                                            letter-spacing: 0.1em;
                                            color: {COLOR_TEXT_MUTED};
                                            text-transform: uppercase;
                                        ">{PRODUCT_NAME}</span>
                                        {instance_badge}
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- ═══ TITEL ═══ -->
                    <tr>
                        <td style="padding: 0 32px 16px;">
                            <h1 style="
                                margin: 0;
                                font-size: 22px;
                                font-weight: 700;
                                color: {COLOR_TEXT};
                                line-height: 1.3;
                            ">{html_mod.escape(title)}</h1>
                        </td>
                    </tr>

                    <!-- ═══ BODY (variabel) ═══ -->
                    <!-- Hier wird der spezifische Inhalt der jeweiligen E-Mail eingefügt -->
                    <tr>
                        <td style="padding: 0 32px 24px;">
                            {body_html}
                        </td>
                    </tr>

                    <!-- ═══ FOOTER ═══ -->
                    <tr>
                        <td style="padding: 0 32px 28px;">
                            <!-- Trennlinie -->
                            <div style="
                                height: 1px;
                                background: {COLOR_DIVIDER};
                                margin: 0 0 18px;
                            "></div>

                            {footer_hint_html}

                            <!-- Copyright / Branding -->
                            <p style="
                                margin: 0;
                                color: {COLOR_TEXT_DIM};
                                font-size: 11px;
                                letter-spacing: 0.04em;
                            ">&copy; {COMPANY_NAME}</p>
                        </td>
                    </tr>
                </table>

            </td>
        </tr>
    </table>
</body>
</html>"""


# ═══════════════════════════════════════════════════════════════════════════════
#  BAUSTEINE – Wiederverwendbare HTML-Blöcke für den body_html-Slot
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Diese Funktionen erzeugen HTML-Fragmente, die in body_html eingesetzt werden.
#  So können verschiedene E-Mail-Typen die gleichen Bausteine kombinieren.
#

def _block_paragraph(text: str) -> str:
    """
    Ein einfacher Absatz mit Standard-Styling.
    Nutzung: _block_paragraph("Willkommen bei Singra Vox!")
    """
    return f"""<p style="
        margin: 0 0 16px;
        color: {COLOR_TEXT};
        font-size: 15px;
        line-height: 1.6;
    ">{text}</p>"""


def _block_code_box(code: str) -> str:
    """
    Große, zentrierte Code-Anzeige (für Verifizierungscodes, Reset-Codes).
    Der Code wird in einer dunklen Box mit breitem Letter-Spacing dargestellt.
    """
    return f"""<div style="
        margin: 4px 0 18px;
        padding: 20px;
        border-radius: 12px;
        background: {COLOR_CODE_BG};
        border: 1px solid {COLOR_CODE_BORDER};
        text-align: center;
    ">
        <span style="
            font-size: 34px;
            letter-spacing: 0.28em;
            font-weight: 700;
            color: {COLOR_TEXT};
            font-family: 'SF Mono', 'Consolas', 'Liberation Mono', monospace;
        ">{html_mod.escape(code)}</span>
    </div>"""


def _block_expiry_note(minutes: int) -> str:
    """
    Ablauf-Hinweis unter dem Code (z.B. "Dieser Code läuft in 15 Minuten ab.")
    """
    return f"""<p style="
        margin: 0 0 4px;
        color: {COLOR_TEXT_MUTED};
        font-size: 13px;
    ">This code expires in {minutes} minutes.</p>"""


def _block_button(url: str, label: str) -> str:
    """
    Call-to-Action Button (z.B. "Open Singra Vox", "Reset Password").
    Outlook-kompatibel durch table-basierten Button.
    """
    return f"""<table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="margin: 18px 0;">
        <tr>
            <td align="center" style="
                background: {COLOR_ACCENT_BG};
                border-radius: 10px;
            ">
                <a href="{html_mod.escape(url)}" target="_blank" style="
                    display: inline-block;
                    padding: 12px 28px;
                    color: #ffffff;
                    font-size: 14px;
                    font-weight: 600;
                    text-decoration: none;
                    letter-spacing: 0.02em;
                ">{html_mod.escape(label)}</a>
            </td>
        </tr>
    </table>"""


def _block_info_rows(rows: List[Tuple[str, str]]) -> str:
    """
    Key-Value Infoblock (z.B. für Willkommens-E-Mails).
    Beispiel: [("Server", "Gaming Hub"), ("Role", "Member")]
    """
    if not rows:
        return ""
    items = ""
    for label, value in rows:
        items += f"""<tr>
            <td style="
                padding: 6px 0;
                color: {COLOR_TEXT_MUTED};
                font-size: 13px;
                width: 120px;
                vertical-align: top;
            ">{html_mod.escape(label)}</td>
            <td style="
                padding: 6px 0;
                color: {COLOR_TEXT};
                font-size: 13px;
                vertical-align: top;
            ">{html_mod.escape(value)}</td>
        </tr>"""
    return f"""<table role="presentation" cellpadding="0" cellspacing="0" border="0"
                   style="margin: 8px 0 16px; width: 100%;">
        {items}
    </table>"""


# ═══════════════════════════════════════════════════════════════════════════════
#  RENDER-FUNKTIONEN – Jede E-Mail hat eine eigene Funktion
# ═══════════════════════════════════════════════════════════════════════════════
#
#  NEUE E-MAIL HINZUFÜGEN:
#  ────────────────────────
#  1. Funktion erstellen: def render_ZWECK_email(*, app_name, instance_name, ...) -> Tuple
#  2. body_html aus den Bausteinen zusammensetzen
#  3. _base_template() aufrufen
#  4. (subject, text_body, html_body) zurückgeben
#  5. In der Route importieren und verwenden
#

def render_verification_email(
    *,
    app_name: str,
    instance_name: str,
    code: str,
    expires_minutes: int,
) -> Tuple[str, str, str]:
    """
    E-Mail-Verifizierung bei Registrierung.
    Wird gesendet, wenn ein neuer Account erstellt wird.
    """
    title = "Verify your email"
    subject = f"{app_name}: {title}"

    # ── Plaintext-Version (für E-Mail-Clients ohne HTML) ──
    text_body = (
        f"{title}\n\n"
        f"Use the following code to finish setting up your account for "
        f"{instance_name or app_name}.\n\n"
        f"Your code: {code}\n\n"
        f"This code expires in {expires_minutes} minutes.\n\n"
        f"If you did not create this account, you can ignore this message.\n\n"
        f"---\n{COMPANY_NAME}"
    )

    # ── HTML-Version ──
    body_html = (
        _block_paragraph(
            f"Use the following code to finish setting up your account for "
            f"<strong>{html_mod.escape(instance_name or app_name)}</strong>."
        )
        + _block_code_box(code)
        + _block_expiry_note(expires_minutes)
    )

    html_body = _base_template(
        title=title,
        body_html=body_html,
        instance_name=instance_name,
        footer_hint="If you did not create this account, you can safely ignore this message.",
    )

    return subject, text_body, html_body


def render_password_reset_email(
    *,
    app_name: str,
    instance_name: str,
    code: str,
    expires_minutes: int,
) -> Tuple[str, str, str]:
    """
    Passwort-Reset-Code.
    Wird gesendet, wenn ein Nutzer "Passwort vergessen" anklickt.
    """
    title = "Reset your password"
    subject = f"{app_name}: {title}"

    text_body = (
        f"{title}\n\n"
        f"Use the following code to reset the password for your account on "
        f"{instance_name or app_name}.\n\n"
        f"Your code: {code}\n\n"
        f"This code expires in {expires_minutes} minutes.\n\n"
        f"If you did not request a password reset, you can ignore this message.\n\n"
        f"---\n{COMPANY_NAME}"
    )

    body_html = (
        _block_paragraph(
            f"Use the following code to reset the password for your account on "
            f"<strong>{html_mod.escape(instance_name or app_name)}</strong>."
        )
        + _block_code_box(code)
        + _block_expiry_note(expires_minutes)
    )

    html_body = _base_template(
        title=title,
        body_html=body_html,
        instance_name=instance_name,
        footer_hint="If you did not request a password reset, you can safely ignore this message.",
    )

    return subject, text_body, html_body


# ═══════════════════════════════════════════════════════════════════════════════
#  ZUSÄTZLICHE TEMPLATES (leicht erweiterbar)
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Die folgenden Templates zeigen, wie einfach neue E-Mail-Typen hinzugefügt
#  werden können. Sie nutzen die gleichen Bausteine und das gleiche Base-Template.
#

def render_welcome_email(
    *,
    app_name: str,
    instance_name: str,
    username: str,
    login_url: str = "",
) -> Tuple[str, str, str]:
    """
    Willkommens-E-Mail nach erfolgreicher Verifizierung.

    Kann optional aktiviert werden, wenn der Account-Flow das vorsieht.
    Zeigt den Benutzernamen und einen Link zum Login.
    """
    title = "Welcome to Singra Vox"
    subject = f"Welcome to {instance_name or app_name}!"

    text_body = (
        f"Welcome, {username}!\n\n"
        f"Your account on {instance_name or app_name} is ready.\n"
        f"You can now sign in and start chatting.\n\n"
        f"---\n{COMPANY_NAME}"
    )

    body_html = (
        _block_paragraph(
            f"Welcome, <strong>{html_mod.escape(username)}</strong>!"
        )
        + _block_paragraph(
            f"Your account on <strong>{html_mod.escape(instance_name or app_name)}</strong> "
            f"is ready. You can now sign in and start chatting."
        )
        + (_block_button(login_url, "Open Singra Vox") if login_url else "")
    )

    html_body = _base_template(
        title=title,
        body_html=body_html,
        instance_name=instance_name,
    )

    return subject, text_body, html_body


def render_invite_email(
    *,
    app_name: str,
    instance_name: str,
    inviter_name: str,
    server_name: str,
    invite_url: str,
) -> Tuple[str, str, str]:
    """
    Einladungs-E-Mail, wenn ein Nutzer per E-Mail zu einem Server eingeladen wird.

    Zeigt wer eingeladen hat, welcher Server, und einen Button zum Beitreten.
    """
    title = f"You've been invited to {server_name}"
    subject = f"{inviter_name} invited you to {server_name} on {app_name}"

    text_body = (
        f"{inviter_name} invited you to join \"{server_name}\" "
        f"on {instance_name or app_name}.\n\n"
        f"Join here: {invite_url}\n\n"
        f"---\n{COMPANY_NAME}"
    )

    body_html = (
        _block_paragraph(
            f"<strong>{html_mod.escape(inviter_name)}</strong> invited you to join:"
        )
        + _block_info_rows([
            ("Server", server_name),
            ("Instance", instance_name or app_name),
        ])
        + _block_button(invite_url, "Accept Invitation")
    )

    html_body = _base_template(
        title=title,
        body_html=body_html,
        instance_name=instance_name,
        footer_hint="If you don't recognize this invitation, you can safely ignore this message.",
    )

    return subject, text_body, html_body


def render_security_alert_email(
    *,
    app_name: str,
    instance_name: str,
    alert_type: str,
    details: str,
    action_url: str = "",
) -> Tuple[str, str, str]:
    """
    Sicherheits-Benachrichtigung (z.B. neuer Login von unbekanntem Gerät,
    Passwort geändert, 2FA aktiviert/deaktiviert).

    alert_type: z.B. "New login detected", "Password changed", "2FA enabled"
    details:    z.B. "Chrome on Windows, IP: 192.168.1.1"
    """
    title = f"Security Alert: {alert_type}"
    subject = f"{app_name}: {alert_type}"

    text_body = (
        f"Security Alert: {alert_type}\n\n"
        f"{details}\n\n"
        f"If this was you, no action is needed.\n"
        f"If this was NOT you, please secure your account immediately.\n\n"
        f"---\n{COMPANY_NAME}"
    )

    body_html = (
        _block_paragraph(details)
        + _block_paragraph(
            "If this was you, no action is needed. "
            "If this was <strong>not</strong> you, please secure your account immediately."
        )
        + (_block_button(action_url, "Review Account Security") if action_url else "")
    )

    html_body = _base_template(
        title=title,
        body_html=body_html,
        instance_name=instance_name,
        footer_hint="This is an automated security notification. Please do not reply to this email.",
    )

    return subject, text_body, html_body
