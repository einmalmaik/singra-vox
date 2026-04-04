# PRD - Singra Vox

## Originales Problem Statement
"Pull the existing repo, set it up, create account with einmalmaik@gmail.com, username einmalmaik, password T6qlck35l7z8h. Set up SMTP (Resend), MinIO for E2EE file uploads, LiveKit Cloud for voice, fix channel creation modal design, fix server creation permissions, build Tauri desktop app via GitHub Actions."

## Architektur
- **Backend:** FastAPI (Python) auf Port 8001
- **Frontend:** React.js auf Port 3000
- **Datenbank:** MongoDB (singravox DB)
- **E-Mail:** Resend via SMTP (smtp.resend.com:465)
- **Voice/Video:** LiveKit Cloud (wss://singavoice-s8k5vkdx.livekit.cloud)
- **E2EE Storage:** MinIO S3 (localhost:9000, Bucket: singravox-e2ee)

## Was wurde gemacht

### Session 1 (04.04.2026)
- Repo analysiert, Abhängigkeiten installiert
- Backend & Frontend gestartet
- Instanz bootstrapped, Owner-Konto erstellt
- Tests: 100% PASS

### Session 2 (04.04.2026)
- **Resend SMTP** konfiguriert (smtp.resend.com:465, API Key in .env)
- **MinIO** installiert + gestartet via Supervisor, Bucket `singravox-e2ee` erstellt
- **LiveKit Cloud** konfiguriert (wss://singavoice-s8k5vkdx.livekit.cloud, API Key + Secret)
- **Channel-Erstellungs-Modal** Design repariert (purple → cyan workspace style)
- **Server-Erstellungs-Berechtigung** nur für Owner (bereits korrekt implementiert)
- **README** + **docs/deployment-linux.md** aktualisiert für Selfhosting mit Resend + LiveKit Cloud
- **tauri.conf.json** Updater-Platzhalter deaktiviert (active: false)
- Tests: 100% PASS

## Credentials
- Email: einmalmaik@gmail.com
- Username: einmalmaik
- Password: T6qlck35l7z8h
- Role: owner

## Services Status
| Service | Status |
|---------|--------|
| Backend (FastAPI) | RUNNING :8001 |
| Frontend (React) | RUNNING :3000 |
| MongoDB | RUNNING |
| MinIO (S3) | RUNNING :9000 |
| LiveKit Cloud | CONFIGURED (Cloud) |
| Resend SMTP | CONFIGURED (domain verification needed for external emails) |

## Bekannte Einschränkungen
- **Resend**: Ohne verifizierte Domain können E-Mails nur an den Resend-Account-Inhaber (mauntingstudios@gmail.com) gesendet werden. Auto-Bypass bleibt aktiv als Fallback.
- **Tauri Desktop Build**: GitHub Actions Workflow (release.yml) bereits konfiguriert. Push eines Tags (z.B. `git tag v0.3.0 && git push origin v0.3.0`) triggert automatischen Build für Windows, Linux, macOS.
- **MinIO Binary**: Muss nach Pod-Neustart neu heruntergeladen werden (Binary unter /usr/local/bin/minio)

## P0/P1/P2 Backlog
- P1: Resend Domain verifizieren für echte E-Mails (resend.com/domains)
- P1: GitHub Repo einrichten + ersten Tag pushen für Tauri-Installer
- P2: TURN-Server für NAT-Traversal (LiveKit voice hinter restriktiven Firewalls)
- P2: VAPID Keys für Web Push Notifications konfigurieren
