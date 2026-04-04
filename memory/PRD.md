# PRD - Singra Vox

## Originales Problem Statement
"Pulle das angehängte repo, richte es ein, erstelle ein Konto mit einmalmaik@gmail.com, Name einmalmaik und Passwort T6qlck35l7z8h, teste danach ob alles läuft und beweise mir das alles korrekt funktioniert"

## Architektur
- **Backend:** FastAPI (Python) auf Port 8001
- **Frontend:** React.js auf Port 3000
- **Datenbank:** MongoDB (singravox DB)
- **App-Name:** Singra Vox (Chat-Anwendung mit E2EE, Voice, Server-System)

## Was wurde gemacht (04.04.2026)
1. Repo analysiert - vorhandenes Singra Vox Chat-Projekt
2. Python-Abhängigkeiten installiert (`pip install -r requirements.txt`)
3. Node-Abhängigkeiten installiert (`yarn install`)
4. Backend & Frontend via Supervisor gestartet
5. Instanz via `/api/setup/bootstrap` initialisiert
6. Konto erstellt: einmalmaik@gmail.com / einmalmaik / T6qlck35l7z8h (Owner-Rolle)
7. End-to-End Tests durchgeführt - alle BESTANDEN (100%)

## Getestete Features
- App lädt korrekt im Browser ✅
- Login mit einmalmaik@gmail.com / T6qlck35l7z8h ✅
- POST /api/auth/login → access_token, user.role=owner ✅
- GET /api/auth/me → korrekte Benutzerdaten ✅
- GET /api/setup/status → initialized=true, instance_name=Singra Vox ✅
- Dashboard/Onboarding nach Login ✅

## Bekannte Einschränkungen (nicht blockierend)
- S3/MinIO nicht verfügbar → E2EE Blob-Uploads deaktiviert
- LiveKit nicht verfügbar → Voice-Channels deaktiviert
- SMTP nicht verfügbar → E-Mail-Verifikation auto-bypassed (User wird auto-verifiziert)
- WebSocket-Warnungen beim Login (nicht blockierend, reconnect nach Session)

## Credentials
- Email: einmalmaik@gmail.com
- Username: einmalmaik
- Password: T6qlck35l7z8h
- Role: owner

## P0/P1/P2 Backlog
- P2: SMTP konfigurieren für echte E-Mail-Verifikation
- P2: MinIO/S3 konfigurieren für E2EE Blob-Storage
- P2: LiveKit konfigurieren für Voice-Channels
