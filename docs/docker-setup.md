# Docker Stack

## Services

### `docker-compose.yml`

- `mongodb`
- `backend`
- `frontend`
- `proxy` (nginx)
- `livekit`
- `coturn` under the optional `turn` profile

### `docker-compose.prod.yml`

- same core services
- `caddy` instead of the simple nginx edge proxy
- `LIVEKIT_URL` points to `wss://$RTC_DOMAIN`

## Bootstrap Model

- No admin credentials are stored in env files.
- The stack only boots the infrastructure.
- The first owner account is created later via `POST /api/setup/bootstrap` through the `/setup` wizard.

## Important Environment Variables

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Backend signing key |
| `COOKIE_SECURE` | Secure cookies for HTTPS |
| `FRONTEND_URL` | Public web origin |
| `CORS_ORIGINS` | Explicit allowed origins |
| `LIVEKIT_URL` | Public LiveKit WebSocket URL |
| `LIVEKIT_API_KEY` | Backend token issuer key |
| `LIVEKIT_API_SECRET` | Backend token issuer secret |
| `DOMAIN` | Main production domain |
| `RTC_DOMAIN` | Voice production domain |

## Reverse Proxy

- Web: `/` -> `frontend`
- API and websocket auth/events: `/api/*` -> `backend`
- Production voice domain: `rtc.<domain>` -> `livekit`

## Optional TURN

TURN is prepared through `deploy/turnserver.conf` and the `coturn` service.

Enable it explicitly:

```bash
cd deploy
docker compose --profile turn up -d
```

