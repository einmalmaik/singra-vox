# Singra Vox – Architektur

## Überblick

Singra Vox ist als **Client-Server-Architektur** aufgebaut. Der Server ist vollständig unabhängig von den Clients. Jeder Client – Web-Browser oder Tauri-Desktop-App – kommuniziert über dieselbe REST-API und WebSocket-Verbindung.

```
┌──────────────────────────────────────────────────────────────┐
│                        Clients                                │
│                                                               │
│  ┌─────────────────────┐      ┌────────────────────────────┐ │
│  │    Web-Client        │      │    Desktop-Client          │ │
│  │    React SPA         │      │    Tauri 2 + React         │ │
│  │    Browser-basiert   │      │    Native Window           │ │
│  └──────────┬──────────┘      └──────────────┬─────────────┘ │
│             │                                 │               │
│             │          REST + WebSocket        │               │
│             └────────────────┬────────────────┘               │
└──────────────────────────────┼────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Reverse Proxy     │
                    │   nginx / Caddy     │
                    │   Port 80/443       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Singra Vox API    │
                    │   FastAPI + WS      │
                    │   Port 8001         │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   MongoDB           │
                    │   Port 27017        │
                    └─────────────────────┘
```

## Shared vs. Platform-specific

| Layer | Shared (Web + Desktop) | Web-only | Tauri-only |
|-------|----------------------|----------|------------|
| UI-Komponenten | `src/components/`, `src/pages/` | – | – |
| State Management | `src/contexts/AuthContext.js` | – | – |
| API-Client | `src/lib/api.js` | – | Tauri-HTTP-Client (optional) |
| E2EE Crypto | `src/lib/crypto.js` (Web Crypto API) | – | OS Keychain für Key Storage |
| Routing | React Router | Browser-History | In-Memory Router |
| Globale Hotkeys | – | – | Tauri Global Shortcut API |
| System Tray | – | – | Tauri Tray Plugin |
| Benachrichtigungen | – | Notification API | Tauri Notification Plugin |
| Audio Devices | – | WebRTC getUserMedia | Tauri + native Audio |
| Key Storage | localStorage | – | OS Secure Storage / Keychain |

## Frontend-Struktur (Tauri-Ready)

```
frontend/
├── src/                          # ← SHARED: Web + Desktop
│   ├── App.js                    # Router + Auth wrapper
│   ├── contexts/AuthContext.js   # Auth state
│   ├── lib/
│   │   ├── api.js               # Axios HTTP-Client (konfigurierbar)
│   │   └── crypto.js            # E2EE (Web Crypto API)
│   ├── pages/                   # Alle Seiten
│   ├── components/
│   │   ├── chat/                # Chat-Komponenten
│   │   ├── modals/              # Dialog-Komponenten
│   │   └── ui/                  # Shadcn Basis
│   └── index.css                # Design-System
│
├── desktop/                      # ← TAURI: Desktop-spezifisch
│   ├── src-tauri/               # Rust-Backend für Tauri
│   │   ├── Cargo.toml
│   │   ├── src/main.rs          # Tauri entry, global shortcuts, tray
│   │   └── tauri.conf.json      # Window-Konfiguration
│   └── README.md                # Setup-Anleitung
│
├── public/                       # Web entry point
├── package.json
└── .env.example
```

**Prinzip**: Der gesamte `src/`-Ordner ist plattformunabhängig. Tauri nutzt denselben Code – nur der Entry Point und native Features (Tray, Hotkeys, Keychain) werden in `desktop/src-tauri/` ergänzt.

## API-Design-Prinzipien

1. **Konfigurierbare Base-URL**: `REACT_APP_BACKEND_URL` (Web) bzw. Settings-Dialog (Desktop)
2. **Cookie-basierte Auth**: httpOnly Cookies für Sessions, Bearer-Token als Fallback
3. **WebSocket**: Einzelne persistente Verbindung pro Client für Echtzeit-Events
4. **REST für CRUD**: Alle Datenoperationen über REST-Endpoints
5. **Kein Server-Side Rendering**: Der Server liefert nur API-Daten, kein HTML

## Datenmodell

### Collections

| Collection | Zweck |
|-----------|-------|
| `users` | Benutzerkonten, Profil, Status, Public Key |
| `servers` | Server-Instanzen mit Settings |
| `channels` | Text/Voice/Private Channels mit Hierarchie |
| `messages` | Nachrichten mit Threads, Reactions, Mentions |
| `direct_messages` | 1:1 DMs mit E2EE-Support |
| `group_conversations` | Gruppen-DMs |
| `group_messages` | Nachrichten in Gruppen-DMs |
| `server_members` | Server-Mitgliedschaften + Rollen |
| `roles` | Rollen mit 17 granularen Permissions |
| `invites` | Einladungslinks mit Ablauf + Nutzungslimit |
| `voice_states` | Voice-Channel-Status (Join/Mute/Deafen) |
| `audit_log` | Datensparsames Audit-Log |
| `read_states` | Ungelesen-Tracking pro User/Channel |
| `message_revisions` | Edit-History |
| `file_uploads` | Dateianhänge (Base64 im MVP, S3 in Produktion) |
| `channel_overrides` | Channel-spezifische Permission-Overrides |
| `channel_access` | ACL für private Channels |
| `key_bundles` | E2EE Key-Bundles |
| `login_attempts` | Brute-Force-Schutz |

## E2EE-Architektur

```
Sender                              Server                         Empfänger
  │                                    │                                │
  │  1. GET /keys/{recipient}/bundle   │                                │
  │ ──────────────────────────────────►│                                │
  │  ◄──── identity_key, signed_pre_key│                                │
  │                                    │                                │
  │  2. ECDH Key Agreement             │                                │
  │     shared = DH(my_priv, their_pub)│                                │
  │                                    │                                │
  │  3. AES-256-GCM encrypt(message)   │                                │
  │     → ciphertext + nonce           │                                │
  │                                    │                                │
  │  4. POST /dm/{recipient}           │                                │
  │     { encrypted_content, nonce }   │                                │
  │ ──────────────────────────────────►│  5. Store (encrypted)          │
  │                                    │ ──────────────────────────────►│
  │                                    │     WebSocket push             │
  │                                    │                                │
  │                                    │  6. Recipient derives same key │
  │                                    │     AES-GCM decrypt            │
  │                                    │     → plaintext                │
```

**Server sieht nur Ciphertext**. Klartext verlässt nie den Client.

## Migrationspfad zum Zielstack

| Komponente | MVP (jetzt) | Ziel |
|-----------|------------|------|
| Backend | FastAPI (Python) | Rust (Axum + Tokio) |
| Datenbank | MongoDB | PostgreSQL + SQLX |
| Cache | – | Redis (optional) |
| Voice/Media | UI-only | LiveKit SFU |
| NAT Traversal | – | coturn |
| File Storage | MongoDB (Base64) | S3/MinIO |
| Desktop | – | Tauri 2 |
| Auth | JWT + bcrypt | JWT + Argon2id + WebAuthn |
| E2EE | ECDH + AES-GCM | MLS (Message Layer Security) |

Die API-Struktur bleibt identisch – nur die Implementierung wechselt. Clients müssen nicht angepasst werden.
