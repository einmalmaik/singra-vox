# Singra Vox – Verschlüsselungs-Dokumentation

## Überblick

Singra Vox implementiert ein **Zwei-Schichten-Verschlüsselungsmodell**.
Das Ziel: **Kein Klartext in der Datenbank, kein Klartext auf dem Dateisystem.**

---

## Schicht 1: Server-Side Encryption at Rest

### Zweck
Schützt gegen:
- Datenbank-Leaks (gestohlene Backups, kompromittierte DB)
- Unautorisierter physischer Zugriff auf den Server
- DB-Admin-Zugriff (Admin sieht nur Ciphertext)

### Implementierung

**Zentrale Datei:** `backend/app/core/encryption.py`

```
INSTANCE_ENCRYPTION_SECRET (Umgebungsvariable, 64 Hex-Zeichen)
         │
         ▼
    HMAC-SHA256(secret, context_string)
         │
         ▼
    AES-256-GCM(derived_key, nonce, plaintext)
         │
         ▼
    Base64(nonce + ciphertext + auth_tag)  →  MongoDB / Disk
```

### Kontexte und Schlüsselableitung

| Kontext-String | Funktion | Genutzt von |
|---------------|----------|-------------|
| `channel:<channel_id>` | `encrypt_channel_content()` | Kanal-Nachrichten |
| `dm:<sorted_user_ids>` | `encrypt_dm_content()` | Direkt-Nachrichten |
| `group:<group_id>` | `encrypt_group_content()` | Gruppen-DMs |
| `file:<file_id>` | `encrypt_file_bytes()` | Datei-Bytes auf Disk |
| `meta:file_meta:<file_id>` | `encrypt_metadata()` | Dateiname in DB |
| `meta:file_ct:<file_id>` | `encrypt_metadata()` | Content-Type in DB |

### Sicherheits-Eigenschaften

- **Einzigartiger Schlüssel pro Kontext** – Kompromittierung eines Channel-Keys
  gefährdet keine DMs oder anderen Channels
- **Einzigartiger Nonce pro Operation** – Kein Nonce wird wiederverwendet
- **Authentifizierte Verschlüsselung** – AES-GCM erkennt Manipulationen
- **Kein Klartext im RAM** nach Verarbeitung (Python GC räumt auf)

### Code-Beispiel: Verschlüsselter Speicher-Flow

```python
# Beim SENDEN einer Nachricht (main.py):
from app.core.encryption import encrypt_channel_content, encryption_enabled

content = "Hallo Welt!"
stored = encrypt_channel_content(channel_id, content)
# stored = "gmEJvCuw..." (Base64-Ciphertext)

await db.messages.insert_one({
    "content": stored,              # ← Ciphertext in DB
    "encrypted_at_rest": True,      # ← Flag für Entschlüsselung
    ...
})

# Beim LESEN einer Nachricht:
from app.core.encryption import decrypt_channel_content

msg = await db.messages.find_one({"id": msg_id})
if msg.get("encrypted_at_rest") and not msg.get("is_e2ee"):
    msg["content"] = decrypt_channel_content(channel_id, msg["content"])
# msg["content"] = "Hallo Welt!"  ← Klartext für berechtigten User
```

---

## Schicht 2: Client-Side End-to-End Encryption (E2EE)

### Zweck
Schützt gegen:
- Server-Kompromittierung (Server kann nicht entschlüsseln)
- Man-in-the-Middle (Schlüssel nur auf Endgeräten)
- Instanz-Admin-Zugriff (Admin sieht nur E2EE-Ciphertext)

### Implementierung

**Frontend-Dateien:**
- `frontend/src/lib/e2ee/crypto.js` – Kryptographie-Primitiven
- `frontend/src/lib/e2ee/media.js` – Verschlüsselte Voice (LiveKit SFrame)
- `frontend/src/lib/e2ee/deviceStorage.js` – Schlüssel-Persistenz
- `frontend/src/contexts/E2EEContext.js` – React Context für E2EE-State

### Algorithmen

| Operation | Algorithmus | Bibliothek |
|-----------|------------|------------|
| Schlüssel-Generierung | X25519 (Curve25519) | libsodium |
| Nachrichten-Verschlüsselung | XChaCha20-Poly1305 | libsodium |
| Key-Exchange (Sealed Box) | X25519 + XSalsa20-Poly1305 | libsodium |
| Datei-Verschlüsselung | XChaCha20-Poly1305 | libsodium |
| Recovery-Key | Argon2id → XSalsa20-Poly1305 | libsodium |
| Voice/Video | SFrame | LiveKit-nativ |
| Fingerprint | BLAKE2b (16 Bytes) | libsodium |

### Geräte-basiertes Schlüssel-Management

```
Benutzer
    │
    ├── Gerät A (Desktop)
    │   ├── device_id: "abc-123"
    │   ├── public_key: "X25519..."    →  Im Server gespeichert
    │   └── private_key: "..."          →  Im OS-Keychain (Windows/macOS/Linux)
    │
    ├── Gerät B (Web)
    │   ├── device_id: "def-456"
    │   ├── public_key: "X25519..."    →  Im Server gespeichert
    │   └── private_key: "..."          →  In localStorage (weniger sicher)
    │
    └── Recovery-Key
        ├── public_key: "..."           →  Im Server
        └── private_key: verschlüsselt  →  Passwort-geschützt (Argon2id)
```

### Nachrichten-Verschlüsselungs-Flow

```
1. Sender generiert Message-Key (zufällig, 32 Bytes)

2. Sender verschlüsselt Nachricht:
   XChaCha20-Poly1305(message_key, nonce, plaintext) → ciphertext

3. Sender erstellt Key-Envelopes (pro Empfänger-Gerät):
   crypto_box_seal(message_key, recipient_device_public_key) → sealed_key

4. Sender sendet an Server:
   {
     ciphertext: "...",
     nonce: "...",
     key_envelopes: [
       { device_id: "abc", sealed_key: "..." },
       { device_id: "def", sealed_key: "..." },
     ]
   }

5. Server speichert Ciphertext as-is (kann nicht entschlüsseln!)
   + Schicht 1 verschlüsselt nochmal für DB-at-rest

6. Empfänger öffnet sein Key-Envelope:
   crypto_box_seal_open(sealed_key, own_public, own_private) → message_key

7. Empfänger entschlüsselt Nachricht:
   XChaCha20-Poly1305_open(message_key, nonce, ciphertext) → plaintext
```

### Verschlüsselte Voice-Channels (SFrame)

```
1. Erster Teilnehmer generiert Media-Key (32 Bytes)
2. Media-Key wird per Key-Envelopes an alle Teilnehmer verteilt
3. LiveKit ExternalE2EEKeyProvider erhält den Schlüssel
4. SFrame-Worker verschlüsselt jeden Audio/Video-Frame
5. LiveKit SFU leitet nur verschlüsselte Frames weiter
6. Bei Teilnehmer-Wechsel: automatische Key-Rotation
```

---

## Datei-Verschlüsselung

### Server-Side (immer aktiv)

```
Upload:
  raw_bytes → encrypt_file_bytes(file_id, bytes) → encrypted_bytes → Disk

  original_name → encrypt_metadata("file_meta:id", name) → DB
  content_type  → encrypt_metadata("file_ct:id", ct)     → DB

Download:
  Disk → encrypted_bytes → decrypt_file_bytes(file_id, bytes) → raw_bytes → User

  DB → encrypted_name → decrypt_metadata("file_meta:id") → original_name
  DB → encrypted_ct   → decrypt_metadata("file_ct:id")   → content_type
```

### Client-Side E2EE (für private Kanäle/DMs)

```
Upload:
  Browser → encryptBinaryPayload(file_bytes, key) → ciphertext_blob → S3/Server
  (Server speichert nur den opaken Ciphertext-Blob)

Download:
  S3/Server → ciphertext_blob → decryptBinaryPayload(blob, nonce, key) → file_bytes
  (Entschlüsselung nur im Browser/App)
```

---

## Metadaten-Minimierung

### Was wird NICHT gespeichert
- IP-Adressen der Benutzer
- Geräte-Fingerprints
- Lese-Zeitpunkte anderer Benutzer (nur eigene Read-States)
- Tipp-Indikatoren werden nicht persistiert

### Was verschlüsselt gespeichert wird
- Nachrichteninhalte
- Datei-Originalnamen
- Content-Types
- Datei-Bytes

### Was als Hash gespeichert wird (nicht umkehrbar)
- Passwörter (Argon2id)
- TOTP-Backup-Codes (SHA-256)
- OAuth2 Client-Secrets (SHA-256)
- Authorization-Codes (SHA-256)

### Was im Klartext bleibt (notwendig für Funktionalität)
- User-IDs (UUIDs, nicht identifizierend)
- Kanal-IDs, Server-IDs
- Zeitstempel (für Sortierung)
- Rollen und Berechtigungen (für Zugriffskontrolle)

---

## Erweiterbarkeit

### Neuen verschlüsselten Kontext hinzufügen

**Schritt 1:** In `backend/app/core/encryption.py`:
```python
def encrypt_new_type(context_id: str, plaintext: str) -> str:
    if not encryption_enabled() or not plaintext:
        return plaintext
    key = _derive_key(f"new_type:{context_id}")
    return _aes_gcm_encrypt(plaintext, key)

def decrypt_new_type(context_id: str, stored: str) -> str:
    if not encryption_enabled() or not stored:
        return stored
    try:
        key = _derive_key(f"new_type:{context_id}")
        return _aes_gcm_decrypt(stored, key)
    except Exception:
        return stored
```

**Schritt 2:** In der nutzenden Route importieren:
```python
from app.core.encryption import encrypt_new_type, decrypt_new_type
```

**Fertig.** Die Schlüsselableitung, Nonce-Generierung und AES-GCM-Operationen
sind komplett zentral.  Keine Kryptographie-Logik in den Routes.

### Verschlüsselungs-Algorithmus ändern

Alle Kryptographie ist in `encryption.py` gekapselt.  Um z.B. auf
ChaCha20-Poly1305 umzusteigen:

1. Nur `_aes_gcm_encrypt()` und `_aes_gcm_decrypt()` ändern
2. Alle Module, die `encrypt_*()` / `decrypt_*()` aufrufen, sind automatisch aktualisiert
3. Migration: Altes Format erkennen (try/except), neues Format für neue Daten

---

## Sicherheits-Checkliste

- [x] Kein Klartext in MongoDB (Nachrichten, DMs, Gruppen)
- [x] Kein Klartext auf Disk (Datei-Bytes verschlüsselt)
- [x] Datei-Metadaten verschlüsselt (Name, Content-Type)
- [x] Passwörter: Argon2id (nicht umkehrbar)
- [x] JWT-Tokens: zeitlich begrenzt, signiert
- [x] TOTP 2FA: verfügbar für alle Accounts
- [x] E2EE: XChaCha20-Poly1305 + X25519 für private Kanäle
- [x] Voice E2EE: SFrame über LiveKit
- [x] Berechtigungsprüfung vor Entschlüsselung
- [x] Zentrale Verschlüsselungs-Datei (wartbar, erweiterbar)
- [x] Pro-Kontext Schlüsselableitung (Isolation)
- [x] Minimale Metadaten-Speicherung
