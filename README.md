# Singra Vox

Privacy-first, self-hosted communication platform with a shared web client and desktop client.

## What Changed in v1

- The instance is bootstrapped through `/setup`, not through `ADMIN_EMAIL` or `ADMIN_PASSWORD`.
- The first account becomes the **instance owner** and can promote additional instance admins later.
- Open signup is controlled by instance settings after bootstrap.
- The web app now uses same-origin runtime configuration instead of a build-time backend URL.
- The desktop shell lives in [`desktop/`](./desktop) and connects to a target instance at runtime.
- Voice transport is prepared for **LiveKit SFU** with backend-issued voice tokens.

## Quickstart

### Linux installer

```bash
git clone <your-repo-url> singra-vox
cd singra-vox
chmod +x install.sh
./install.sh
```

The installer:

1. checks Docker / Docker Compose
2. generates secrets and voice config
3. starts the stack
4. prints the setup URL

After the first start, open `http://your-host:8080/setup` or `https://your-domain/setup` and create the owner account.

### Development

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Shared web client
cd frontend
yarn install
yarn start

# Desktop shell
cd desktop
yarn install
yarn tauri:dev
```

## Project Structure

```text
backend/     FastAPI API, setup bootstrap, auth, communities, voice token endpoint
frontend/    Shared React client for web and desktop
desktop/     Tauri shell that wraps the shared React client
deploy/      Docker Compose, Caddy/nginx templates, LiveKit and turn config
docs/        Deployment and desktop setup guides
```

## Core Flow

1. The Linux server hosts the instance.
2. The web client is served by that instance.
3. The desktop app asks for the instance URL on first launch.
4. `/setup` creates the first owner account exactly once.
5. Normal users register afterwards if open signup is enabled.
6. Only instance admins can create communities.

## Documentation

- [`docs/deployment-linux.md`](./docs/deployment-linux.md)
- [`docs/docker-setup.md`](./docs/docker-setup.md)
- [`docs/tauri-guide.md`](./docs/tauri-guide.md)
- [`docs/architecture.md`](./docs/architecture.md)

