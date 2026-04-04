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
4. create the first server from the onboarding screen

There is no admin password in `.env` anymore.

## Manual Docker Commands

```bash
cd /opt/singra-vox/deploy

# Quickstart
docker compose up -d --build

# Production
docker compose -f docker-compose.prod.yml up -d --build
```

## Email Configuration (Resend)

Set these in `deploy/.env` for email verification and password reset:

```env
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USERNAME=resend
SMTP_PASSWORD=re_YOUR_API_KEY
SMTP_FROM_EMAIL=noreply@your-domain.com
SMTP_FROM_NAME=Singra Vox
SMTP_USE_TLS=false
SMTP_USE_SSL=true
```

Get your API key at [resend.com](https://resend.com). Without a verified sender domain, use `onboarding@resend.dev` as `SMTP_FROM_EMAIL`.

> Without SMTP configured, new users are automatically verified (development only).

## Voice & Video (LiveKit)

### LiveKit Cloud (recommended)

```env
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_PUBLIC_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxxxxx
LIVEKIT_API_SECRET=your_api_secret_from_dashboard
```

Get credentials from [livekit.io](https://livekit.io) → Project → Settings → API Keys.

### Self-hosted LiveKit

The Docker Compose stack includes a LiveKit container. Open these firewall ports:

- `7880` LiveKit signaling (TCP)
- `7881/tcp` LiveKit TCP fallback
- `7882/udp` LiveKit UDP media
- `3478` TURN when the optional `turn` profile is enabled

```env
LIVEKIT_URL=ws://livekit:7880
LIVEKIT_PUBLIC_URL=wss://rtc.your-domain.com
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=at-least-32-character-secret!!
```

## Ports

- `80` / `443` for web in production
- `8080` by default for quickstart web
- `7880` LiveKit signaling (self-hosted only)
- `7882/udp` LiveKit media (self-hosted only)

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
