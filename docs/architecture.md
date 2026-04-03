# Singra Vox – Architektur

## Überblick

Singra Vox besteht aus einem **gemeinsamen React-Frontend**, einer **FastAPI-Backend-API**, **MongoDB** als Datenbank, **LiveKit** für Voice/Video und einer **Tauri-Desktop-Hülle** für native Funktionen.

---

## Verzeichnis-Struktur

```
singra-vox/
├── backend/                    FastAPI-Backend
│   ├── app/
│   │   ├── main.py             App-Entry + alle Router registriert
│   │   ├── permissions.py      ZENTRAL: Alle Berechtigungs-Checks
│   │   ├── auth_service.py     JWT-Ausstellung, Argon2-Hashing, Sessions
│   │   ├── blob_storage.py     S3/MinIO – verschlüsselte Datei-Uploads
│   │   ├── emailing.py         SMTP-Versand (Verifikation, Reset)
│   │   ├── ws.py               WebSocket-Manager (In-Memory-Fanout)
│   │   ├── core/
│   │   │   ├── database.py     Einzelner Motor-MongoDB-Client (geteilt)
│   │   │   ├── utils.py        now_utc(), new_id(), sanitize_user()
│   │   │   └── constants.py    MAX_UPLOAD_BYTES, INLINE_MIME_PREFIXES, …
│   │   ├── routes/             Modularisierte API-Routes
│   │   │   ├── files.py        Upload/Download (Filesystem + S3)
│   │   │   ├── threads.py      Thread-Replies, Nachrichten-Revisionen
│   │   │   ├── pins.py         Nachrichten anpinnen / Topic setzen
│   │   │   ├── search.py       Nachrichten-Volltext-Suche
│   │   │   ├── unread.py       Ungelesen-Tracking, Read-States
│   │   │   ├── overrides.py    Kanal-Berechtigungs-Overrides
│   │   │   ├── groups.py       Gruppen-DMs
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
│       └── uploads/            Lokale Datei-Ablage (UUID-Dateinamen)
│
├── frontend/                   React-Web-App (geteilt mit Desktop)
│   ├── src/
│   │   ├── App.js              Router-Root + UpdateNotification
│   │   ├── contexts/
│   │   │   ├── AuthContext.js  Login-State, JWT-Token-Refresh
│   │   │   ├── E2EEContext.js  E2EE-Keys, Ver-/Entschlüsselung
│   │   │   └── RuntimeContext.js API-Basis-URL, App-Konfiguration
│   │   ├── lib/
│   │   │   ├── api.js          axios-Client mit Auth-Header
│   │   │   ├── desktop.js      isDesktopApp(), invokeTauri(), listenTauri()
│   │   │   ├── authStorage.js  JWT im OS-Keychain (Desktop) / localStorage (Web)
│   │   │   └── e2ee/
│   │   │       ├── crypto.js   Web Crypto API – AES-GCM, ECDH
│   │   │       └── deviceStorage.js Schlüssel-Persistenz
│   │   ├── components/
│   │   │   ├── chat/
│   │   │   │   ├── ChatArea.js          Hauptchat
│   │   │   │   └── AttachmentRenderer.js Inline-Bilder + Download
│   │   │   ├── desktop/
│   │   │   │   └── UpdateNotification.js Auto-Update-Banner
│   │   │   └── settings/
│   │   │       └── ServerSettingsOverlay.js Rollen, Kanäle, Mitglieder
│   │   └── pages/
│   │       ├── MainLayout.js   Haupt-Shell (Sidebar, Chat, Voice)
│   │       └── SetupPage.js    Ersteinrichtungs-Wizard
│   └── nginx.default.conf      nginx-Config für statisches Serving
│
├── desktop/                    Tauri-Desktop-Hülle
│   └── src-tauri/
│       ├── tauri.conf.json     App-Konfiguration, Updater, Targets
│       ├── Cargo.toml          Rust-Abhängigkeiten
│       ├── src/
│       │   ├── main.rs         Tauri-Entry, Update-Check, OS-Keychain-Commands
│       │   └── native_capture.rs Screen/Audio-Capture (Crabgrab)
│       └── capabilities/
│           └── default.json    Tauri-Berechtigungen (updater, keychain, …)
│
├── deploy/                     Docker-Konfiguration
│   ├── docker-compose.yml      Quickstart (HTTP)
│   ├── docker-compose.prod.yml Produktion (HTTPS via Caddy)
│   ├── backend.Dockerfile
│   ├── frontend.Dockerfile
│   ├── Caddyfile               SSL-Reverse-Proxy-Konfiguration
│   ├── nginx/                  nginx-Konfigurationen
│   ├── livekit.yaml            LiveKit-Server-Konfiguration
│   └── turnserver.conf         TURN/COTURN-Konfiguration
│
├── docs/                       Dokumentation (diese Dateien)
├── install.sh                  Einzeilen-Installer
└── .github/workflows/
    ├── ci.yml                  PR-Checks (Tests, Lint)
    └── release.yml             Release-Build (alle 3 Plattformen)
```

---

## Datenmodelle (MongoDB-Collections)

| Collection | Felder | Beschreibung |
|---|---|---|
| `users` | id, email, username, hashed_password, email_verified | Benutzer-Accounts |
| `servers` | id, name, owner_id, icon | Virtuelle Server (Workspaces) |
| `channels` | id, server_id, type (text/voice), is_private | Kanäle |
| `messages` | id, channel_id, author_id, content, is_e2ee, key_envelopes | Nachrichten |
| `server_members` | user_id, server_id, roles[], is_banned | Server-Mitgliedschaften |
| `server_roles` | id, server_id, name, color, permissions{} | Rollen |
| `channel_overrides` | channel_id, target_id, target_type, permissions{} | Kanal-Overrides |
| `files` | id, channel_id, original_name, content_type, path | Datei-Metadaten |
| `sessions` | token_id, user_id, expires_at | Aktive Sessions |

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

---

## E2EE (Ende-zu-Ende-Verschlüsselung)

Nachrichten in privaten Kanälen werden **im Browser / in der App** verschlüsselt. Der Server sieht nur Ciphertext.

- **Algorithmus:** AES-GCM (256-bit) + ECDH P-256 für Key-Exchange
- **Key-Envelopes:** Pro Geräte/Empfänger-Schlüssel wird der Message-Key individuell verschlüsselt
- **Schlüssel-Speicherung:** Desktop → OS-Keychain (Windows Credential Manager, macOS Keychain, Linux Secret Service) | Web → localStorage
- **Verschlüsselte Dateien:** Upload → Client-seitige Verschlüsselung → MinIO/S3 | Download → Entschlüsselung im Client

---

## API-Basis-Endpunkte

```
POST   /api/auth/register            Registrieren (Verifikations-E-Mail)
POST   /api/auth/verify-email        E-Mail-Code bestätigen
POST   /api/auth/login               Einloggen
GET    /api/auth/me                  Eigene Nutzerdaten
POST   /api/servers                  Server erstellen
GET    /api/servers                  Server-Liste
POST   /api/servers/{id}/channels    Kanal erstellen
POST   /api/channels/{id}/messages   Nachricht senden
GET    /api/channels/{id}/messages   Nachrichten abrufen
POST   /api/upload                   Datei hochladen
GET    /api/files/{id}               Datei abrufen
POST   /api/voice/token              LiveKit-Token anfordern
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
- **E2EE Voice:** Wird über SFrame verschlüsselt (LiveKit-nativ, privater Kanal)
