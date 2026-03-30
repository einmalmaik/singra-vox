# Singra Vox – PRD

## Implemented (Phases 1-4, 56 API Endpoints, 100% passing)

### Core Communication
- Text Channels: messages, threads, reactions, @mentions, file upload, search, pins
- Voice Channels: WebRTC P2P (2-6 users), mute/deafen/PTT, audio device selection
- DMs: 1:1 with real E2EE (ECDH + AES-GCM), group DMs
- Channel topic inline editing, unread tracking, message edit history

### Server Administration
- Roles (20 permissions incl. pin_messages, manage_emojis, manage_webhooks)
- Channel overrides, private rooms, temp rooms, sub-channels
- Moderation: ban/kick/mute/timeout, audit log
- Invite system with expiry

### Platform Features
- Custom Emoji: upload/manage per server (50 limit, admin-controlled)
- Webhooks: create per channel, external exec endpoint, rate-limited (30/min)
- Bot Tokens: API tokens for integrations with scoped permissions
- In-App Notifications: mentions, DMs, with bell icon + badge
- Message Pinning: pin/unpin per channel with dedicated panel

### Privacy & Security
- E2EE for DMs (ECDH P-256 + AES-256-GCM), key bundle management
- MLS Group E2EE architecture documented (docs/mls-group-e2ee.md)
- GDPR: data export + account deletion
- No telemetry, minimal logging, brute force protection
- User status: online/away/DND/invisible

### Infrastructure
- Docker: backend + frontend Dockerfiles, compose (dev + prod/Caddy)
- nginx reverse proxy with WebSocket support
- Tauri 2 desktop scaffold (Cargo.toml, main.rs with tray/hotkeys/keychain)
- CI/CD: GitHub Actions (lint, build, Docker push)
- Responsive mobile layout

## Backlog
### P0
- [ ] Emoji picker enhancement with custom emoji in reactions
- [ ] Webhook management UI in server settings
### P1
- [ ] Tauri desktop build & test
- [ ] MLS implementation (pending openmls-wasm stability)
- [ ] Push notifications for Tauri desktop
### P2
- [ ] Federation protocol
- [ ] Admin analytics dashboard
- [ ] Message scheduling
