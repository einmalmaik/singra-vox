# Singra Vox

**Privacy-first communication platform.** Self-hosted chat, voice, and encrypted channels – with a central identity system that lets users maintain one account across all instances.

## Quick Start (1 Command)

```bash
git clone https://github.com/einmalmaik/singra-vox.git
cd singra-vox
bash install.sh
```

That's it. The installer guides you through everything:
- Docker setup (automatic)
- Database, encryption, secrets (auto-generated)
- SMTP for emails (built-in or external)
- Admin account creation
- LiveKit voice/video
- Optional: Singra Vox ID, auto-updates

### After Install

```bash
bash install.sh --status          # Health check & diagnostics
bash install.sh --repair          # Auto-fix broken config
bash install.sh --update          # Update to latest version
bash install.sh --identity        # Set up Singra Vox ID
bash install.sh --auto-update-on  # Enable daily auto-updates
bash install.sh --help            # All options
```

## Documentation

| Document | Description |
|----------|-------------|
| [Self-Hosting Guide](docs/self-hosting.md) | Complete self-hosting manual (DE) |
| [Singra Vox ID](docs/singra-vox-id.md) | Central identity system – API reference, architecture, security |
| [Deployment Guide](docs/deployment-linux.md) | Linux deployment with Docker or bare-metal |
| [Identity Server Deployment](docs/deploy-identity-server.md) | Deploy Singra Vox ID as a standalone service |
| [Architecture](docs/architecture.md) | System architecture and design decisions |
| [Encryption](docs/encryption.md) | Encryption at rest & E2EE deep dive |
| [Tauri Desktop Guide](docs/tauri-guide.md) | Building the desktop application |
| [Docker Setup](docs/docker-setup.md) | Docker Compose development environment |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and solutions |
| [Contributing](docs/contributing.md) | How to contribute |
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
- **Auto-Updates** – One-command server updates with optional daily auto-update

## Architecture

```
                    Singra Vox ID Server
                  (id.singravox.com)

  /api/id/register    – Account creation
  /api/id/login       – Authentication + 2FA
  /api/id/oauth/*     – OAuth2/OIDC for instances
  /api/id/invites/*   – Cross-instance invitations
  /api/id/instances   – User's connected instances
               │ OAuth2                │ OAuth2
               ▼                       ▼
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
| E2EE | libsodium (X25519, XChaCha20-Poly1305) + AES-256-GCM at rest |

## Development Setup

> For production deployment, just use `bash install.sh`. The section below is for developers.

### Prerequisites
- Node.js 18+ and Yarn
- Python 3.11+
- MongoDB 6+
- (Optional) LiveKit server for voice

### Manual Setup

```bash
# 1. Clone
git clone https://github.com/einmalmaik/singra-vox.git
cd singra-vox

# 2. Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # Edit: set MONGO_URL, JWT_SECRET, etc.
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# 3. Frontend (new terminal)
cd frontend
cp .env.example .env   # Edit if needed
yarn install
yarn start             # Runs on port 3000
```

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URL` | Yes | MongoDB connection string |
| `DB_NAME` | Yes | Database name |
| `JWT_SECRET` | Yes | JWT signing secret (min. 32 chars) |
| `INSTANCE_ENCRYPTION_SECRET` | Yes | **Encryption key for ALL data** – never change after first set! |
| `FRONTEND_URL` | Yes | Frontend URL for CORS |
| `COOKIE_SECURE` | Yes | `true` for HTTPS, `false` for HTTP |
| `LIVEKIT_URL` | No | LiveKit server URL |
| `LIVEKIT_API_KEY` | No | LiveKit API key |
| `LIVEKIT_API_SECRET` | No | LiveKit API secret |
| `SMTP_HOST` | No | SMTP server for emails |
| `SMTP_PASSWORD` | No | SMTP password / API key |
| `SMTP_FROM_EMAIL` | No | Sender email address |
| `SVID_ISSUER` | No | Singra Vox ID server URL |
| `SVID_JWT_SECRET` | No | SVID JWT signing secret |

> See `backend/.env.example` for all variables with documentation.

### Frontend (`frontend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `REACT_APP_BACKEND_URL` | Build-time | Backend URL (runtime uses `window.location.origin`) |

> See `frontend/.env.example` for details.

## Contributing

Singra Vox is open source. Contributions are welcome.

- Code should be readable by human developers, not just AI
- Keep modules independent and well-documented
- Follow existing patterns (FastAPI routers, React contexts, i18n keys)
- Test with multiple users before submitting
- See [Contributing Guide](docs/contributing.md) for details

## License

Open Source – see LICENSE file.
