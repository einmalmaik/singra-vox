# PRD - Singra Vox

## Problem Statement
Singra Vox – selbst-gehostete, verschlüsselte Chat-Plattform (Discord-ähnlich).
Repo eingerichtet, alle Services konfiguriert, Tests bestanden.

## Architektur
- **Backend:** FastAPI (Python) Port 8001
- **Frontend:** React.js Port 3000
- **DB:** MongoDB
- **E-Mail:** Resend SMTP (smtp.resend.com:465, noreply@mauntingstudios.de)
- **Voice/Video:** LiveKit Cloud (wss://singavoice-s8k5vkdx.livekit.cloud)
- **E2EE Storage:** MinIO S3 (localhost:9000, Bucket: singravox-e2ee)
- **Push Notifications:** VAPID Web Push (VAPID keys gesetzt)
- **Desktop:** Tauri (GitHub Actions Release-Workflow für Windows/Linux/macOS)
- **GitHub:** https://github.com/einmalmaik/singra-vox

## Umgesetzt (04.04.2026)

### Session 1
- Repo-Setup, Abhängigkeiten, Instanz-Bootstrap, Owner-Konto
- Tests: 100%

### Session 2
- Resend SMTP (smtp.resend.com:465, noreply@mauntingstudios.de, domain verifiziert)
- MinIO S3 (localhost:9000, Bucket singravox-e2ee, via Supervisor)
- LiveKit Cloud (wss://singavoice-s8k5vkdx.livekit.cloud, API Key + Secret)
- Channel-Modal-Design (lila → cyan, workspace-style)
- README + docs aktualisiert für Selfhosting
- tauri.conf.json: Signing-PublicKey + einmalmaik/singra-vox URL
- Tests: 100% (9/9)

### Session 3
- VAPID Web Push Notifications generiert + konfiguriert (Backend + Service Worker bereits vorhanden)
- Resend from email: noreply@mauntingstudios.de (Sendung bestätigt)
- VAPID_EMAIL: noreply@mauntingstudios.de
- Tauri Signing Keys generiert (Public Key in tauri.conf.json, Private Key für GitHub Secrets)
- GitHub-Repo-URL in allen Docs gesetzt: einmalmaik/singra-vox
- Tests: 100% (9/9)

## Credentials
- Email: einmalmaik@gmail.com | Username: einmalmaik | Password: T6qlck35l7z8h | Role: owner

## Services Status (alle RUNNING)
| Service | Status | Port |
|---------|--------|------|
| Backend (FastAPI) | RUNNING | 8001 |
| Frontend (React) | RUNNING | 3000 |
| MongoDB | RUNNING | 27017 |
| MinIO (S3) | RUNNING | 9000 |
| LiveKit Cloud | CONFIGURED | Cloud |
| Resend SMTP | CONFIGURED + GETESTET | smtp.resend.com:465 |
| VAPID Push | CONFIGURED | - |

## Tauri GitHub Secrets (einmalig in GitHub hinterlegen)
- TAURI_SIGNING_PRIVATE_KEY: (in /app/memory/test_credentials.md)
- TAURI_SIGNING_PRIVATE_KEY_PASSWORD: (leer)

## Backlog
- P1: `git tag v0.3.0 && git push origin v0.3.0` → Windows/Linux/macOS Installer
- P1: TURN-Server für NAT-Traversal bei restriktiven Firewalls
- P2: macOS Notarisierung (Apple Developer Account)
- P2: Auto-Update in Tauri aktivieren (active: true in tauri.conf.json sobald Repo live)
