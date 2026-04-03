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
      files.py             # NEU: Lokale Filesystem-Speicherung (UUID-Pfade)
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
    permissions.py         # Zentrale Berechtigungs-Engine:
                           #   has_channel_permission(), has_server_permission()
                           #   assert_channel_access(), list_channel_user_ids()
    auth_service.py        # JWT, Argon2/bcrypt, Sessions
    blob_storage.py        # S3/MinIO (optional, für E2EE-Anhänge)
    emailing.py            # SMTP
    pagination.py          # Cursor-Pagination
    rate_limits.py         # Login-Rate-Limiting
    voice_access.py        # LiveKit Voice-Zugangsprüfung
    ws.py                  # WebSocket-Manager
    main.py                # App-Factory: FastAPI-App + Router-Registration
  server.py                # Einstiegspunkt (from app.main import app)
  storage/
    uploads/               # Lokale Datei-Uploads (UUID-Dateinamen, kein Klarname im Pfad)
```

### Frontend  `frontend/src/`
```
components/
  chat/        # ChatArea, ChannelSidebar, ServerSidebar, VoiceMediaStage
  security/    # E2EEStatus
  settings/    # GlobalSettingsOverlay (Account, Voice, Privacy & Security)
  ui/          # Shadcn-Komponenten
contexts/
  AuthContext, E2EEContext, RuntimeContext
lib/
  e2ee/        # crypto.js, deviceStorage.js (localStorage-Fallback für Web)
  api.js, voiceEngine.js, screenSharePresets.js
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
- Keine duplizierten Hilfsfunktionen mehr

### 2026-04-03 – Lokale Datei-Speicherung
- routes/files.py: POST /api/upload → Filesystem (UUID-Pfad, kein Originalname im Pfad)
- GET /api/files/{id}: StreamingResponse + Permission-Check für private Kanäle
- Privacy-first: UUID-Dateinamen, Content-Type aus DB, keine Erweiterung im Pfad

### 2026-04-03 – Settings UI Redesign
- Account-Sektion: kompaktes 80px-Avatar-Widget statt 220px-Vorschau
- Status-Selector entfernt (Status wird im Statusbereich unten links geändert)
- Sauberes Grid-Layout, responsive für alle Geräte

**Test-Status (Iteration 9): Backend 100% (20/20), Frontend 85%**

---

## Datenschutz-Prinzipien
- Minimale Datenspeicherung: keine IP-Logs, keine unnötigen Metadaten
- UUID-Dateinamen auf dem Filesystem (kein Original-Dateiname im Pfad)
- E2EE: Server sieht nur Ciphertext + Nonce + Key-Envelopes
- Account-Löschung (DSGVO Art. 17): Nachrichten anonymisiert, Keys gelöscht
- Datenexport (DSGVO Art. 20): GET /api/users/me/export

---

## Priorisierter Backlog

### P0 – Produktions-Blocker
- [ ] SMTP konfigurieren (Email-Verifikation für neue User)
- [ ] S3/MinIO für E2EE-Dateianhänge (verschlüsselte Bilder/Dateien)
- [ ] LiveKit externe URL (ws://localhost:7880 nicht von außen erreichbar)

### P1 – Wichtig
- [ ] Frontend: Inline-Bildvorschau in Kanälen für /api/files/-Anhänge
- [ ] Tauri Desktop-App Build-Pipeline
- [ ] TURN-Server (COTURN) für NAT-Traversal bei Voice

### P2 – Backlog
- [ ] Redis für WebSocket-Skalierung (Mehrere Backend-Instanzen)
- [ ] MLS Ratchet Migration (E2EE v2)
- [ ] macOS/Windows Tauri-Pakete

---

## Test-Credentials
→ `/app/memory/test_credentials.md`
