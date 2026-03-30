# Singra Vox

Privacy-first, self-hosted communication platform. Discord-Funktionalität, TeamSpeak-Administration, ohne Telemetrie.

## Quickstart (Entwicklung)

```bash
# Backend
cd backend
cp .env.example .env          # JWT_SECRET + ADMIN_PASSWORD setzen
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Frontend
cd frontend
cp .env.example .env           # REACT_APP_BACKEND_URL setzen
yarn install
yarn start
```

## Quickstart (Docker)

```bash
cd deploy
cp .env.example .env           # Werte anpassen
docker compose up -d
# → http://localhost:8080
```

## Projektstruktur

```
singravox/
├── backend/                 # FastAPI API-Server
│   ├── server.py            # Haupt-App + Routen
│   ├── routes_phase2.py     # Phase-2-Erweiterungen
│   ├── requirements.txt
│   ├── .env                 # Lokale Konfiguration
│   └── .env.example
│
├── frontend/                # React Web-Client
│   ├── src/
│   │   ├── App.js           # Router + Auth-Wrapper
│   │   ├── contexts/        # AuthContext
│   │   ├── lib/             # api.js, crypto.js (E2EE)
│   │   ├── pages/           # Login, Register, Setup, MainLayout
│   │   ├── components/
│   │   │   ├── chat/        # ServerSidebar, ChannelSidebar, ChatArea, MemberSidebar, ThreadPanel
│   │   │   ├── modals/      # InviteModal, ServerSettingsModal, SearchDialog
│   │   │   └── ui/          # Shadcn/UI Basis-Komponenten
│   │   └── index.css        # Design-System
│   ├── desktop/             # Tauri Desktop-Client (Vorbereitung)
│   ├── .env.example
│   └── package.json
│
├── deploy/                  # Docker + Deployment
│   ├── docker-compose.yml         # Dev / Small VPS
│   ├── docker-compose.prod.yml    # Produktion mit Caddy + TLS
│   ├── backend.Dockerfile
│   ├── frontend.Dockerfile
│   ├── nginx/
│   │   ├── default.conf          # Frontend SPA-Routing
│   │   └── proxy.conf            # Reverse-Proxy (API + Frontend)
│   ├── Caddyfile                  # Produktion: automatisches HTTPS
│   └── .env.example
│
├── docs/
│   ├── architecture.md            # Architektur + Web/Tauri-Strategie
│   ├── deployment-linux.md        # Schritt-für-Schritt Linux-Deployment
│   ├── docker-setup.md            # Docker-Konfiguration im Detail
│   └── tauri-guide.md             # Tauri Desktop-Client Guide
│
└── README.md
```

## Architektur

```
┌─────────────────┐    ┌─────────────────┐
│   Web-Browser   │    │  Tauri Desktop  │
│   (React SPA)   │    │  (React + Rust) │
└────────┬────────┘    └────────┬────────┘
         │  REST + WebSocket    │
         └──────────┬───────────┘
                    │
         ┌──────────▼──────────┐
         │    Reverse Proxy    │
         │  (nginx / Caddy)    │
         └──────────┬──────────┘
                    │
    ┌───────────────▼───────────────┐
    │      Singra Vox Backend       │
    │    FastAPI + WebSocket        │
    └───────────────┬───────────────┘
                    │
              ┌─────▼─────┐
              │  MongoDB   │
              └────────────┘
```

Web-Client und Desktop-Client nutzen **dieselbe API**. Der Server ist unabhängig von beiden Clients deploybar.

## Features

- **Text-Channels** mit Threads, Mentions, Reactions, Dateianhängen, Suche
- **Voice-Channels** (UI-Status, Architektur vorbereitet für WebRTC/LiveKit)
- **Direkt-Nachrichten** mit echter Ende-zu-Ende-Verschlüsselung (ECDH + AES-GCM)
- **Gruppen-DMs**
- **Rollen & Rechte** (17 granulare Permissions, Channel-Overrides)
- **Moderation** (Ban, Kick, Mute, Timeout, Audit-Log)
- **Invite-System**
- **Ungelesen-Tracking** mit Mention-Badges
- **Temporäre & Private Räume**
- **Keine Telemetrie**, keine Third-Party-Analytics

## Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [docs/architecture.md](docs/architecture.md) | Architektur, Web + Tauri, Datenmodell |
| [docs/deployment-linux.md](docs/deployment-linux.md) | Linux-Server-Deployment Schritt für Schritt |
| [docs/docker-setup.md](docs/docker-setup.md) | Docker-Konfiguration im Detail |
| [docs/tauri-guide.md](docs/tauri-guide.md) | Tauri Desktop-Client aufsetzen |

## Lizenz

Self-hosted. Kein Vendor-Lock-in. Deine Instanz, deine Daten.
