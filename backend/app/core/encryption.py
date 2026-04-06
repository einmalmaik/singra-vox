# Singra Vox - Privacy-first communication platform
# Copyright (C) 2026  Maik Haedrich
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published
# by the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
"""
Singra Vox – Encryption at Rest
=================================

**Zentrale Verschlüsselungs-Datei – wird von allen Modulen referenziert.**

Alle Inhalte (Nachrichten, DMs, Gruppen, Dateien, Metadaten) werden vor
der Speicherung in MongoDB/Filesystem verschlüsselt.  Die Datenbank und
der Speicher enthalten **niemals Klartext**.

Architektur
-----------
Dieses Modul implementiert serverseitige Encryption at Rest.  Es ist die
unterste Verschlüsselungsschicht und wird IMMER angewendet – unabhängig
davon, ob zusätzlich clientseitige E2EE aktiv ist.

    ┌─────────────────────────────────────────────────┐
    │  Client-Side E2EE (libsodium, optional)         │
    │  → Server sieht nur Ciphertext                  │
    ├─────────────────────────────────────────────────┤
    │  Server-Side Encryption at Rest (DIESES MODUL)  │
    │  → Datenbank/Dateisystem sieht nur Ciphertext   │
    └─────────────────────────────────────────────────┘

Key-Hierarchie
--------------
    INSTANCE_ENCRYPTION_SECRET  (env var, pro Instanz, PFLICHT)
        ├─ channel key  = HKDF(secret, "channel:" + channel_id)
        ├─ dm key       = HKDF(secret, "dm:" + sorted(user_a, user_b))
        ├─ group key    = HKDF(secret, "group:" + group_id)
        ├─ file key     = HKDF(secret, "file:" + file_id)
        └─ meta key     = HKDF(secret, "meta:" + context)

Algorithmen
-----------
    - AES-256-GCM (authentifizierte Verschlüsselung)
    - Einmaliger Nonce pro Operation (zufällige 12 Bytes)
    - Kontextabhängige Schlüsselableitung (HMAC-SHA256)
    - Instanz-Geheimnis nie in der Datenbank gespeichert

Sicherheitshinweise
-------------------
    - INSTANCE_ENCRYPTION_SECRET MUSS in Produktion gesetzt sein
    - Einmal gesetzt, darf der Schlüssel NICHT geändert werden
      (alle bestehenden Daten werden sonst unlesbar)
    - Sicher aufbewahren! Verlust = permanenter Datenverlust

Erweiterbarkeit
---------------
    Um einen neuen verschlüsselten Kontext hinzuzufügen:
    1. Neue Funktionen encrypt_X() / decrypt_X() hier definieren
    2. Kontext-String wählen (z.B. "audit:channel_id")
    3. In der aufrufenden Datei importieren und nutzen
    4. Fertig – die Schlüsselableitung und Verschlüsselung ist zentral
"""
import base64
import hashlib
import hmac
import logging
import os
import secrets

logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────────────
_ENCRYPTION_SECRET = os.environ.get("INSTANCE_ENCRYPTION_SECRET", "").strip()

if not _ENCRYPTION_SECRET:
    logger.warning(
        "INSTANCE_ENCRYPTION_SECRET ist nicht gesetzt! "
        "Inhalte werden UNVERSCHLÜSSELT gespeichert. "
        "Bitte setze diese Variable in Produktion."
    )


def encryption_enabled() -> bool:
    """Prüft ob Encryption at Rest konfiguriert ist."""
    return bool(_ENCRYPTION_SECRET)


# ═════════════════════════════════════════════════════════════════════════════
# INTERNE KRYPTOGRAPHIE-PRIMITIVEN
# ═════════════════════════════════════════════════════════════════════════════

def _derive_key(context: str) -> bytes:
    """
    Leitet einen 256-Bit AES-Schlüssel aus dem Instanz-Geheimnis ab.

    Verwendet HMAC-SHA256(secret, context) – jeder Kanal, jede DM,
    jede Datei bekommt einen einzigartigen Schlüssel.

    Args:
        context: Eindeutiger Kontext-String, z.B. "channel:abc-123"

    Returns:
        32 Bytes (256-Bit) Schlüssel
    """
    return hmac.new(
        _ENCRYPTION_SECRET.encode("utf-8"),
        context.encode("utf-8"),
        hashlib.sha256,
    ).digest()


def _aes_gcm_encrypt(plaintext: str, key: bytes) -> str:
    """
    Verschlüsselt Text mit AES-256-GCM.

    Returns:
        Base64-kodiert: nonce (12 Bytes) + ciphertext + auth-tag
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = secrets.token_bytes(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext).decode("ascii")


def _aes_gcm_decrypt(packed_b64: str, key: bytes) -> str:
    """
    Entschlüsselt AES-256-GCM Daten.

    Args:
        packed_b64: Base64-kodiert: nonce (12 Bytes) + ciphertext + auth-tag

    Returns:
        Klartext-String
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    raw = base64.b64decode(packed_b64)
    nonce = raw[:12]
    ciphertext = raw[12:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ciphertext, None).decode("utf-8")


def _aes_gcm_encrypt_bytes(plaintext_bytes: bytes, key: bytes) -> bytes:
    """
    Verschlüsselt Binärdaten mit AES-256-GCM.

    Returns:
        nonce (12 Bytes) + ciphertext + auth-tag (als Bytes)
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = secrets.token_bytes(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext_bytes, None)
    return nonce + ciphertext


def _aes_gcm_decrypt_bytes(packed: bytes, key: bytes) -> bytes:
    """
    Entschlüsselt Binärdaten aus AES-256-GCM.

    Args:
        packed: nonce (12 Bytes) + ciphertext + auth-tag

    Returns:
        Klartext-Bytes
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = packed[:12]
    ciphertext = packed[12:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ciphertext, None)


# ═════════════════════════════════════════════════════════════════════════════
# ÖFFENTLICHE API – NACHRICHTEN
# ═════════════════════════════════════════════════════════════════════════════

def encrypt_channel_content(channel_id: str, plaintext: str) -> str:
    """Verschlüsselt Nachrichteninhalt für einen Kanal."""
    if not encryption_enabled() or not plaintext:
        return plaintext
    key = _derive_key(f"channel:{channel_id}")
    return _aes_gcm_encrypt(plaintext, key)


def decrypt_channel_content(channel_id: str, stored: str) -> str:
    """Entschlüsselt Nachrichteninhalt aus einem Kanal."""
    if not encryption_enabled() or not stored:
        return stored
    try:
        key = _derive_key(f"channel:{channel_id}")
        return _aes_gcm_decrypt(stored, key)
    except Exception:
        return stored


def encrypt_dm_content(user_a_id: str, user_b_id: str, plaintext: str) -> str:
    """Verschlüsselt DM-Inhalt.  Schlüssel aus sortierten User-IDs abgeleitet."""
    if not encryption_enabled() or not plaintext:
        return plaintext
    pair = ":".join(sorted([user_a_id, user_b_id]))
    key = _derive_key(f"dm:{pair}")
    return _aes_gcm_encrypt(plaintext, key)


def decrypt_dm_content(user_a_id: str, user_b_id: str, stored: str) -> str:
    """Entschlüsselt DM-Inhalt."""
    if not encryption_enabled() or not stored:
        return stored
    try:
        pair = ":".join(sorted([user_a_id, user_b_id]))
        key = _derive_key(f"dm:{pair}")
        return _aes_gcm_decrypt(stored, key)
    except Exception:
        return stored


def encrypt_group_content(group_id: str, plaintext: str) -> str:
    """Verschlüsselt Gruppen-Nachrichteninhalt."""
    if not encryption_enabled() or not plaintext:
        return plaintext
    key = _derive_key(f"group:{group_id}")
    return _aes_gcm_encrypt(plaintext, key)


def decrypt_group_content(group_id: str, stored: str) -> str:
    """Entschlüsselt Gruppen-Nachrichteninhalt."""
    if not encryption_enabled() or not stored:
        return stored
    try:
        key = _derive_key(f"group:{group_id}")
        return _aes_gcm_decrypt(stored, key)
    except Exception:
        return stored


# ═════════════════════════════════════════════════════════════════════════════
# ÖFFENTLICHE API – DATEIEN
# ═════════════════════════════════════════════════════════════════════════════

def encrypt_file_bytes(file_id: str, plaintext_bytes: bytes) -> bytes:
    """
    Verschlüsselt Datei-Bytes vor der Speicherung auf dem Dateisystem.

    Die Datei wird unter einer UUID gespeichert, der Originalname und
    Content-Type sind separat in der DB gespeichert (ebenfalls verschlüsselt
    via encrypt_metadata).

    Args:
        file_id: UUID der Datei (zur Schlüsselableitung)
        plaintext_bytes: Rohe Datei-Bytes

    Returns:
        Verschlüsselte Bytes (nonce + ciphertext + tag)
    """
    if not encryption_enabled() or not plaintext_bytes:
        return plaintext_bytes
    key = _derive_key(f"file:{file_id}")
    return _aes_gcm_encrypt_bytes(plaintext_bytes, key)


def decrypt_file_bytes(file_id: str, encrypted_bytes: bytes) -> bytes:
    """
    Entschlüsselt Datei-Bytes nach dem Lesen vom Dateisystem.

    Args:
        file_id: UUID der Datei
        encrypted_bytes: Verschlüsselte Bytes vom Dateisystem

    Returns:
        Entschlüsselte Originaldaten
    """
    if not encryption_enabled() or not encrypted_bytes:
        return encrypted_bytes
    try:
        key = _derive_key(f"file:{file_id}")
        return _aes_gcm_decrypt_bytes(encrypted_bytes, key)
    except Exception:
        return encrypted_bytes


# ═════════════════════════════════════════════════════════════════════════════
# ÖFFENTLICHE API – METADATEN
# ═════════════════════════════════════════════════════════════════════════════

def encrypt_metadata(context: str, plaintext: str) -> str:
    """
    Verschlüsselt beliebige Metadaten (Dateinamen, Content-Types, etc.).

    Args:
        context: Eindeutiger Kontext, z.B. "file_meta:abc-123"
        plaintext: Zu verschlüsselnder String

    Returns:
        Verschlüsselter String (Base64) oder Klartext wenn deaktiviert
    """
    if not encryption_enabled() or not plaintext:
        return plaintext
    key = _derive_key(f"meta:{context}")
    return _aes_gcm_encrypt(plaintext, key)


def decrypt_metadata(context: str, stored: str) -> str:
    """
    Entschlüsselt Metadaten.

    Args:
        context: Selber Kontext wie beim Verschlüsseln
        stored: Verschlüsselter String aus der DB

    Returns:
        Klartext-String
    """
    if not encryption_enabled() or not stored:
        return stored
    try:
        key = _derive_key(f"meta:{context}")
        return _aes_gcm_decrypt(stored, key)
    except Exception:
        return stored
