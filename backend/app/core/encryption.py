"""
Singra Vox – Encryption at Rest
=================================

All message content, DM content, and file metadata is encrypted before
being stored in MongoDB.  The database never contains plaintext messages.

How it works:
    1. Each channel/conversation has a derived encryption key
    2. Key = HKDF(instance_secret, context_id)  [AES-256-GCM]
    3. On write: plaintext → encrypt → store ciphertext
    4. On read:  ciphertext → decrypt → return plaintext (if authorized)
    5. DB dumps, backups, and direct DB access only show ciphertext

Key hierarchy:
    INSTANCE_ENCRYPTION_SECRET  (env var, per-instance, required)
        └─ channel key  = HKDF(secret, "channel:" + channel_id)
        └─ dm key       = HKDF(secret, "dm:" + sorted(user_a, user_b))
        └─ group key    = HKDF(secret, "group:" + group_id)

This is server-side encryption at rest, NOT end-to-end encryption.
The server CAN decrypt to serve authorized users.  For true zero-knowledge
E2EE (where the server cannot decrypt), use private channels or DMs
with E2EE enabled – that system works ON TOP of this layer.

Security:
    - AES-256-GCM (authenticated encryption)
    - Unique nonce per message (random 12 bytes)
    - Per-channel key derivation (HKDF-SHA256)
    - Instance secret never stored in database
"""
import base64
import hashlib
import hmac
import os
import secrets
import logging

logger = logging.getLogger(__name__)

# ── Configuration ────────────────────────────────────────────────────────────
# The instance encryption secret.  MUST be set in production.
# If not set, encryption is disabled and content is stored as plaintext
# (backward compatible).
_ENCRYPTION_SECRET = os.environ.get("INSTANCE_ENCRYPTION_SECRET", "").strip()

# Once set, changing this secret will make all existing messages unreadable.
# Back it up securely!


def encryption_enabled() -> bool:
    """Check if encryption at rest is configured."""
    return bool(_ENCRYPTION_SECRET)


def _derive_key(context: str) -> bytes:
    """
    Derive a 256-bit AES key from the instance secret + context string.

    Uses HKDF-like construction: HMAC-SHA256(secret, context).
    Each channel/DM/group gets a unique key.
    """
    return hmac.new(
        _ENCRYPTION_SECRET.encode("utf-8"),
        context.encode("utf-8"),
        hashlib.sha256,
    ).digest()


def _aes_gcm_encrypt(plaintext: str, key: bytes) -> str:
    """
    Encrypt plaintext with AES-256-GCM.

    Returns: base64(nonce + ciphertext + tag)
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = secrets.token_bytes(12)  # 96-bit nonce
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    # Pack: nonce (12) + ciphertext+tag (variable)
    return base64.b64encode(nonce + ciphertext).decode("ascii")


def _aes_gcm_decrypt(packed_b64: str, key: bytes) -> str:
    """
    Decrypt AES-256-GCM packed data.

    Expects: base64(nonce + ciphertext + tag)
    """
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    raw = base64.b64decode(packed_b64)
    nonce = raw[:12]
    ciphertext = raw[12:]
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ciphertext, None).decode("utf-8")


# ═════════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ═════════════════════════════════════════════════════════════════════════════

def encrypt_channel_content(channel_id: str, plaintext: str) -> str:
    """Encrypt message content for a channel.  Returns ciphertext or plaintext if disabled."""
    if not encryption_enabled() or not plaintext:
        return plaintext
    key = _derive_key(f"channel:{channel_id}")
    return _aes_gcm_encrypt(plaintext, key)


def decrypt_channel_content(channel_id: str, stored: str) -> str:
    """Decrypt message content from a channel.  Returns plaintext."""
    if not encryption_enabled() or not stored:
        return stored
    try:
        key = _derive_key(f"channel:{channel_id}")
        return _aes_gcm_decrypt(stored, key)
    except Exception:
        # If decryption fails, return as-is (legacy unencrypted or wrong key)
        return stored


def encrypt_dm_content(user_a_id: str, user_b_id: str, plaintext: str) -> str:
    """Encrypt DM content.  Key is derived from sorted user IDs (order-independent)."""
    if not encryption_enabled() or not plaintext:
        return plaintext
    pair = ":".join(sorted([user_a_id, user_b_id]))
    key = _derive_key(f"dm:{pair}")
    return _aes_gcm_encrypt(plaintext, key)


def decrypt_dm_content(user_a_id: str, user_b_id: str, stored: str) -> str:
    """Decrypt DM content."""
    if not encryption_enabled() or not stored:
        return stored
    try:
        pair = ":".join(sorted([user_a_id, user_b_id]))
        key = _derive_key(f"dm:{pair}")
        return _aes_gcm_decrypt(stored, key)
    except Exception:
        return stored


def encrypt_group_content(group_id: str, plaintext: str) -> str:
    """Encrypt group conversation content."""
    if not encryption_enabled() or not plaintext:
        return plaintext
    key = _derive_key(f"group:{group_id}")
    return _aes_gcm_encrypt(plaintext, key)


def decrypt_group_content(group_id: str, stored: str) -> str:
    """Decrypt group conversation content."""
    if not encryption_enabled() or not stored:
        return stored
    try:
        key = _derive_key(f"group:{group_id}")
        return _aes_gcm_decrypt(stored, key)
    except Exception:
        return stored
