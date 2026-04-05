# Singra Vox

**Privacy-first communication platform.** Self-hosted chat, voice, and encrypted channels – with a central identity system that lets users maintain one account across all instances.

## Quick Links

| Document | Description |
|----------|-------------|
| [Singra Vox ID](docs/singra-vox-id.md) | Central identity system – API reference, architecture, security |
| [Deployment Guide](docs/deployment-linux.md) | Self-hosting on Linux with Docker or bare-metal |
| [Identity Server Deployment](docs/deploy-identity-server.md) | Deploy Singra Vox ID as a standalone service |
| [Architecture](docs/architecture.md) | System architecture and design decisions |
| [Tauri Desktop Guide](docs/tauri-guide.md) | Building the desktop application |
| [Docker Setup](docs/docker-setup.md) | Docker Compose development environment |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |
| [Release Process](docs/RELEASING.md) | How to create releases |

## Features

### Communication
- **Text Channels** – Rich messaging with replies, threads, mentions, pins, attachments
- **Voice Channels** – Real-time voice via LiveKit with screen sharing and quality presets
- **Direct Messages** – Private 1:1 and group conversations
- **End-to-End Encryption** – E2EE for private channels, DMs, and voice (optional)

### Identity & Auth
- **Singra Vox ID** – One account for all instances (OAuth2/OIDC, self-hostable)
- **Two-Factor Authentication** – TOTP with Google Authenticator/Authy + backup codes
- **Local Accounts** – Instance-only accounts still supported (backward compatible)
- **Cross-Instance Invites** – Invite users by their Singra Vox ID username
- **Password Security** – Strength scoring, policy enforcement, auto-generator

### Administration
- **Roles & Permissions** – 23 granular permissions with channel overrides
- **Server Management** – Create servers, channels, categories
- **Moderation** – Kick, ban, mute, audit log
- **Instance Settings** – Open/closed registration, instance name, owner management

### Platform
- **12 Languages** – EN, DE, FR, ES, IT, NL, PT, PL, SV, DA, NO, FI (auto-detected)
- **Desktop App** – Tauri-based (Windows, macOS, Linux) with auto-updater
- **Web App** – Full-featured browser client
- **Push Notifications** – VAPID web push
- **Self-Hosted** – Your server, your data, your rules

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Singra Vox ID Server                         │
│                  (id.singravox.com)                             │
│                                                                 │
│  /api/id/register    – Account creation                         │
│  /api/id/login       – Authentication + 2FA                     │
│  /api/id/oauth/*     – OAuth2/OIDC for instances                │
│  /api/id/invites/*   – Cross-instance invitations               │
│  /api/id/instances   – User's connected instances               │
└──────────────┬───────────────────────┬──────────────────────────┘
               │ OAuth2                │ OAuth2
               ▼                      ▼
┌──────────────────────┐  ┌──────────────────────┐
│   Instance A         │  │   Instance B         │
│   gaming.example.com │  │   work.example.com   │
│                      │  │                      │
│   Messages, Voice,   │  │   Messages, Voice,   │
│   E2EE, Permissions  │  │   E2EE, Permissions  │
│   (100% local data)  │  │   (100% local data)  │
└──────────────────────┘  └──────────────────────┘
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Python 3.11, FastAPI, Motor (async MongoDB) |
| Frontend | React 19, Tailwind CSS, Radix UI |
| Database | MongoDB |
| Voice | LiveKit (WebRTC SFU) |
| Desktop | Tauri 2 (Rust) |
| Email | Resend (SMTP) |
| Auth | JWT, Argon2id, TOTP 2FA, OAuth2/OIDC |
| E2EE | libsodium (X25519, XChaCha20-Poly1305) |

## Getting Started

### Prerequisites
- Node.js 18+ and Yarn
- Python 3.11+
- MongoDB 6+
- (Optional) LiveKit server for voice

### Development Setup

```bash
# 1. Clone
git clone https://github.com/your-org/singravox.git
cd singravox

# 2. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # Configure MONGO_URL, JWT_SECRET, etc.
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# 3. Frontend (new terminal)
cd frontend
yarn install
yarn start  # Runs on port 3000
```

### Production Deployment

See [Deployment Guide](docs/deployment-linux.md) for full instructions with Docker, nginx, and SSL.

For deploying the Singra Vox ID server separately, see [Identity Server Deployment](docs/deploy-identity-server.md).

## Environment Variables

### Instance Backend (.env)

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URL` | Yes | MongoDB connection string |
| `DB_NAME` | Yes | Database name |
| `JWT_SECRET` | Yes | JWT signing secret |
| `FRONTEND_URL` | Yes | Frontend URL for CORS |
| `LIVEKIT_URL` | No | LiveKit server URL |
| `LIVEKIT_API_KEY` | No | LiveKit API key |
| `LIVEKIT_API_SECRET` | No | LiveKit API secret |
| `SMTP_HOST` | No | SMTP server for emails |
| `SMTP_PASSWORD` | No | SMTP password / API key |
| `SMTP_FROM_EMAIL` | No | Sender email address |
| `SVID_ISSUER` | No | Singra Vox ID server URL |
| `SVID_JWT_SECRET` | No | SVID JWT signing secret |

## Contributing

Singra Vox is open source. Contributions are welcome.

- Code should be readable by human developers, not just AI
- Keep modules independent and well-documented
- Follow existing patterns (FastAPI routers, React contexts, i18n keys)
- Test with multiple users before submitting

## License

Open Source – see LICENSE file.
