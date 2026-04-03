# Singra Vox – PRD

## Original Problem Statement
"Importieren Mein Rebo singra-vox, richte es danach in deiner Umgebung ein und dann checke die letzten Änderungen auf Fehler, die entstanden sind. Deine Aufgabe ist es, eine funktionierende App daraus zu machen. Es ist eine Discord-Alternative mit E2E-Verschlüsselung und vieles mehr. Deine Aufgabe ist es daher, zuzuschauen, was wir bereits haben, wo Fehler sind, wo Verwirrungen sind etc. Backend muss getrennt bleiben und das Ganze ist self-hosted, einmal die Tarui-Desktop-App und die Webversion, die vom Server ausgeliefert wird. Der Server-Install soll easy bleiben mit einem Command. Richte alles ein, alte die Docs aktuelle."

## Project Description
Singra Vox is a privacy-first, self-hosted Discord alternative with:
- End-to-End Encryption (E2EE) for messages, images, and voice (NaCl Box / libsodium)
- Web client (React, CRA + CRACO, Tailwind CSS)
- Desktop client (Tauri v2)
- Voice/Video/Screenshare via LiveKit SFU
- Push notifications via Web-Push (VAPID)
- JWT authentication with refresh tokens (argon2/bcrypt)
- Role/permission system with channel overrides
- Screen share quality presets (480p, 720p, 1080p 30/60fps)
- System audio + app audio capture for screen share

## Architecture
- **Backend:** FastAPI + Python 3.11, MongoDB, LiveKit API, WebSockets
  - `backend/app/main.py` – All API routes (~3400 lines)
  - `backend/app/auth_service.py` – Auth logic (Argon2/bcrypt, JWT, sessions)
  - `backend/app/permissions.py` – Role/permission engine with channel overrides
  - `backend/app/ws.py` – WebSocket manager
  - `backend/app/emailing.py` – Email service (SMTP)
  - `backend/app/blob_storage.py` – S3/MinIO for E2EE file attachments (optional)
  - `backend/app/rate_limits.py` – Rate limiting (login: 10 attempts → 15min block)
  - `backend/server.py` – Entry point
- **Frontend:** React 18, livekit-client, libsodium-wrappers-sumo, i18next (EN/DE)
  - `frontend/src/App.js` – Router, auth context
  - `frontend/src/pages/MainLayout.js` – Main chat layout
  - `frontend/src/contexts/E2EEContext.js` – E2EE state (now works on web + desktop)
  - `frontend/src/lib/e2ee/` – Crypto, key storage (localStorage for web, Tauri keychain for desktop)
  - `frontend/src/lib/voiceEngine.js` – LiveKit voice/video/screenshare engine
  - `frontend/src/lib/screenSharePresets.js` – Quality presets (480p–1080p60)
- **Desktop:** Tauri v2 shell
  - `desktop/` – Tauri config, native API integration (secure keychain, native screen capture)
- **Deployment:**
  - `deploy/` – Docker Compose (quickstart + production with Caddy + TURN)
  - `install.sh` – One-command Linux installer
  - LiveKit SFU: `deploy/livekit.yaml` + docker-compose

## User Personas
- **Self-hosted Community Admins** – Privacy-first Discord alternative
- **End Users** – Communities, teams, friend groups
- **Desktop Power Users** – Tauri app with native screen capture + secure key storage

## Core Requirements (Static)
1. Single-command server install: `./install.sh`
2. E2EE messaging and file attachments (NaCl)
3. Voice/Video with LiveKit SFU + quality selection
4. Screen share with system audio
5. Role/permission system per channel
6. Web version served from the same server
7. Tauri desktop app connecting to any instance
8. Setup wizard for first-run admin bootstrap

## What's Been Implemented
### 2026-04-03 – Initial Setup & Bugfixes
- Created `backend/.env` (MONGO_URL, JWT_SECRET, CORS, LiveKit, VAPID)
- Created `frontend/.env` (REACT_APP_BACKEND_URL)
- Fixed `ModuleNotFoundError: livekit.protocol` → `livekit-protocol==1.1.3`
- Made S3 blob storage optional (no startup crash without S3 credentials)
- Fixed `push_subscriptions` MongoDB index: `endpoint` → `subscription.endpoint`
- Removed debug `console.log` from `ChannelSidebar.js`
- Bootstrapped instance: owner `admin@singravox.local`

### 2026-04-03 – Feature: Server Sidebar Scroll
- Added scrollable container (max 10 items visible, then scrolls)
- Works on all screen sizes via `min(600px, calc(100vh - 160px))`
- `+` Add Server button always visible at bottom
- 13 test servers created and scroll verified

### 2026-04-03 – Feature: E2EE Web Support
- `deviceStorage.js`: localStorage fallback for web (previously Tauri-only)
- `E2EEContext.js`: Removed `isDesktop` gating → E2EE works in browser
- `GlobalSettingsOverlay.js`: E2EE setup form shown on web + security warning
- `ChatArea.js`, `ThreadPanel.js`, `PinnedMessagesPanel.js`: Fixed `isDesktopCapable` blocks
- `E2EEStatus.js`: Removed "Desktop Only" messaging
- `clearIdentity()` now clears localStorage on web
- Backend error messages updated (no more "desktop device" references)
- **Verified:** 1 E2EE message in DB: `ciphertext: T/gmWhy5G05...`, `nonce`, `key_envelopes: 1`

### 2026-04-03 – Feature: Voice/Streaming
- Downloaded and configured LiveKit v1.10.1 (arm64)
- Added LiveKit to supervisor (`/etc/supervisor/conf.d/livekit.conf`)
- Updated backend `.env` with 32-char secret
- Voice token API: `POST /api/voice/token` → **100% working** (returns server_url + JWT)
- Screen share presets: 480p/720p/1080p 30/60fps
- System audio toggle in screen share dialog
- Fixed duplicate `joinVoice` E2EE check in `ChannelSidebar.js`

## Test Status (iteration_8)
- Backend API: **100%**
- Frontend UI: **85%** (voice controls panel requires real microphone)
- E2EE: **Verified** (encrypted message in DB)
- Server scroll: **Verified** (13 servers, scroll container working)
- Voice token: **Verified** (LiveKit JWT generated correctly)

## Prioritized Backlog

### P0 – Blocking for production
- [ ] SMTP configuration (email verification for new users)
- [ ] S3/MinIO for E2EE file attachments (encrypted images)
- [ ] LiveKit external URL for production (ws://localhost:7880 not accessible from browser)

### P1 – Important
- [ ] Tauri desktop app build pipeline
- [ ] Production TURN server (COTURN) for NAT traversal
- [ ] Install.sh end-to-end test on fresh Ubuntu 22.04

### P2 – Backlog
- [ ] Redis for scalable WebSocket broadcast
- [ ] MLS ratchet migration (E2EE v2)
- [ ] macOS/Windows Tauri packaging

## Environment Variables (backend/.env)
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=singravox
JWT_SECRET=singravox-dev-jwt-secret-change-in-production-32bytes
COOKIE_SECURE=false
FRONTEND_URL=https://d13615d9-ee80-4aa3-b700-dae2cf9e7fb2.preview.emergentagent.com
CORS_ORIGINS=https://d13615d9-ee80-4aa3-b700-dae2cf9e7fb2.preview.emergentagent.com,...
LIVEKIT_URL=ws://localhost:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret-singravox-livekit-32chars!!
# S3 (optional, for E2EE file attachments):
# S3_ENDPOINT_URL=http://localhost:9000
# S3_ACCESS_KEY=minioadmin
# S3_SECRET_KEY=minioadmin
# SMTP (required for user registration):
# SMTP_HOST=...
```
