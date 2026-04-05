# Linux Deployment

This guide targets Ubuntu 22.04+ and Debian 12+.

## Recommended Path (1 Command)

```bash
git clone https://github.com/einmalmaik/singra-vox.git /opt/singra-vox
cd /opt/singra-vox
bash install.sh
```

The installer is interactive and guides you through:

- **Storage Mode** – Lite (local filesystem) or Full (MinIO S3)
- **Install Mode** – Quickstart (HTTP) or Production (HTTPS + Let's Encrypt)
- **Server Name** – Your instance name
- **Admin Account** – Email, username, password
- **SMTP** – Built-in (Mailpit) or external (Resend, Gmail, etc.)
- **Singra Vox ID** – Optional identity server setup
- **Auto-Updates** – Optional daily automatic updates

All secrets (JWT, encryption key, VAPID, LiveKit) are auto-generated.
Configuration is stored in `/opt/singravox/.env`.

## After Install

```bash
bash install.sh --status          # Health check & diagnostics
bash install.sh --repair          # Auto-fix broken config
bash install.sh --update          # Update to latest version
bash install.sh --identity        # Set up Singra Vox ID
bash install.sh --auto-update-on  # Enable daily auto-updates
bash install.sh --help            # All options
```

## First Boot

After the containers start:

1. Open the printed URL in your browser
2. Log in with the admin credentials you set during install
3. Create your first server from the onboarding screen
4. Invite friends via invite links

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

**Recommended: Use the installer**
```bash
cd /opt/singra-vox
bash install.sh --update
```

This pulls the latest code, rebuilds images, and restarts services with zero downtime.
Your configuration and data remain fully intact.

**Enable daily auto-updates:**
```bash
bash install.sh --auto-update-on
```

**Manual Docker commands:**
```bash
cd /opt/singra-vox
git pull
cd deploy
docker compose up -d --build
```
