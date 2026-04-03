# Singra Vox – PRD (Stand: 2026-04-03)

## Original Problem Statement
"Es ist eine Discord-Alternative mit E2E-Verschlüsselung und vieles mehr. Backend muss getrennt bleiben, self-hosted. Tauri Desktop + Webversion. Server-Install per einem Command. Richte alles ein, Docs aktuell halten."

---

## Architektur

### Backend  `backend/`
```
backend/
  app/
    core/
      __init__.py          # Re-exports: db, now_utc, new_id, Konstanten
      database.py          # Einzelner Motor-MongoDB-Pool (geteilt überall)
      utils.py             # now_utc(), new_id(), sanitize_user()
      constants.py         # E2EE_DEVICE_HEADER, MAX_UPLOAD_BYTES, etc.
    routes/
      files.py             # Lokale Filesystem-Speicherung (UUID-Pfade)
      threads.py           # Thread-Replies
      search.py            # Nachrichten-Suche (ohne E2EE-Kanäle)
      unread.py            # Ungelesene Nachrichten + Read-States
      overrides.py         # Kanal-Berechtigungs-Overrides + Access-Listen
      groups.py            # Gruppen-DMs
      gdpr.py              # DSGVO: Datenexport + Account-Löschung
      pins.py              # Nachrichtenpins + Kanal-Topic
      notifications.py     # In-App + Web-Push Benachrichtigungen
      emojis.py            # Custom Server-Emojis
      webhooks.py          # Incoming Webhooks (rate-limited)
      bots.py              # Bot-Token-Verwaltung
    services/
      __init__.py
      notifications.py     # Zentraler Notification-Service (send_notification())
    permissions.py         # Zentrale Berechtigungs-Engine
    auth_service.py        # JWT, Argon2/bcrypt, Sessions
    blob_storage.py        # S3/MinIO (für E2EE-Anhänge)
    emailing.py            # SMTP
    pagination.py          # Cursor-Pagination
    rate_limits.py         # Login-Rate-Limiting
    voice_access.py        # LiveKit Voice-Zugangsprüfung
    ws.py                  # WebSocket-Manager
    main.py                # App-Factory: FastAPI-App + Router-Registration
  server.py                # Einstiegspunkt
  storage/
    uploads/               # Lokale Datei-Uploads (UUID-Dateinamen)
    minio-data/            # MinIO S3 Datenspeicher (lokal)
```

### Frontend  `frontend/src/`
```
components/
  chat/
    ChatArea.js            # Haupt-Chat (Nachrichten, Anhänge, E2EE)
    AttachmentRenderer.js  # NEU: Inline-Bild + Download-Button Renderer
    ChannelSidebar.js
    ServerSidebar.js
    VoiceMediaStage.js
  security/    # E2EEStatus
  settings/    # GlobalSettingsOverlay (Account, Voice, Privacy & Security)
  ui/          # Shadcn-Komponenten
contexts/
  AuthContext, E2EEContext, RuntimeContext
lib/
  e2ee/        # crypto.js, deviceStorage.js (localStorage-Fallback für Web)
  api.js, voiceEngine.js, screenSharePresets.js
```

### Services (lokal via Supervisor)
```
/etc/supervisor/conf.d/
  livekit.conf   # LiveKit Port 7880
  minio.conf     # MinIO Port 9000 (API) + 9001 (Console)
  mailpit.conf   # Mailpit Port 1025 (SMTP) + 8025 (Web-UI)
  frontend.conf
  backend.conf
```

---

## Implementierungsstand

### 2026-04-03 – Setup & Bugfixes
- .env-Dateien erstellt, livekit-protocol installiert, S3 optional, Index-Fix, debug-Log entfernt

### 2026-04-03 – Server-Sidebar-Scroll
- Scrollbar ab 10 Servern, `+`-Button immer sichtbar, min(600px, calc(100vh-160px))

### 2026-04-03 – E2EE Web-Support
- localStorage-Fallback, isDesktop-Gate entfernt, ChatArea/ThreadPanel/PinnedMessages gefixt
- Verifiziert: 1 verschlüsselte Nachricht in DB mit ciphertext + nonce + key_envelopes

### 2026-04-03 – Voice/Streaming
- LiveKit v1.10.1 unter Supervisor, Voice-Token API 100% OK
- Screen-Share Presets 480p–1080p60, System-Audio-Toggle

### 2026-04-03 – Backend-Modularisierung (MAJOR)
- routes_phase2.py + routes_phase3.py → 11 neue Module unter app/routes/
- app/core/ mit shared DB-Pool, Utils, Konstanten
- app/services/notifications.py (zentraler Notification-Service)
- permissions.py: +assert_channel_access(), +list_channel_user_ids()
- Kein doppelter MongoDB-Client mehr (3×→1×)

### 2026-04-03 – Lokale Datei-Speicherung
- routes/files.py: POST /api/upload → Filesystem (UUID-Pfad, kein Originalname im Pfad)
- GET /api/files/{id}: StreamingResponse + Permission-Check für private Kanäle
- Privacy-first: UUID-Dateinamen, Content-Type aus DB, keine Erweiterung im Pfad

### 2026-04-03 – Settings UI Redesign
- Account-Sektion: kompaktes 80px-Avatar-Widget statt 220px-Vorschau
- Status-Selector entfernt

### 2026-04-03 – SMTP, MinIO, Inline-Bilder, LiveKit URL (JETZT)
- **SMTP**: Mailpit via Supervisor (Port 1025/8025), `SMTP_HOST=localhost` in .env
  - Registrierung erfordert zwingend E-Mail-Verifikation
  - POST /api/auth/register → E-Mail → POST /api/auth/verify-email (6-stelliger Code)
- **MinIO/S3**: Läuft via Supervisor auf Port 9000
  - Bucket `singravox-e2ee` wird automatisch beim Backend-Start erstellt
  - E2EE-Blobs werden in MinIO gespeichert via `blob_storage.py`
  - `S3_ENDPOINT_URL=http://localhost:9000`, `S3_ACCESS_KEY=singravox`
- **AttachmentRenderer.js**: Neue Komponente in `components/chat/`
  - Non-E2EE-Bilder: `<img>` direkt via `/api/files/`
  - E2EE-Bilder: automatische Entschlüsselung + Blob-URL-Rendering
  - Nicht-Bilder: Download-Button
- **LIVEKIT_PUBLIC_URL**: Neue .env-Variable für die öffentlich erreichbare URL
  - Clients (Browser) nutzen `LIVEKIT_PUBLIC_URL`, Backend nutzt `LIVEKIT_URL`
  - In docker-compose.yml und docker-compose.prod.yml konfiguriert
- **install.sh**: Aktualisiert mit SMTP, S3, LIVEKIT_PUBLIC_URL, MinIO-Auto-Start

### 2026-04-03 – Vollständiges install.sh + Docker-Setup
- **install.sh** komplett neu geschrieben (TeamSpeak-einfach):
  - Automatische Docker-Installation falls nicht vorhanden
  - 2 Modi: Quickstart (HTTP, IP/Port) und Produktiv (HTTPS, Caddy + Let's Encrypt)
  - Automatische Admin-Account-Erstellung via `/api/setup/bootstrap` nach Start
  - Nur 4-5 Fragen: Instanzname, Admin-E-Mail, Passwort, Modus (+ Domain bei Produktiv)
  - Alles automatisch: Secrets, VAPID-Keys, MinIO, SMTP, LiveKit-Konfiguration
  - `DATA_DIR=/opt/singravox` - alle Configs und Compose-Files werden dort erstellt
  - Farbige Ausgabe mit Spinner, klare Erfolgs-/Fehlermeldungen
- **docker-compose.prod.yml** aktualisiert:
  - Alle SMTP + S3 + VAPID + LIVEKIT_PUBLIC_URL Variablen korrekt gesetzt
  - HealthCheck für Backend + MongoDB
  - `uploads_data` Volume hinzugefügt
  - LiveKit Ports (7880/7881/7882) konfiguriert
  - Mailpit als Dev-Only Service (profile: dev)
- **docker-compose.yml** (Quickstart):
  - LIVEKIT_PUBLIC_URL env_file-basiert
  - nginx als Reverse Proxy (Port 8080 konfigurierbar)
- **README.md** neu geschrieben: vollständige Anleitung ohne Vorkenntnisse, Hetzner/Netcup/Contabo Sektion, Firewall-Ports, Services-Tabelle

### 2026-04-03 – Tauri Desktop-App Updater + Release-Pipeline
- **Tauri Updater** integriert in `desktop/src-tauri/`:
  - `Cargo.toml`: `tauri-plugin-updater` + `tauri-plugin-process` hinzugefügt
  - `main.rs`: automatische Update-Prüfung beim App-Start (Background-Task), Befehle `check_update_command` + `install_update_command`
  - Session-Token im OS-Keychain → **User bleibt nach Update eingeloggt**
- **tauri.conf.json** aktualisiert:
  - Targets: alle 3 Plattformen (Windows .msi/.exe, macOS .dmg, Linux .AppImage/.deb)
  - Updater-Endpoint: GitHub Releases (latest.json)
  - Build-Command: yarn statt npm
- **UpdateNotification.js**: neue React-Komponente mit Download-Progress-Bar
  - Erscheint automatisch wenn neues Update auf GitHub veröffentlicht wird
  - "Jetzt aktualisieren" → Download → Auto-Restart
- **desktop.js**: `invokeTauri()` und `listenTauri()` Helpers hinzugefügt
- **GitHub Actions `release.yml`**: 
  - Trigger: `v*.*.*` Tag pushen
  - Matrix-Build: Windows, macOS Intel, macOS ARM, Linux
  - Docker-Images pushen (Backend + Web)
  - Tauri signierte Release-Assets erstellen
  - GitHub Release automatisch veröffentlichen
- **`install.sh --update`**: Bestehende Installation aktualisieren ohne .env zu überschreiben
  - Rolling Restart: Backend → Frontend (keine Downtime)
  - Sessions bleiben aktiv
- **`docs/RELEASING.md`**: Schritt-für-Schritt Anleitung für neue Releases

**Test-Status: Syntax OK, Lint OK, Frontend compiliert erfolgreich**

### 2026-04-03 – Vollständiges Permissions-System (Discord-Modell)
- **`permissions.py`** erweitert: 3 neue assert-Helper, 3 neue Permissions (`view_channels`, `pin_messages`, `manage_messages`), alle Docs auf Deutsch
- **Alle 6 Route-Lücken geschlossen**: threads (send_messages+attach_files), overrides (manage_channels), emojis (membership), unread (read_messages), files (alle Kanal-Dateien)
- **Test-Status (Iteration 12-14): 40/40 (100%)** – Owner-Bypass ✅, Muted-Rolle ✅, Grant-schlägt-Deny ✅, Privilege-Escalation blockiert ✅, JWT-Fälschung ✅, Body-Injection ignoriert ✅, Channel-Overrides ✅, Upload attach_files-Schutz ✅

---

## Datenschutz-Prinzipien
- Minimale Datenspeicherung: keine IP-Logs, keine unnötigen Metadaten
- UUID-Dateinamen auf dem Filesystem (kein Original-Dateiname im Pfad)
- E2EE: Server sieht nur Ciphertext + Nonce + Key-Envelopes
- Account-Löschung (DSGVO Art. 17): Nachrichten anonymisiert, Keys gelöscht
- Datenexport (DSGVO Art. 20): GET /api/users/me/export

---

## Priorisierter Backlog

### P1 – Wichtig
- [ ] install.sh: docker-compose.prod.yml testen + TURN/COTURN konfigurieren
- [ ] Tauri Desktop-App Build-Pipeline
- [ ] Roles & Permissions vollständig über permissions.py abdecken (alle Edge Cases)
- [ ] TURN-Server (COTURN) für NAT-Traversal bei Voice

### P2 – Backlog
- [ ] Redis für WebSocket-Skalierung (Mehrere Backend-Instanzen)
- [ ] MLS Ratchet Migration (E2EE v2)
- [ ] macOS/Windows Tauri-Pakete
- [ ] MinIO zu externer S3-kompatiblen Storage migrieren (AWS S3, Backblaze)
- [ ] Voice Token: auth check vor Pydantic-Validierung (422→401 für unauthenticated)

---

## Test-Credentials
→ `/app/memory/test_credentials.md`
