# Singra Vox – PRD

## Implemented Features (Phases 1-3.5)

### Backend (39 API Endpoints, 100% passing)
- Auth (JWT + bcrypt), brute force protection, admin seeding
- Server/Channel/Message CRUD, DMs with E2EE, Group DMs
- Threads, Search, Unread Tracking, File Upload
- Roles (17 permissions) + Channel Overrides
- Moderation (ban/kick/mute), Invites, Voice (WebRTC P2P + status), Audit Log
- GDPR: Data Export + Account Deletion
- User status (online/away/DND/invisible)
- WebRTC voice signaling relay via WebSocket
- E2EE key bundle management

### Frontend (React + Tailwind + Shadcn + Phosphor)
- Discord-inspired 4-pane dark theme (responsive)
- Threads, @mentions, file upload, search (Ctrl+K), emoji reactions
- Unread badges, E2EE DMs, group DMs
- Voice channel UI with WebRTC P2P engine
- User status selector (online/away/DND/invisible)
- Push-to-Talk toggle + key binding
- Audio device selection
- Sub-channel hierarchy, temp channel badges
- GDPR: Data export + Account deletion UI
- Mobile responsive (sidebar toggles, hamburger menu)
- Server settings (roles, members, audit log)
- Moderation (ban/kick/mute from member context menu)

### Infrastructure
- Docker: backend.Dockerfile, frontend.Dockerfile
- docker-compose.yml (dev) + docker-compose.prod.yml (Caddy + TLS)
- nginx reverse proxy (API routing + WebSocket upgrade)
- Tauri 2 desktop scaffolding (Cargo.toml, main.rs, tauri.conf.json)
- CI/CD: GitHub Actions (lint, build, Docker push)
- .env.example files for all components
- Comprehensive docs: architecture, deployment-linux, docker-setup, tauri-guide

## Backlog
### P0
- [ ] Message pinning
- [ ] Channel topic inline editing
- [ ] Notification system (in-app)
### P1
- [ ] Tauri 2 desktop build + distribution
- [ ] MLS group E2EE for channels
- [ ] Custom emoji support
### P2
- [ ] Federation protocol
- [ ] Bot/Webhook system
- [ ] Admin dashboard with analytics
