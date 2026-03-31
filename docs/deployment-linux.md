# Linux Deployment

This guide targets Ubuntu 22.04+ and Debian 12+.

## Recommended Path

```bash
git clone <your-repo-url> /opt/singra-vox
cd /opt/singra-vox
chmod +x install.sh
./install.sh
```

Choose:

- `Quickstart` for HTTP on `IP:Port`
- `Production` for domain + HTTPS via Caddy

The installer generates:

- `deploy/.env`
- `deploy/livekit.yaml`
- `deploy/turnserver.conf`

and then starts the selected Docker Compose stack.

## First Boot

After the containers start:

1. open the printed `/setup` URL
2. create the first owner account
3. sign in
4. create the first community from the onboarding screen

There is no admin password in `.env` anymore.

## Manual Docker Commands

```bash
cd /opt/singra-vox/deploy

# Quickstart
docker compose up -d --build

# Production
docker compose -f docker-compose.prod.yml up -d --build
```

## Ports

- `80` / `443` for web in production
- `8080` by default for quickstart web
- `7880` LiveKit signaling
- `7881/tcp` LiveKit TCP fallback
- `7882/udp` LiveKit UDP media
- `3478` TURN when the optional `turn` profile is enabled

## Logs

```bash
cd /opt/singra-vox/deploy
docker compose logs -f
docker compose logs -f backend
docker compose logs -f livekit
```

## Updates

```bash
cd /opt/singra-vox
git pull
cd deploy
docker compose up -d --build
```

