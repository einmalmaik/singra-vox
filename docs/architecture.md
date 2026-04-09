# Singra Vox – Architektur

## Überblick

Singra Vox besteht aus einem **gemeinsamen React-Frontend**, einer **FastAPI-Backend-API**, **MongoDB** als Datenbank, **LiveKit** für Voice/Video und einer **Tauri-Desktop-Hülle** für native Funktionen.

Alle Daten werden **verschlüsselt** gespeichert – die Datenbank und das Dateisystem
enthalten **niemals Klartext**.

---

## Verzeichnis-Struktur

```
singra-vox/
├── backend/                    FastAPI-Backend
│   ├── app/
│   │   ├── main.py             App-Entry + alle Router registriert
│   │   ├── permissions.py      ZENTRAL: Alle Berechtigungs-Checks
│   │   ├── auth_service.py     JWT-Ausstellung, Argon2-Hashing, Sessions
│   │   ├── blob_storage.py     S3/MinIO – verschlüsselte Datei-Uploads (E2EE-Blobs)
│   │   ├── emailing.py         SMTP-Versand (Verifikation, Reset)
│   │   ├── ws.py               WebSocket-Manager (In-Memory-Fanout)
│   │   ├── voice_access.py     LiveKit-Token + E2EE-Voice-Key-Management
│   │   ├── core/
│   │   │   ├── database.py     Einzelner Motor-MongoDB-Client (geteilt)
│   │   │   ├── encryption.py   ★ ZENTRAL: Verschlüsselung at Rest (AES-256-GCM)
│   │   │   ├── utils.py        now_utc(), new_id(), sanitize_user()
│   │   │   └── constants.py    MAX_UPLOAD_BYTES, INLINE_MIME_PREFIXES, …
│   │   ├── identity/           ★ Singra Vox ID (OAuth2/OIDC Identity Server)
│   │   │   ├── routes.py       Alle ID-Endpoints (/api/id/*)
│   │   │   ├── config.py       SVID-Konfiguration aus Umgebungsvariablen
│   │   │   ├── models.py       Pydantic-Modelle für ID-Requests
│   │   │   ├── oauth2.py       OAuth2 Authorization Code Flow
│   │   │   ├── password.py     Passwort-Stärke, -Policy, -Generator
│   │   │   └── totp.py         TOTP 2FA (RFC 6238)
│   │   ├── routes/             Modularisierte API-Routes
│   │   │   ├── files.py        Upload/Download (verschlüsselt auf Disk + DB)
│   │   │   ├── threads.py      Thread-Replies, Nachrichten-Revisionen
│   │   │   ├── pins.py         Nachrichten anpinnen / Topic setzen
│   │   │   ├── search.py       Nachrichten-Volltext-Suche
│   │   │   ├── unread.py       Ungelesen-Tracking, Read-States
│   │   │   ├── overrides.py    Kanal-Berechtigungs-Overrides
│   │   │   ├── groups.py       Gruppen-DMs (verschlüsselt)
│   │   │   ├── gdpr.py         Datenexport + Account-Löschung (DSGVO)
│   │   │   ├── notifications.py Push-Benachrichtigungen
│   │   │   ├── emojis.py       Custom Server-Emojis
│   │   │   ├── webhooks.py     Incoming Webhooks
│   │   │   └── bots.py         Bot-Token-Verwaltung
│   │   └── services/
│   │       └── notifications.py send_notification() Zentraldienst
│   ├── server.py               Uvicorn-Einstiegspunkt
│   ├── requirements.txt
│   └── storage/
│       └── uploads/            Verschlüsselte Datei-Ablage (UUID-Dateinamen)
│
├── frontend/                   React-Web-App (geteilt mit Desktop)
│   ├── src/
│   │   ├── App.js              Router-Root + UpdateNotification
│   │   ├── contexts/
│   │   │   ├── AuthContext.js   Login-State, JWT-Token-Refresh
│   │   │   ├── E2EEContext.js   E2EE-Keys, Ver-/Entschlüsselung
│   │   │   └── RuntimeContext.js API-Basis-URL, App-Konfiguration
│   │   ├── lib/
│   │   │   ├── api.js           axios-Client mit Auth-Header
│   │   │   ├── desktop.js       isDesktopApp(), invokeTauri(), listenTauri()
│   │   │   ├── authStorage.js   JWT im OS-Keychain (Desktop) / localStorage (Web)
│   │   │   └── e2ee/
│   │   │       ├── crypto.js    ★ Web Crypto API – XChaCha20, X25519
│   │   │       ├── media.js     ★ Verschlüsselte Voice (SFrame + LiveKit)
│   │   │       └── deviceStorage.js  Schlüssel-Persistenz
│   │   ├── components/
│   │   │   ├── chat/
│   │   │   │   ├── ChatArea.js           Hauptchat
│   │   │   │   └── AttachmentRenderer.js Inline-Bilder + Download
│   │   │   ├── desktop/
│   │   │   │   └── UpdateNotification.js Auto-Update-Banner
│   │   │   └── settings/
│   │   │       └── ServerSettingsOverlay.js Rollen, Kanäle, Mitglieder
│   │   └── pages/
│   │       ├── MainLayout.js    Haupt-Shell (Sidebar, Chat, Voice)
│   │       └── SetupPage.js     Ersteinrichtungs-Wizard
│   └── nginx.default.conf       nginx-Config für statisches Serving
│
├── desktop/                     Tauri-Desktop-Hülle
│   └── src-tauri/
│       ├── tauri.conf.json      App-Konfiguration, Updater, Targets
│       ├── Cargo.toml           Rust-Abhängigkeiten
│       ├── src/
│       │   ├── main.rs          Tauri-Entry, Update-Check, OS-Keychain-Commands
│       │   └── native_capture.rs Screen/Audio-Capture (Crabgrab)
│       └── capabilities/
│           └── default.json     Tauri-Berechtigungen (updater, keychain, …)
│
├── deploy/                      Docker-Konfiguration
│   ├── docker-compose.yml       Quickstart (HTTP)
│   ├── docker-compose.prod.yml  Produktion (HTTPS via Caddy)
│   ├── backend.Dockerfile
│   ├── frontend.Dockerfile
│   ├── Caddyfile                SSL-Reverse-Proxy-Konfiguration
│   ├── nginx/                   nginx-Konfigurationen
│   ├── livekit.yaml             LiveKit-Server-Konfiguration
│   └── turnserver.conf          TURN/COTURN-Konfiguration
│
├── docs/                        Dokumentation
│   ├── architecture.md          Diese Datei
│   ├── self-hosting.md          Komplette Self-Hosting-Anleitung
│   └── encryption.md            Detaillierte Verschlüsselungs-Dokumentation
│
├── install.sh                   Einzeilen-Installer
└── .github/workflows/
    ├── ci.yml                   PR-Checks (Tests, Lint)
    └── release.yml              Release-Build (alle 3 Plattformen)
```

---

## Verschlüsselungs-Architektur

### Prinzip: Kein Klartext – Nirgends

```
Benutzer-Input (Klartext)
       │
       ▼
┌──────────────────────┐
│ Client (Browser/App) │
│                      │
│  Client-Side E2EE    │──── Schlüssel: libsodium X25519 + XChaCha20
│  (private Kanäle,    │     → Server sieht NUR Ciphertext
│   DMs, Voice)        │
└──────────┬───────────┘
           │ Ciphertext (oder Klartext für öffentliche Kanäle)
           ▼
┌──────────────────────┐
│ Server (FastAPI)     │
│                      │
│  Encryption at Rest  │──── Schlüssel: HMAC-SHA256(INSTANCE_SECRET, context)
│  (AES-256-GCM)       │     → DB/Disk sieht NUR Ciphertext
│  encryption.py       │
└──────────┬───────────┘
           │ Ciphertext
           ▼
┌──────────────────────┐
│ MongoDB / Dateisystem │──── Enthält NUR verschlüsselte Daten
│                       │     Backup = verschlüsseltes Backup
└───────────────────────┘
```

### Zentrale Verschlüsselungs-Datei

**`backend/app/core/encryption.py`** ist die EINZIGE Datei, in der
Verschlüsselungslogik implementiert ist.  Alle anderen Module **importieren
und nutzen** die Funktionen aus dieser Datei:

| Funktion | Wird genutzt von |
|----------|-----------------|
| `encrypt_channel_content()` | `main.py` (Nachrichten senden) |
| `decrypt_channel_content()` | `main.py` (Nachrichten abrufen) |
| `encrypt_dm_content()` | `main.py` (DMs senden) |
| `decrypt_dm_content()` | `main.py` (DMs abrufen) |
| `encrypt_group_content()` | `routes/groups.py` (Gruppen-DMs) |
| `decrypt_group_content()` | `routes/groups.py` (Gruppen-DMs) |
| `encrypt_file_bytes()` | `routes/files.py` (Datei-Upload) |
| `decrypt_file_bytes()` | `routes/files.py` (Datei-Download) |
| `encrypt_metadata()` | `routes/files.py` (Dateiname, Content-Type) |
| `decrypt_metadata()` | `routes/files.py` (Dateiname, Content-Type) |

**Vorteil:** Um die Verschlüsselung zu ändern oder zu erweitern, muss nur
EINE Datei angepasst werden.

---

## Datenmodelle (MongoDB-Collections)

| Collection | Verschlüsselte Felder | Beschreibung |
|---|---|---|
| `users` | — (Passwort: Argon2id-Hash) | Benutzer-Accounts |
| `servers` | — | Virtuelle Server (Workspaces) |
| `channels` | — | Kanäle |
| `messages` | `content` (AES-256-GCM) | Nachrichten |
| `dm_messages` | `content` (AES-256-GCM) | Direkt-Nachrichten |
| `group_messages` | `content` (AES-256-GCM) | Gruppen-DMs |
| `files` | `original_name`, `content_type` (AES-256-GCM) | Datei-Metadaten |
| `server_members` | — | Server-Mitgliedschaften |
| `server_roles` | — | Rollen |
| `channel_overrides` | — | Kanal-Berechtigungs-Overrides |
| `sessions` | — | Aktive Sessions |
| `svid_accounts` | — (Passwort: Argon2id-Hash) | Singra Vox ID Accounts |
| `svid_totp` | `secret` (TOTP-Geheimnis) | 2FA-Konfiguration |
| `svid_sessions` | — | SVID-Sessions |
| `svid_oauth_clients` | `client_secret_hash` | OAuth2-Clients |
| `e2ee_devices` | `public_key` | Registrierte E2EE-Geräte |

---

## Berechtigungs-System

Alle Permission-Checks laufen ausnahmslos über `backend/app/permissions.py`.

**Auflösungs-Reihenfolge (Discord-Modell):**
1. Server-Owner → hat immer alle Rechte (Owner-Bypass)
2. @everyone-Rolle → setzt die Basis-Berechtigungen
3. Custom-Rollen des Users → Grant (True) von **irgendeiner** Rolle gewinnt
4. Rollen-Deny (False) → überschreibt @everyone, außer eine andere Rolle gewährt explizit
5. Kanal-Overrides → finale Ebene (explizites Allow/Deny pro Kanal)

**Standard-Berechtigungen (@everyone):**
- `read_messages`, `send_messages`, `attach_files`, `join_voice`, `speak`, `stream`, `create_invites` → **true**
- `manage_channels`, `manage_roles`, `ban_members`, `kick_members`, `manage_messages` → **false**

**Verschlüsselung + Berechtigungen:**
- Server prüft `read_messages` bevor entschlüsselte Inhalte geliefert werden
- Ohne Berechtigung: kein Zugriff auf den Schlüssel-Kontext → keine Entschlüsselung
- Bei E2EE: Server kann ohnehin nicht entschlüsseln – Key-Envelopes nur für berechtigte Geräte

---

## Singra Vox ID – Identitäts-System

### Konzept

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Instanz A  │     │  Instanz B  │     │  Instanz C  │
│  gaming.xyz │     │  work.xyz   │     │  club.xyz   │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────┬───────┘───────────┬───────┘
                   │                   │
            ┌──────▼───────────────────▼──────┐
            │       Singra Vox ID Server       │
            │       id.singravox.example       │
            │                                  │
            │  Ein Account → Alle Instanzen    │
            │  OAuth2 / OpenID Connect         │
            │  2FA (TOTP)                      │
            │  Cross-Instance Invites          │
            └──────────────────────────────────┘
```

### Features
- **OAuth2 Authorization Code Flow** (RFC 6749)
- **OpenID Connect Discovery** (`.well-known/openid-configuration`)
- **TOTP 2FA** mit Backup-Codes
- **Passwort-Policy** (Stärke-Scoring, Common-Password-Blacklist)
- **Cross-Instance Invites** (Einladungen zwischen Instanzen)
- **Instance Switcher** (Unread-Counts über Instanzen hinweg)

### Jeder kann seinen eigenen ID-Server hosten

Der ID-Server ist in jeder Singra-Vox-Instanz eingebaut (`/api/id/*`).
Man braucht nur `SVID_ISSUER` und `SVID_JWT_SECRET` zu setzen.

---

## API-Basis-Endpunkte

### Lokale Auth
```
POST   /api/auth/register            Registrieren
POST   /api/auth/verify-email        E-Mail-Code bestätigen
POST   /api/auth/login               Einloggen
GET    /api/auth/me                  Eigene Nutzerdaten
POST   /api/auth/logout              Ausloggen
```

### Singra Vox ID
```
POST   /api/id/register              SVID-Account erstellen
POST   /api/id/verify-email          E-Mail verifizieren
POST   /api/id/login                 Einloggen (mit 2FA-Support)
POST   /api/id/login/2fa             2FA-Code bestätigen
GET    /api/id/me                    Profil abrufen
PUT    /api/id/me                    Profil ändern
POST   /api/id/oauth/clients         OAuth2-Client registrieren
POST   /api/id/oauth/authorize       Autorisierung
POST   /api/id/oauth/token           Token-Austausch
GET    /api/id/oauth/userinfo        OpenID Connect UserInfo
GET    /api/id/.well-known/openid-configuration
POST   /api/id/2fa/setup             2FA einrichten
POST   /api/id/2fa/confirm           2FA bestätigen
POST   /api/id/invites/send          Cross-Instance Einladung
GET    /api/id/invites               Einladungen abrufen
```

### Server & Kanäle
```
POST   /api/servers                  Server erstellen
GET    /api/servers                  Server-Liste
POST   /api/servers/{id}/channels    Kanal erstellen
POST   /api/channels/{id}/messages   Nachricht senden
GET    /api/channels/{id}/messages   Nachrichten abrufen (verschlüsselt ↔ Klartext)
```

### Dateien
```
POST   /api/upload                   Datei hochladen (verschlüsselt)
POST   /api/upload/multipart         Datei hochladen (Multipart, verschlüsselt)
GET    /api/files/{id}               Datei abrufen (entschlüsselt bei Berechtigung)
DELETE /api/files/{id}               Datei löschen
```

### Voice
```
POST   /api/voice/token              LiveKit-Token anfordern
```

### Setup
```
GET    /api/setup/status             Einrichtungs-Status
POST   /api/setup/bootstrap          Erste Instanz einrichten
GET    /api/health                   Health-Check
```

---

## Voice / Video (LiveKit)

LiveKit ist ein Open-Source SFU (Selective Forwarding Unit) für WebRTC.

- **Interner URL** (`LIVEKIT_URL`): Backend ↔ LiveKit API (z.B. `ws://livekit:7880`)
- **Öffentlicher URL** (`LIVEKIT_PUBLIC_URL`): Browser/App ↔ LiveKit Signaling (z.B. `wss://rtc.beispiel.de`)
- **Ports:** 7880 TCP (Signaling), 7881 TCP (RTP), 7882 UDP (SRTP Media)
- **E2EE Voice:** SFrame-Verschlüsselung (LiveKit-nativ, Key via ExternalE2EEKeyProvider)
- **Key-Rotation:** Automatisch bei Teilnehmer-Wechsel

Frontend-Viewer-Pfad:

- **Quelle der Wahrheit:** LiveKit `publication + track`
- **UI-Auswahl:** `videoTrackRefs.js` hält nur auswählbare Stream- und Kamera-Referenzen
- **Native Desktop-Preview:** der Desktop-Screenshare publiziert über einen separaten Proxy-Teilnehmer; `ScreenShareProxyMap.js` mappt die Proxy-Identity wieder auf den owning user
- **Preview-Rendering:** `VoiceMediaStage` attached den LiveKit-Track direkt an ein `<video>`-Element; es gibt keine zweite manuelle Receive-State-Maschine über LiveKit

---

### Voice-Controller-Schnitt

- `voiceEngine.js` bleibt die stabile Fassade fÃ¼r `new VoiceEngine()` und die bestehenden Event-Namen.
- Die Implementierung liegt intern in `frontend/src/lib/voice/`:
  - `VoiceSessionController.js`
  - `LocalAudioController.js`
  - `LocalVideoController.js`
  - `ScreenShareController.js`
  - `RemoteMediaController.js`
  - `ScreenShareProxyMap.js`
- Remote-Video wird direkt aus LiveKit `trackPublications` projiziert; es gibt keinen zweiten allgemeinen Video-Cache mehr.

## Design-Prinzipien

1. **Privacy First:** Kein Klartext in DB/Disk, minimale Metadaten
2. **Zentrale Verschlüsselung:** Eine Datei (`encryption.py`), überall genutzt
3. **Wartbar:** Modulare Dateistruktur, klare Trennung der Verantwortlichkeiten
4. **Skalierbar:** Neue verschlüsselte Kontexte in Minuten hinzufügbar
5. **Erweiterbar:** Neue Routes/Module ohne bestehende Logik zu ändern
6. **Self-Hostable:** Alle Konfiguration über Umgebungsvariablen
