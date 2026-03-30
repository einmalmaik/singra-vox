# Singra Vox – PRD

## Implemented (Phase 1 + 2 + Deployment Prep)

### Backend (36 API Endpoints, 100% passing)
- Auth (JWT + bcrypt), Server/Channel/Message CRUD, DMs
- Threads, Search, Unread Tracking, File Upload
- Roles (17 permissions) + Channel Overrides
- Moderation (ban/kick/mute), Invites, Voice UI, Audit Log
- Group DMs, E2EE Key Management, Edit History
- WebSocket real-time messaging

### Frontend (React + Tailwind)
- Discord-inspired 4-pane dark theme
- Threads, @mentions, file upload, search, reactions
- Unread badges, E2EE DMs, group DMs
- Voice channel UI, moderation tools

### Deployment Infrastructure
- Dockerfiles (backend + frontend)
- docker-compose.yml (dev) + docker-compose.prod.yml (Caddy + TLS)
- nginx reverse proxy config
- .env.example files
- Tauri desktop scaffolding

### Documentation
- README.md, architecture.md, deployment-linux.md
- docker-setup.md, tauri-guide.md

## Backlog
### P0
- [ ] WebRTC P2P voice (2-4 users)
- [ ] Mobile responsive
- [ ] Data export + account deletion
### P1
- [ ] Tauri 2 desktop build
- [ ] MLS group E2EE
- [ ] Push notifications
### P2
- [ ] Federation protocol
- [ ] Bot system
- [ ] Custom emoji
