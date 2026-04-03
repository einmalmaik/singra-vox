# Singra Vox – PRD

## Original Problem Statement
"Importieren Mein Rebo singra-vox, richte es danach in deiner Umgebung ein und dann checke die letzten Änderungen auf Fehler, die entstanden sind. Deine Aufgabe ist es, eine funktionierende App daraus zu machen. Es ist eine Discord-Alternative mit E2E-Verschlüsselung und vieles mehr. Deine Aufgabe ist es daher, zuzuschauen, was wir bereits haben, wo Fehler sind, wo Verwirrungen sind etc. Backend muss getrennt bleiben und das Ganze ist self-hosted, einmal die Tarui-Desktop-App und die Webversion, die vom Server ausgeliefert wird. Der Server-Install soll easy bleiben mit einem Command. Richte alles ein, alte die Docs aktuelle."

## Project Description
Singra Vox is a privacy-first, self-hosted Discord alternative with:
- End-to-End Encryption (E2EE) for messages and attachments
- Web client (React)
- Desktop client (Tauri)
- Voice/Video via LiveKit SFU
- Push notifications via Web-Push (VAPID)
- JWT authentication with refresh tokens
- Role/permission system with channel overrides

## Architecture
- **Backend:** FastAPI + Python, MongoDB, LiveKit integration, WebSockets
  - `backend/app/main.py` – All API routes
  - `backend/app/auth_service.py` – Auth logic (Argon2/bcrypt, JWT)
  - `backend/app/permissions.py` – Role/permission engine with channel overrides
  - `backend/app/ws.py` – WebSocket manager
  - `backend/app/emailing.py` – Email service (SMTP)
  - `backend/app/blob_storage.py` – S3/MinIO for E2EE file attachments
  - `backend/server.py` – Entry point importing FastAPI app
- **Frontend:** React (CRA + CRACO), Tailwind CSS, i18next (EN/DE)
  - `frontend/src/App.js` – Router, auth context
  - `frontend/src/pages/MainLayout.js` – Main chat layout
  - `frontend/src/contexts/RuntimeContext.js` – Dynamic API base URL
- **Desktop:** Tauri v2 shell (wraps the shared React client)
  - `desktop/` – Tauri config and native API integration
- **Deployment:**
  - `deploy/` – Docker Compose (quickstart + production with Caddy)
  - `install.sh` – One-command Linux installer

## User Personas
- **Self-hosted Community Admins** – Tech-savvy users who want a privacy-first Discord alternative
- **End Users** – Communities, teams, friend groups
- **Desktop Power Users** – Using Tauri app for native performance

## Core Requirements (Static)
1. Single-command server install: `./install.sh`
2. E2EE messaging and file attachments
3. Voice/Video with LiveKit SFU
4. Role/permission system per channel
5. Web version served from the same server
6. Tauri desktop app connecting to any Singra Vox instance
7. Setup wizard for first-run admin bootstrap (no config file needed)

## What's Been Implemented
- [2026-04-03] **Initial Setup** – Cloned repo, created .env files, fixed startup errors
  - Created `backend/.env` (MONGO_URL, JWT_SECRET, CORS, LiveKit, VAPID stubs)
  - Created `frontend/.env` (REACT_APP_BACKEND_URL)
  - Fixed `ModuleNotFoundError: livekit.protocol` → installed `livekit-protocol==1.1.3`
  - Made S3 blob storage optional (no crash without S3 credentials)
  - Fixed `push_subscriptions` MongoDB index: `endpoint` → `subscription.endpoint`
  - Removed debug `console.log` from `ChannelSidebar.js`
  - Updated `requirements.txt` with `livekit-protocol==1.1.3`
  - Bootstrapped instance: owner account `admin@singravox.local`
  - **Test result: 100% backend + frontend (iteration_6)**

## Prioritized Backlog

### P0 – Blocking for production
- [ ] SMTP configuration (email verification required for new user registration)
- [ ] S3/MinIO setup for E2EE file attachments
- [ ] LiveKit SFU for real voice/video

### P1 – Important
- [ ] Fix React duplicate key warnings in message list (minor, cosmetic)
- [ ] WebSocket transient close on initial load (cosmetic)
- [ ] Tauri desktop app build and packaging pipeline

### P2 – Nice to have
- [ ] Redis for scalable WebSocket broadcast
- [ ] MLS ratchet migration (E2EE v2)
- [ ] macOS/Windows Tauri distribution

## Next Tasks
1. Configure SMTP (e.g. Resend, Mailgun, Postfix) → add to `backend/.env`
2. Configure S3/MinIO for encrypted blob attachments → add to `backend/.env`
3. Set up LiveKit for real voice/video (included in docker-compose)
4. Build and test Tauri desktop client
5. Production deployment via `./install.sh` mode 2 (domain + HTTPS)
