# Deploying Singra Vox ID as a Standalone Service

## Overview

The Singra Vox ID server can run as:
1. **Integrated** – Part of an existing Singra Vox instance (default, simplest)
2. **Standalone** – As its own service on a dedicated server/domain (recommended for production)

### Quick Setup via Installer

If you already have a running Singra Vox instance, the easiest way to enable Singra Vox ID:

```bash
bash install.sh --identity
```

This guides you through choosing integrated or standalone mode and configures everything automatically.

For manual setup or standalone deployment on a separate server, read on.

## What You Need

- A VPS or server (1 CPU, 512 MB RAM minimum – this is a lightweight service)
- A domain (e.g., `id.yourdomain.com`)
- MongoDB (can be shared with an instance or dedicated)
- SSL certificate (Let's Encrypt recommended)
- (Optional) SMTP service for email verification (e.g., Resend, SendGrid)

## Quick Start with Docker

```bash
# 1. Clone the repo
git clone https://github.com/your-org/singravox.git
cd singravox

# 2. Create .env for the identity server
cat > .env.id << 'EOF'
MONGO_URL=mongodb://localhost:27017
DB_NAME=singravox_id
SVID_ISSUER=https://id.yourdomain.com
SVID_JWT_SECRET=your-very-secret-key-change-this
CORS_ORIGINS=https://id.yourdomain.com,https://your-instance.com
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USERNAME=resend
SMTP_PASSWORD=your-resend-api-key
SMTP_FROM_EMAIL=noreply@yourdomain.com
SMTP_FROM_NAME=Singra Vox ID
SMTP_USE_SSL=true
EOF

# 3. Run with Docker
docker build -f deploy/backend.Dockerfile -t singravox-id .
docker run -d \
  --name singravox-id \
  --env-file .env.id \
  -p 8002:8001 \
  singravox-id \
  uvicorn identity_server:app --host 0.0.0.0 --port 8001

# 4. Verify
curl http://localhost:8002/health
# → {"status":"ok","service":"singravox-id"}

curl http://localhost:8002/api/id/.well-known/openid-configuration
# → {"issuer":"https://id.yourdomain.com", ...}
```

## Bare-Metal Setup

```bash
# 1. Install dependencies
cd singravox/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. Create .env (same variables as Docker example above)

# 3. Run
uvicorn identity_server:app --host 0.0.0.0 --port 8002 --workers 2

# 4. Set up a reverse proxy (nginx/Caddy) with SSL
```

### Nginx Configuration

```nginx
server {
    listen 443 ssl;
    server_name id.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/id.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/id.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_for_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Connecting an Instance to Your ID Server

On each Singra Vox instance, add these to the backend `.env`:

```bash
SVID_ISSUER=https://id.yourdomain.com
SVID_JWT_SECRET=same-secret-as-id-server
```

The instance login page will automatically show "Sign in with Singra Vox ID".

## Database

The identity server uses these MongoDB collections (prefixed `svid_`):

| Collection | Size Estimate | Description |
|---|---|---|
| `svid_accounts` | ~1 KB per user | User accounts |
| `svid_sessions` | ~0.5 KB per session | Login sessions |
| `svid_totp` | ~0.5 KB per user | 2FA secrets |
| `svid_email_codes` | Ephemeral | Verification codes (auto-deleted) |
| `svid_oauth_clients` | ~1 KB per instance | Registered instances |
| `svid_oauth_codes` | Ephemeral | Auth codes (5 min TTL) |
| `svid_user_instances` | ~0.5 KB per connection | User↔Instance mapping |
| `svid_invites` | ~1 KB per invite | Cross-instance invites |

For 10,000 users with 2FA: approximately 20 MB total.

## Security Checklist

- [ ] Set a unique, strong `SVID_JWT_SECRET` (min. 32 characters)
- [ ] Enable HTTPS (SSL/TLS) – never run without it in production
- [ ] Set `CORS_ORIGINS` to only allow your known instance URLs
- [ ] Enable MongoDB authentication
- [ ] Set up automated backups for the `svid_*` collections
- [ ] Monitor logs for brute-force attempts
- [ ] Keep the `pyotp` and `bcrypt` packages up to date

## Monitoring

The `/health` endpoint returns `{"status": "ok"}` for load balancer health checks.

For detailed monitoring, check:
- MongoDB connection: `curl /health`
- Account creation rate: `db.svid_accounts.countDocuments()`
- Active sessions: `db.svid_sessions.countDocuments()`
- Failed login attempts: check application logs

## Scaling

For most deployments (up to 50,000 users), a single instance is sufficient. For larger scale:

- **Horizontal**: Run multiple Uvicorn workers (`--workers 4`)
- **MongoDB**: Use a replica set for high availability
- **Cache**: Add Redis for session caching (not implemented yet, future feature)
