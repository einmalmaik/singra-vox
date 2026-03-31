# Desktop Client Guide

The shared React client lives in `frontend/`. The native Tauri shell lives in `desktop/`.

## What the Desktop Client Does

- asks for the target instance URL on first launch
- stores auth tokens in the OS keychain
- runs the same setup, login, onboarding, chat and voice UI as the web app

## Development

```bash
cd frontend
yarn install

cd ../desktop
yarn install
yarn tauri:dev
```

The desktop shell starts the shared React dev server automatically through `beforeDevCommand`.

## Build

```bash
cd desktop
yarn install
yarn tauri:build
```

## Runtime Connection Flow

1. Launch desktop app
2. Enter `https://domain` or `http://ip:port`
3. If the instance is new, the app shows `/setup`
4. Otherwise it shows login or onboarding

## Secret Storage

Desktop auth tokens are stored through Tauri IPC commands backed by the OS keyring. The instance URL itself is stored locally because it is not sensitive.

