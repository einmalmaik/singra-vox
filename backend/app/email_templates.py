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

from typing import Tuple, Optional, List
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

# Fox-Logo als Base64-encodiertes SVG-Inline (damit es in allen E-Mail-Clients funktioniert)
# Hinweis: Die meisten E-Mail-Clients blockieren externe Bilder, daher inline.
# Das hier ist ein minimalistisches Fuchs-Silhouette-SVG.
FOX_LOGO_SVG = """<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 512 512" fill="none"><polygon points="155,195 38,10 228,150" fill="#22d3ee"/><polygon points="162,188 82,55 215,155" fill="#155e75"/><polygon points="357,195 474,10 284,150" fill="#22d3ee"/><polygon points="350,188 430,55 297,155" fill="#155e75"/><path d="M 256 465 L 115 345 L 78 225 L 128 152 L 256 128 L 384 152 L 434 225 L 397 345 Z" fill="#0891b2"/><path d="M 256 295 L 185 328 L 178 378 L 218 428 L 256 442 L 294 428 L 334 378 L 327 328 Z" fill="#ecfeff"/><ellipse cx="185" cy="248" rx="40" ry="38" fill="#0c4a6e"/><ellipse cx="185" cy="252" rx="30" ry="28" fill="#e0f2fe"/><ellipse cx="192" cy="246" rx="16" ry="18" fill="#0e7490"/><circle cx="180" cy="240" r="7" fill="#ecfeff"/><ellipse cx="327" cy="248" rx="40" ry="38" fill="#0c4a6e"/><ellipse cx="327" cy="252" rx="30" ry="28" fill="#e0f2fe"/><ellipse cx="334" cy="246" rx="16" ry="18" fill="#0e7490"/><circle cx="322" cy="240" r="7" fill="#ecfeff"/><path d="M 256 352 L 242 374 Q 256 384 270 374 Z" fill="#164e63"/></svg>"""


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
                                    <!-- Fuchs-Logo (inline SVG als data URI) -->
                                    <td style="vertical-align: middle; padding-right: 12px;">
                                        <img src="data:image/svg+xml,{FOX_LOGO_SVG.replace('#', '%23').replace('"', '%22').replace('<', '%3C').replace('>', '%3E').replace(' ', '%20').replace('/', '%2F').replace('=', '%3D')}"
                                             alt="{PRODUCT_NAME}"
                                             width="36" height="36"
                                             style="display: block; border: 0;">
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
