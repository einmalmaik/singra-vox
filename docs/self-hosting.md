# Singra Vox – Self-Hosting-Handbuch

## Inhaltsverzeichnis

1. [Übersicht](#übersicht)
2. [Voraussetzungen](#voraussetzungen)
3. [Schnellstart](#schnellstart)
4. [Umgebungsvariablen](#umgebungsvariablen)
5. [Authentifizierungs-Modi](#authentifizierungs-modi)
6. [Ende-zu-Ende-Verschlüsselung](#ende-zu-ende-verschlüsselung)
7. [LiveKit (Voice/Video)](#livekit-voicevideo)
8. [E-Mail-Konfiguration](#e-mail-konfiguration)
9. [Datei-Speicherung](#datei-speicherung)
10. [Produktion](#produktion)
11. [Wartung & Backup](#wartung--backup)
12. [Erweiterbarkeit](#erweiterbarkeit)
13. [Fehlerbehebung](#fehlerbehebung)

---

## Übersicht

Singra Vox ist eine **privacy-first Kommunikationsplattform** für Text, Voice und Video.
Jeder kann eine eigene Instanz hosten.  Alle Daten bleiben auf deinem Server.

**Architektur:**
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   React-App  │────▶│  FastAPI-API  │────▶│   MongoDB    │
│  (Frontend)  │     │  (Backend)    │     │  (Datenbank) │
└──────────────┘     └───────┬───────┘     └──────────────┘
                             │
                     ┌───────▼───────┐
                     │   LiveKit     │
                     │  (Voice/Video)│
                     └───────────────┘
```

---

## Voraussetzungen

| Komponente | Minimum | Empfohlen |
|------------|---------|-----------|
| RAM | 2 GB | 4+ GB |
| CPU | 1 vCPU | 2+ vCPU |
| Disk | 10 GB | 50+ GB |
| OS | Ubuntu 22.04 / Debian 12 | Ubuntu 24.04 |
| MongoDB | 6.0 | 7.0+ |
| Python | 3.11 | 3.12+ |
| Node.js | 18 | 20+ |

**Zusätzlich benötigt:**
- LiveKit-Server (self-hosted oder [LiveKit Cloud](https://livekit.io))
- SMTP-Server für E-Mails (z.B. Resend, Mailgun, eigener Postfix)
- Optional: S3-kompatibler Speicher für verschlüsselte Datei-Anhänge

---

## Schnellstart

### Option A: Automatischer Installer (empfohlen)

```bash
git clone https://github.com/einmalmaik/singra-vox.git
cd singra-vox
bash install.sh
```

Der Installer führt dich durch alles:
- Docker-Installation (automatisch falls nötig)
- Datenbank, Verschlüsselungsschlüssel, Secrets (auto-generiert)
- Speicher-Modus (Lite/Voll), Installations-Modus (HTTP/HTTPS)
- Admin-Account, SMTP, LiveKit
- Optional: Singra Vox ID, automatische Updates

**Nach der Installation:**
```bash
bash install.sh --status          # System-Status & Diagnose
bash install.sh --repair          # Konfiguration prüfen & reparieren
bash install.sh --update          # Auf neueste Version aktualisieren
bash install.sh --identity        # Singra Vox ID einrichten
bash install.sh --auto-update-on  # Tägliche Auto-Updates aktivieren
```

### Option B: Manuelle Installation

```bash
# 1. Clone
git clone https://github.com/einmalmaik/singra-vox.git
cd singra-vox

# 2. Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Jede Variable konfigurieren (siehe Abschnitt "Umgebungsvariablen")

# 3. Frontend
cd ../frontend
yarn install
cp .env.example .env

# 4. Starten
# Backend (Terminal 1):
cd backend && uvicorn server:app --host 0.0.0.0 --port 8001

# Frontend (Terminal 2):
cd frontend && yarn start
```

### 5. Ersteinrichtung
Öffne `https://deine-domain.de` im Browser.  Du siehst den **Setup-Wizard**.
- Instanzname wählen
- Owner-Account erstellen
- Fertig!

---

## Umgebungsvariablen

### Backend (`backend/.env`)

#### Pflicht-Variablen

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `MONGO_URL` | MongoDB-Verbindungs-URL | `mongodb://localhost:27017` |
| `DB_NAME` | Datenbankname | `singravox` |
| `JWT_SECRET` | Geheimnis für JWT-Tokens (min. 32 Zeichen) | `python3 -c "import secrets;print(secrets.token_hex(32))"` |
| `FRONTEND_URL` | Öffentliche URL des Frontends | `https://chat.example.com` |
| `INSTANCE_ENCRYPTION_SECRET` | **KRITISCH** – Verschlüsselungsschlüssel für alle Daten | `python3 -c "import secrets;print(secrets.token_hex(32))"` |

> **WARNUNG:** `INSTANCE_ENCRYPTION_SECRET` einmal gesetzt, NIEMALS ändern!
> Alle bestehenden Nachrichten und Dateien werden sonst unlesbar.
> **Diesen Schlüssel sicher aufbewahren!**

#### LiveKit

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `LIVEKIT_URL` | LiveKit-Server WebSocket-URL | `wss://livekit.example.com` |
| `LIVEKIT_API_KEY` | LiveKit API-Key | `APIxxxxx` |
| `LIVEKIT_API_SECRET` | LiveKit API-Secret | `geheim123` |

#### E-Mail (SMTP)

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `SMTP_HOST` | SMTP-Serveradresse | `smtp.resend.com` |
| `SMTP_PORT` | SMTP-Port | `465` (SSL) oder `587` (TLS) |
| `SMTP_USERNAME` | SMTP-Benutzername | `resend` |
| `SMTP_PASSWORD` | SMTP-Passwort / API-Key | `re_xxx` |
| `SMTP_FROM_EMAIL` | Absender-E-Mail-Adresse | `noreply@example.com` |
| `SMTP_FROM_NAME` | Absendername | `Singra Vox` |
| `SMTP_USE_SSL` | SSL verwenden (Port 465) | `true` |
| `SMTP_USE_TLS` | STARTTLS verwenden (Port 587) | `false` |

#### Singra Vox ID (Identitäts-Server)

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `SVID_ISSUER` | Öffentliche URL dieser Instanz | `https://chat.example.com` |
| `SVID_JWT_SECRET` | JWT-Geheimnis für SVID-Tokens | `python3 -c "import secrets;print(secrets.token_hex(32))"` |

#### Optional

| Variable | Beschreibung | Standard |
|----------|-------------|---------|
| `S3_ENDPOINT_URL` | S3-Endpunkt für verschlüsselte Blobs | _(leer = lokaler Speicher)_ |
| `S3_ACCESS_KEY` | S3-Zugangsdaten | _(leer)_ |
| `S3_SECRET_KEY` | S3-Geheimschlüssel | _(leer)_ |
| `S3_BUCKET` | S3-Bucket-Name | `singravox-e2ee` |
| `COOKIE_SECURE` | Secure-Flag für Cookies | `true` |

### Frontend (`frontend/.env`)

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `REACT_APP_BACKEND_URL` | Backend-API-URL (ohne abschließenden `/`) | `https://chat.example.com` |

---

## Authentifizierungs-Modi

Singra Vox bietet **zwei Authentifizierungswege**, die parallel existieren:

### 1. Lokale Authentifizierung (Standard)

```
Benutzer ──▶ Instanz-Login ──▶ Nur diese Instanz
```

- Benutzer registriert sich direkt bei deiner Instanz
- Konto existiert nur auf dieser einen Instanz
- E-Mail-Verifizierung über SMTP
- Passwort-Hashing mit Argon2id
- Ideal für geschlossene Teams / Organisationen

**Endpoints:**
```
POST /api/auth/register      → Account erstellen
POST /api/auth/verify-email  → E-Mail bestätigen
POST /api/auth/login         → Einloggen
GET  /api/auth/me            → Eigene Daten
```

### 2. Singra Vox ID (Instanz-übergreifend)

```
Benutzer ──▶ Singra Vox ID Server ──▶ Instanz A
                                   ──▶ Instanz B
                                   ──▶ Instanz C
```

- **Ein Account, viele Instanzen** – wie "Login mit Google", aber selbst gehostet
- Basiert auf OAuth2 / OpenID Connect
- Jede Instanz kann einen beliebigen ID-Server nutzen
- Jeder kann seinen eigenen ID-Server hosten

**Wie funktioniert Singra Vox ID?**

1. **ID-Server aufsetzen:** Eine Singra Vox-Instanz fungiert gleichzeitig als ID-Server
   (die `/api/id/`-Endpoints sind automatisch aktiv)

2. **Instanz registrieren:** Die Instanz meldet sich als OAuth2-Client beim ID-Server an:
   ```
   POST /api/id/oauth/clients
   {
     "instance_name": "Gaming Hub",
     "instance_url": "https://gaming.example.com",
     "redirect_uris": ["https://gaming.example.com/auth/callback"]
   }
   → { "client_id": "svid_abc123", "client_secret": "..." }
   ```

3. **Login-Flow:** Benutzer klickt "Login mit Singra Vox ID" auf der Instanz
   → Wird zum ID-Server weitergeleitet
   → Autorisiert die Instanz
   → Wird mit Auth-Code zurückgeleitet
   → Instanz tauscht Code gegen Tokens

**ID-Server Endpoints:**
```
POST /api/id/register              → SVID-Account erstellen
POST /api/id/login                 → Einloggen (mit 2FA-Support)
GET  /api/id/me                    → Profil abrufen
POST /api/id/oauth/authorize       → OAuth2-Autorisierung
POST /api/id/oauth/token           → Token-Austausch
GET  /api/id/oauth/userinfo        → Benutzerinfo (OpenID Connect)
GET  /api/id/.well-known/openid-configuration  → Auto-Discovery
```

**Wann welchen Modus nutzen?**

| Szenario | Empfohlener Modus |
|----------|------------------|
| Einzelne geschlossene Instanz (Firma, Team) | Lokale Auth |
| Mehrere Instanzen, gleiche Community | Singra Vox ID |
| Öffentliche Instanz, offene Registrierung | Singra Vox ID |
| Maximale Datenkontrolle, kein externer Server | Lokale Auth |

---

## Ende-zu-Ende-Verschlüsselung

### Zwei-Schichten-Modell

Singra Vox verschlüsselt auf **zwei unabhängigen Ebenen**:

```
┌───────────────────────────────────────────────────────┐
│  Schicht 2: Client-Side E2EE (libsodium)              │
│  → Server sieht NUR Ciphertext                         │
│  → Selbst der Instanz-Admin kann nicht mitlesen         │
│  → Schlüssel existieren nur auf den Geräten der User    │
├───────────────────────────────────────────────────────┤
│  Schicht 1: Server-Side Encryption at Rest (AES-256)   │
│  → Datenbank enthält NUR Ciphertext                     │
│  → Dateisystem enthält NUR verschlüsselte Bytes         │
│  → Schutz gegen DB-Leaks, Backups, physischen Zugriff   │
└───────────────────────────────────────────────────────┘
```

### Was wird verschlüsselt?

| Datentyp | Schicht 1 (Server) | Schicht 2 (Client E2EE) |
|----------|-------------------|------------------------|
| Öffentliche Kanal-Nachrichten | ✅ AES-256-GCM | Optional |
| Private Kanal-Nachrichten | ✅ AES-256-GCM | ✅ XChaCha20-Poly1305 |
| Direkt-Nachrichten (DMs) | ✅ AES-256-GCM | ✅ XChaCha20-Poly1305 |
| Gruppen-DMs | ✅ AES-256-GCM | ✅ XChaCha20-Poly1305 |
| Datei-Anhänge (Bytes) | ✅ AES-256-GCM | ✅ (Client verschlüsselt vor Upload) |
| Datei-Metadaten (Name, Typ) | ✅ AES-256-GCM | — |
| Voice/Video (LiveKit) | — | ✅ SFrame (LiveKit-nativ) |

### Schlüssel-Hierarchie (Server-Side)

```
INSTANCE_ENCRYPTION_SECRET (Umgebungsvariable)
    │
    ├── HMAC-SHA256(secret, "channel:<channel_id>")  → Channel-Key
    ├── HMAC-SHA256(secret, "dm:<sorted_user_ids>")   → DM-Key
    ├── HMAC-SHA256(secret, "group:<group_id>")       → Group-Key
    ├── HMAC-SHA256(secret, "file:<file_id>")         → File-Key
    └── HMAC-SHA256(secret, "meta:<context>")         → Metadata-Key
```

Jeder Kontext bekommt einen **einzigartigen Schlüssel** – ein kompromittierter
Channel-Key gefährdet keine DMs oder andere Channels.

### Client-Side E2EE (Schicht 2)

- **Algorithmus:** XChaCha20-Poly1305 (libsodium)
- **Key-Exchange:** X25519 (Curve25519)
- **Key-Envelopes:** Pro Gerät/Empfänger wird der Message-Key individuell verschlüsselt
- **Schlüssel-Speicherung:** Desktop → OS-Keychain | Web → localStorage
- **Recovery:** Backup-Schlüssel mit Passphrase verschlüsselt (Argon2)

### Kein Klartext in der Datenbank – Garantie

1. **Nachrichten:** `content`-Feld enthält immer AES-256-GCM Ciphertext (Base64)
2. **Dateien:** Auf Disk als AES-256-GCM verschlüsselte Bytes
3. **Datei-Metadaten:** `original_name` und `content_type` in DB verschlüsselt
4. **DMs/Gruppen:** Gleiche Verschlüsselung wie Channels
5. **Voice/Video:** SFrame-Verschlüsselung direkt im WebRTC-Stream

### Berechtigungsbasierter Zugriff

Nur Benutzer mit der entsprechenden Berechtigung können entschlüsselte Inhalte sehen:

1. Server prüft `read_messages`-Permission über das Rollen-System
2. Nur bei erfolgreicher Prüfung wird entschlüsselt und zurückgegeben
3. Bei Client-Side E2EE: Server kann gar nicht entschlüsseln – nur Geräte mit dem
   richtigen Key-Envelope

---

## LiveKit (Voice/Video)

### Self-Hosted
```yaml
# livekit.yaml
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
keys:
  APIxxxxxx: "geheimer_api_schluessel"
```

### LiveKit Cloud
1. Account bei [livekit.io](https://livekit.io) erstellen
2. Projekt anlegen
3. API-Key und Secret kopieren
4. In `backend/.env` eintragen

### Verschlüsselte Voice-Channels

Voice-Channels in privaten Kanälen verwenden **SFrame-Verschlüsselung**:
- Schlüssel wird per `ExternalE2EEKeyProvider` an LiveKit übergeben
- Key-Rotation bei Teilnehmer-Wechsel automatisch
- Server (SFU) leitet nur verschlüsselte Media-Pakete weiter

---

## E-Mail-Konfiguration

### Resend (empfohlen)
```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USERNAME=resend
SMTP_PASSWORD=re_xxxxxxxx
SMTP_FROM_EMAIL=noreply@deine-domain.de
SMTP_USE_SSL=true
```

### Eigener SMTP-Server
```env
SMTP_HOST=mail.deine-domain.de
SMTP_PORT=587
SMTP_USERNAME=noreply@deine-domain.de
SMTP_PASSWORD=geheim
SMTP_FROM_EMAIL=noreply@deine-domain.de
SMTP_USE_TLS=true
```

### Gmail (nur für Tests)
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=deine-email@gmail.com
SMTP_PASSWORD=app-spezifisches-passwort
SMTP_USE_TLS=true
```

---

## Datei-Speicherung

### Lokaler Speicher (Standard)
Dateien werden unter `/app/backend/storage/uploads/<YYYY-MM>/<uuid>` gespeichert.
- UUID-Dateinamen (kein Rückschluss auf Originalname)
- AES-256-GCM verschlüsselt auf Disk
- Metadaten (Name, Typ) verschlüsselt in MongoDB

### S3-kompatibler Speicher (für E2EE-Blobs)
Für client-seitig verschlüsselte Datei-Anhänge (E2EE):
```env
S3_ENDPOINT_URL=https://s3.eu-central-1.amazonaws.com
S3_ACCESS_KEY=AKIA...
S3_SECRET_KEY=...
S3_BUCKET=singravox-e2ee
S3_REGION=eu-central-1
```

Der Server speichert hier nur **opake Ciphertext-Blobs** – der Server kann
den Inhalt nicht entschlüsseln (client-side encrypted).

---

## Produktion

### Reverse-Proxy (Caddy empfohlen)
```
chat.example.com {
    reverse_proxy /api/* localhost:8001
    reverse_proxy /* localhost:3000
}
```

### Checkliste für Produktion

- [ ] `INSTANCE_ENCRYPTION_SECRET` generiert und **sicher gesichert**
- [ ] `JWT_SECRET` generiert (min. 32 Zeichen)
- [ ] `SVID_JWT_SECRET` generiert (min. 32 Zeichen)
- [ ] `SVID_ISSUER` auf die öffentliche URL gesetzt
- [ ] `FRONTEND_URL` auf die öffentliche URL gesetzt
- [ ] `COOKIE_SECURE=true` gesetzt
- [ ] SMTP konfiguriert und getestet
- [ ] LiveKit konfiguriert
- [ ] MongoDB Authentifizierung aktiviert
- [ ] Firewall: nur 80/443 nach außen
- [ ] SSL/TLS via Reverse-Proxy
- [ ] Regelmäßige Backups (MongoDB + Encryption Secret!)

---

## Wartung & Backup

### Datenbank-Backup
```bash
# Backup erstellen
mongodump --db singravox --out /backups/$(date +%Y%m%d)

# Backup wiederherstellen
mongorestore --db singravox /backups/20260101/singravox
```

> **WICHTIG:** Backups enthalten verschlüsselte Daten.
> Ohne `INSTANCE_ENCRYPTION_SECRET` sind sie wertlos.
> Sichere den Schlüssel separat und sicher!

### Schlüssel-Rotation
**INSTANCE_ENCRYPTION_SECRET darf NICHT rotiert werden** – alle bestehenden
Daten werden sonst unlesbar.  Plane Schlüssel-Migration nur mit einem
dezidierten Re-Encryption-Skript.

### Updates

**Automatisch (empfohlen):**
```bash
bash install.sh --auto-update-on    # Tägliche Updates um 04:00 aktivieren
```

**Manuell via Installer:**
```bash
bash install.sh --update
```

**Manuell ohne Installer:**
```bash
git pull
cd backend && pip install -r requirements.txt
cd ../frontend && yarn install
# Backend und Frontend neustarten
```

### Diagnose & Reparatur

```bash
bash install.sh --status     # Zeigt: Container-Status, Konfiguration, Speicher, API-Health
bash install.sh --repair     # Prüft & repariert: fehlende Secrets, Berechtigungen, Container
```

---

## Erweiterbarkeit

### Neuen verschlüsselten Datentyp hinzufügen

Alle Verschlüsselung läuft über `backend/app/core/encryption.py`.
Um einen neuen Kontext hinzuzufügen:

```python
# In encryption.py – neue Funktionen definieren
def encrypt_audit_content(audit_id: str, plaintext: str) -> str:
    if not encryption_enabled() or not plaintext:
        return plaintext
    key = _derive_key(f"audit:{audit_id}")
    return _aes_gcm_encrypt(plaintext, key)

def decrypt_audit_content(audit_id: str, stored: str) -> str:
    if not encryption_enabled() or not stored:
        return stored
    try:
        key = _derive_key(f"audit:{audit_id}")
        return _aes_gcm_decrypt(stored, key)
    except Exception:
        return stored
```

```python
# In deiner Route – importieren und nutzen
from app.core.encryption import encrypt_audit_content, decrypt_audit_content

# Beim Speichern
stored = encrypt_audit_content(audit_id, plaintext)
await db.audit_logs.insert_one({"id": audit_id, "content": stored, ...})

# Beim Lesen
record = await db.audit_logs.find_one({"id": audit_id})
plaintext = decrypt_audit_content(audit_id, record["content"])
```

### Neue API-Route hinzufügen

1. Neue Datei unter `backend/app/routes/` erstellen
2. `APIRouter` mit Prefix definieren
3. In `main.py` importieren und `app.include_router(router)` aufrufen
4. Berechtigungsprüfung über `app.permissions` nutzen

### Neues Frontend-Modul

1. Komponente unter `frontend/src/components/` erstellen
2. Page unter `frontend/src/pages/` wenn nötig
3. Route in `App.js` registrieren
4. API-Aufrufe über `frontend/src/lib/api.js`

---

## Fehlerbehebung

### "Encryption not enabled" Warnung
→ `INSTANCE_ENCRYPTION_SECRET` in `backend/.env` setzen

### Nachrichten/Dateien nicht lesbar nach Serverumzug
→ `INSTANCE_ENCRYPTION_SECRET` muss identisch sein!

### SVID-Login funktioniert nicht
→ `SVID_ISSUER` muss die öffentliche URL sein (mit `https://`)
→ `SVID_JWT_SECRET` muss stabil sein (nicht auto-generiert)

### E-Mails kommen nicht an
→ SMTP-Konfiguration in `backend/.env` prüfen
→ SPF/DKIM/DMARC für die Absender-Domain konfigurieren
→ Resend: Domain muss verifiziert sein

### Voice-Channels: "Connection failed"
→ LiveKit-URL prüfen (muss `wss://` sein)
→ API-Key und Secret prüfen
→ Firewall: WebRTC-Ports öffnen (UDP 50000-60000)

### Datei-Upload fehlgeschlagen
→ Speicherplatz prüfen
→ Berechtigungen auf `storage/uploads/` prüfen
→ Max-Upload-Größe: 50 MB (konfigurierbar über `MAX_E2EE_BLOB_BYTES`)
