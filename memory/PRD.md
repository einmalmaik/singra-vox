# Singra Vox - Product Requirements Document

## Original Problem Statement
Build a production-ready, privacy-first, self-hosted communication platform (Discord/TeamSpeak alternative) called Singra Vox. GDPR-oriented, E2EE for DMs, voice channels, text messaging, roles/permissions, moderation tools.

## Architecture
- **Current**: React + FastAPI (Python) + MongoDB
- **Target**: Rust (Axum) + PostgreSQL + LiveKit + Tauri 2

## What's Been Implemented

### Phase 1 (2026-03-30) - Core MVP
- JWT Auth with bcrypt, brute force protection
- Server CRUD, Channel CRUD (text/voice/private)
- Real-time messaging via WebSocket
- DMs, Member management, Roles (17 permissions)
- Moderation (ban/kick/mute), Invites, Voice UI, Audit Log
- Discord-inspired 4-pane dark theme layout

### Phase 2 (2026-03-30) - Enhanced Features
- **Threads/Replies**: Reply to messages, thread panel, reply count
- **Message Search**: Full-text search across channels
- **Unread Tracking**: Per-channel unread counts + mention tracking
- **File Uploads**: Base64 upload/download with file attachments
- **@Mentions**: Parse @username, highlight in indigo, track mention_ids
- **Edit History**: Message revisions stored, admin can view history
- **Channel Overrides**: Per-channel permission overrides for roles/users
- **Private Room Access**: Access control lists for private channels
- **Temporary Rooms**: Auto-created temp channels
- **Group DMs**: Create groups, send messages, manage members
- **E2EE Key Management**: Key bundle upload/fetch, ECDH key exchange
- **Real E2EE for DMs**: Client-side encryption (ECDH P-256 + AES-256-GCM)
- **Emoji Reactions**: Full emoji picker with toggle reactions
- **Rename**: SovereignVoice → Singra Vox

## API Endpoints (36 total, 100% passing)
### Auth: register, login, logout, me, refresh
### Setup: status, bootstrap
### Servers: list, create, get, update
### Channels: list, create, update, delete, messages (GET/POST)
### Messages: edit, delete, reactions, thread, revisions
### DMs: conversations, get/send messages
### Members: list, update, kick
### Roles: list, create, update, delete
### Moderation: ban, unban, mute, unmute, audit-log
### Invites: create, get, accept
### Voice: join, leave, state update
### Users: search, profile, public-key
### Phase 2: search, unread, read, upload, files, overrides, access, temp, groups, keys

## Prioritized Backlog
### P0
- [ ] Docker Compose deployment
- [ ] Self-hosting documentation
- [ ] Mobile responsive layout

### P1
- [ ] WebRTC P2P voice for 2-4 users
- [ ] Data export functionality
- [ ] Account deletion
- [ ] Emoji picker UI improvements
- [ ] Message pinning

### P2
- [ ] Tauri 2 desktop client scaffold
- [ ] MLS group E2EE for channels
- [ ] Push notifications
- [ ] User status selector (away/DND)
