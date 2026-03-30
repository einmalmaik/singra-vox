# Singra Vox – Docker-Konfiguration

## Aufbau

```
deploy/
├── docker-compose.yml           # Entwicklung / kleiner VPS
├── docker-compose.prod.yml      # Produktion mit Caddy + TLS
├── backend.Dockerfile           # FastAPI Backend-Image
├── frontend.Dockerfile          # React Build → nginx
├── nginx/
│   ├── default.conf             # SPA-Routing (Frontend-Container)
│   └── proxy.conf               # Reverse Proxy (API + Frontend)
├── Caddyfile                    # Caddy Reverse Proxy für Produktion
└── .env.example                 # Umgebungsvariablen-Vorlage
```

## Container-Architektur

### Entwicklungs-Compose (`docker-compose.yml`)

```
┌─────────────────────────────────────────────────┐
│                    proxy                         │
│               nginx :80 → :8080                  │
│   /api/* → backend:8001    /* → frontend:80     │
└────────┬───────────────────────────┬────────────┘
         │                           │
┌────────▼────────┐    ┌────────────▼────────────┐
│    backend      │    │       frontend           │
│  FastAPI :8001  │    │  nginx + React Build :80 │
└────────┬────────┘    └──────────────────────────┘
         │
┌────────▼────────┐
│    mongodb      │
│   Mongo :27017  │
└─────────────────┘
```

### Produktions-Compose (`docker-compose.prod.yml`)

Identisch, aber **Caddy** statt nginx-Proxy. Caddy liefert:
- Automatisches HTTPS (Let's Encrypt)
- HTTP→HTTPS Redirect
- HTTP/2

## Environment-Variablen

| Variable | Wo | Pflicht | Beschreibung |
|----------|-----|---------|-------------|
| `JWT_SECRET` | Backend | Ja | 64+ Zeichen, `openssl rand -hex 64` |
| `ADMIN_EMAIL` | Backend | Ja | E-Mail des ersten Admin-Accounts |
| `ADMIN_PASSWORD` | Backend | Ja | Passwort des Admin-Accounts |
| `DB_NAME` | Backend | Nein | MongoDB Datenbankname (default: `singravox`) |
| `MONGO_URL` | Backend | Auto | Wird im Compose automatisch gesetzt |
| `FRONTEND_URL` | Backend | Nein | CORS: erlaubte Frontend-URL |
| `CORS_ORIGINS` | Backend | Nein | Kommagetrennte CORS-Origins |
| `BACKEND_PUBLIC_URL` | Frontend Build | Ja | URL, die der Browser zum Backend nutzt |
| `HTTP_PORT` | Proxy | Nein | Externer Port (default: 8080) |
| `DOMAIN` | Caddy | Prod | Domain für HTTPS |

## Backend Dockerfile

```dockerfile
FROM python:3.11-slim
# Installiert Dependencies, kopiert Code, läuft als non-root User
# Healthcheck auf /api/health
# Port 8001
```

**Features:**
- Non-root User (`singravox`)
- Healthcheck eingebaut
- Minimal-Image (slim)

## Frontend Dockerfile

```dockerfile
# Stage 1: yarn build (React → statische Dateien)
# Stage 2: nginx serviert die Dateien
# Port 80
```

**Features:**
- Multi-Stage Build (kleines finales Image)
- Build-Arg `REACT_APP_BACKEND_URL` wird zur Build-Zeit eingebettet
- SPA-Routing via nginx (alle Routen → index.html)
- Caching-Header für statische Assets

## Reverse Proxy

### Routing-Logik

| Pfad | Ziel |
|------|------|
| `/api/*` | → `backend:8001` (inkl. WebSocket-Upgrade) |
| `/*` | → `frontend:80` (statische Dateien) |

### WebSocket-Support

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 86400s;
```

## Befehle

```bash
# ── Entwicklung ──
cd deploy
cp .env.example .env
docker compose up -d
docker compose logs -f
# → http://localhost:8080

# ── Produktion ──
docker compose -f docker-compose.prod.yml up -d
# → https://deine-domain.de

# ── Rebuild nach Code-Änderungen ──
docker compose build --no-cache
docker compose up -d

# ── Nur Backend neu bauen ──
docker compose build --no-cache backend
docker compose up -d backend

# ── Alles stoppen ──
docker compose down

# ── Alles stoppen + Volumes löschen (ACHTUNG: Datenverlust!) ──
docker compose down -v
```

## Ressourcen

Empfohlene Mindestanforderungen:

| Szenario | RAM | CPU | Disk |
|----------|-----|-----|------|
| Kleine Community (< 50 User) | 1 GB | 1 vCPU | 10 GB |
| Mittlere Community (< 500 User) | 2 GB | 2 vCPU | 20 GB |
| Große Community (< 5000 User) | 4 GB | 4 vCPU | 50 GB+ |

MongoDB-Daten wachsen mit der Nutzung. Regelmäßige Backups empfohlen.
