# Proxy-/Health-Check: Timeout-Analyse & Hardening (konfigurierbar)

## Kontext (Ist-Zustand)
- Backend Health Endpoint:
  - `GET /api/health` liefert ein statisches JSON: [main.py](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/backend/app/main.py#L3157-L3159)
- Docker Healthchecks:
  - Backend: `timeout: 5s`, `retries: 3` (compose) + Dockerfile Healthcheck `--timeout=5s`: [docker-compose.yml](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/deploy/docker-compose.yml#L51-L55), [backend.Dockerfile](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/deploy/backend.Dockerfile#L24-L27)
- Proxy:
  - dev nginx reverse proxy mit sehr hohen WS timeouts: [proxy.conf](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/deploy/nginx/proxy.conf)
  - prod Caddy reverse proxy: [Caddyfile](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/deploy/Caddyfile)
- Frontend HTTP Client (Axios) hat keinen Timeout (Default unbegrenzt): [api.js](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/frontend/src/lib/api.js#L20-L30)
- Es existiert kein PowerShell-Healthcheck im Repo; ein beobachteter PS-Timeout ist daher vermutlich ein externer Operator-/Dev-Workflow.

## Ziele
- Systematische Timeout-Analyse:
  - Wo entstehen Timeouts (DNS, TCP connect, TLS handshake, Proxy routing, Backend stall)?
- Hardening:
  - klare, getrennte Endpoints: liveness/readiness/startup.
  - konfigurierbare Timeouts + Retries (mit Backoff/Jitter).
  - strukturierte Logs (Request-IDs) zur Diagnose.
- Environment-variable Konfiguration (Dev/CI/Prod).

Quellen/Best Practices:
- Kubernetes Probe Parameter (u.a. `timeoutSeconds` Default 1s) und Warnungen zu falschen Liveness-Probes: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/

## Analyse-Leitfaden (reproduzierbar)

### 1) Aufsplitten des “Timeout” in Phasen
- DNS: Auflösung `apiBase`/Proxy Host
- TCP Connect
- TLS handshake (falls HTTPS)
- HTTP Request/Response (Server stall / Proxy buffering)

### 2) Logging-Anker (minimal-invasiv)
- Proxy:
  - Nginx: `request_time`, `upstream_response_time`, `upstream_status`, `connection`/`request_id`.
  - Caddy: structured logs + upstream duration.
- Backend:
  - Middleware, die `X-Request-Id` setzt/propagiert (falls nicht vorhanden) und Timing loggt:
    - `route`, `method`, `status`, `duration_ms`, `request_id`.

### 3) Client-Side Beobachtung
- Axios: setzbarer globaler Timeout + Retry auf transiente Fehler.
- WebSocket: vorhandenes Heartbeat/Reconnect ist ok; ergänzend Logging für reconnect reasons.

## Design: Health Endpoints

### Backend Endpoints (Vorschlag)
- `GET /api/health/live`
  - “Process lebt” (keine DB, keine externen Abhängigkeiten)
  - Antworten: `200` oder `503`
- `GET /api/health/ready`
  - “bereit für Traffic”: prüft z.B. Mongo Ping + essentielle Config (optional)
  - Antworten: `200` oder `503` + Details (ohne Secrets)
- `GET /api/health/startup`
  - solange Startup läuft: `503`, danach `200`

Antwortformat (vereinheitlicht):
```json
{
  "status": "ok|degraded|fail",
  "service": "Singra Vox",
  "checks": {
    "mongo": {"status":"ok","latency_ms":1},
    "redis": {"status":"ok","latency_ms":1}
  },
  "request_id": "uuid"
}
```

## Design: Timeout/Retry Konfiguration

### Env Vars (Vorschlag)
- Backend (für Dependency Checks):
  - `HEALTHCHECK_MONGO_TIMEOUT_MS=500`
  - `HEALTHCHECK_REDIS_TIMEOUT_MS=500`
- Docker/Compose:
  - `HEALTHCHECK_INTERVAL_S`
  - `HEALTHCHECK_TIMEOUT_S`
  - `HEALTHCHECK_RETRIES`
  - `HEALTHCHECK_START_PERIOD_S`
- Frontend/CLI:
  - `API_TIMEOUT_MS` (globaler Axios timeout)
  - `API_RETRY_ATTEMPTS`
  - `API_RETRY_BASE_DELAY_MS`
  - `API_RETRY_MAX_DELAY_MS`
  - `API_RETRY_JITTER=0|1`

### Retry Policy (Client/Health Probes)
- Nur für transiente Fehler:
  - `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `429`, `503`, `504`
- Exponential backoff + jitter, damit mehrere Instanzen nicht “synchron” hämmern.

## Design: Proxy Hardening

### Nginx (dev)
- Für `/api/health/*`:
  - kurze Timeouts (z.B. `proxy_read_timeout` klein), keine WebSocket Header nötig.
- Für `/api/ws`:
  - bestehende hohen WS-Timeouts ok; zusätzlich `proxy_next_upstream` nicht relevant für WS.

### Caddy (prod)
- Optional: separate handle für `/api/health/*` mit eigenem `reverse_proxy` timeout.

## Optional: PowerShell Healthcheck (neu, für Operatoren)
Ein dediziertes Script (nicht zwingend für das Produkt) kann die oben erwähnte Phasen-Analyse unterstützen:
- `Invoke-WebRequest -TimeoutSec ...` für total-timeout,
- zusätzlich `Resolve-DnsName` + `Test-NetConnection` zur Segmentierung.

## Tests

### Unit Tests (Backend)
- Healthcheck Handler:
  - liveness immer schnell.
  - readiness: mocking Mongo down → `503` + `checks.mongo=fail`.

### Integration Tests
- Docker Compose:
  - `backend` wird nicht “unhealthy” während Mongo Cold Start, wenn `start_period` gesetzt ist.
- Proxy:
  - `/api/health/*` über Proxy erreichbar, `request_id` wird propagiert.

### Performance/Chaos Tests
- künstliche Latenz auf Mongo/Redis: readiness wird “degraded/fail”, liveness bleibt ok.
- Simulierter Packet loss: Retries greifen, aber stoppen nach Max-Zeitfenster.

## Implementierungsschritte (milestone-basiert)
- M0: Logging/Request-ID Middleware + neue Endpoints live/ready/startup.
- M1: Docker/Compose healthcheck settings (start_period, retries, timeouts) + Docs.
- M2: Frontend Axios Timeout/Retry + Telemetrie-freies Error Logging (konfigurierbar).
- M3: Proxy config für health routes + bessere upstream timing logs.
- M4: Repro-Skripte (optional) + Regression/Chaos Tests.

