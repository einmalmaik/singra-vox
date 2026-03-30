# SovereignVoice - Product Requirements Document

## Original Problem Statement
Build a production-ready, privacy-first, self-hosted communication platform (Discord/TeamSpeak alternative) called SovereignVoice. GDPR-oriented, E2EE for DMs, voice channels, text messaging, roles/permissions, moderation tools.

## Architecture
- **Current**: React + FastAPI (Python) + MongoDB
- **Target**: Rust (Axum) + PostgreSQL + LiveKit + Tauri 2

## User Personas
1. **Server Admin**: Self-hosts the platform, manages server settings, roles, channels, moderation
2. **Community Member**: Joins servers, chats in text/voice channels, sends DMs
3. **Moderator**: Manages members, applies bans/mutes/kicks

## Core Requirements (Static)
- Self-hosted first, no central platform dependency
- GDPR-compliant by design
- No telemetry, no third-party analytics
- E2EE for DMs (ECDH + AES-GCM)
- Privacy by default
- Granular roles and permissions
- Voice channels (UI status in MVP, real audio in Phase 2)
- Text channels with message history
- Direct messages with encryption
- Moderation tools (ban, kick, mute, timeout)
- Invite system
- Audit logging
- Server bootstrap on first run

## What's Been Implemented (2026-03-30)
### Backend (FastAPI + MongoDB)
- [x] JWT Authentication with bcrypt password hashing
- [x] Admin user seeding on startup
- [x] Brute force login protection
- [x] Server CRUD (create, read, update)
- [x] Channel CRUD (text, voice, private)
- [x] Message CRUD with reactions
- [x] Direct Messages with E2EE field support
- [x] Roles & Permissions system (17 granular permissions)
- [x] Moderation: ban, unban, mute, unmute, kick
- [x] Invite system with expiry and max uses
- [x] Voice state management (join/leave/mute/deafen)
- [x] WebSocket for real-time messaging
- [x] Audit logging
- [x] User profile management
- [x] User search

### Frontend (React + Tailwind + Shadcn)
- [x] Login & Registration pages
- [x] Server bootstrap/setup page
- [x] 4-pane Discord-like layout (server sidebar, channel sidebar, chat area, member sidebar)
- [x] Server creation & switching
- [x] Channel list with text/voice categories
- [x] Real-time messaging with WebSocket
- [x] Message editing & deletion
- [x] Emoji reactions
- [x] Voice channel UI (join/leave/mute/deafen)
- [x] Voice participant display
- [x] Member sidebar with online/offline status
- [x] Member context menu (DM, mute, kick, ban)
- [x] Server settings modal (general, roles, members, audit)
- [x] Role creation with granular permission toggles
- [x] Invite link generation
- [x] Direct Messages view
- [x] E2EE crypto utilities (Web Crypto API)
- [x] Toast notifications
- [x] Typing indicators (via WebSocket)

## Prioritized Backlog
### P0 (Critical - Next Sprint)
- [ ] File/Image upload for messages
- [ ] Message search functionality
- [ ] Unread message indicators
- [ ] @mentions parsing & notification
- [ ] User profile editing UI

### P1 (Important)
- [ ] Thread/reply display in chat
- [ ] Private rooms/channels with access control
- [ ] Channel topic editing in-place
- [ ] Mobile responsive layout
- [ ] Password reset flow

### P2 (Nice to Have)
- [ ] Docker Compose deployment setup
- [ ] Self-hosting documentation
- [ ] Data export functionality
- [ ] Account deletion
- [ ] Emoji picker UI
- [ ] Message pinning
- [ ] User status (away/DND) selector

## Next Tasks
1. File upload support (base64 for MVP, S3 for production)
2. Message search with full-text index
3. Unread indicators per channel
4. Docker Compose configuration
5. Self-hosting README
