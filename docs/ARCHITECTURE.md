# SovereignVoice - Architecture & Migration Guide

## Current MVP Architecture (React + FastAPI + MongoDB)

```
┌─────────────────────────────────────────────────┐
│                   Client Layer                   │
│  ┌──────────────────┐  ┌─────────────────────┐  │
│  │   React Web App  │  │  (Future: Tauri 2)  │  │
│  │  Tailwind + Shadcn│  │   Desktop Client   │  │
│  └────────┬─────────┘  └─────────────────────┘  │
│           │ REST + WebSocket                     │
├───────────┼─────────────────────────────────────┤
│           ▼        Backend Layer                 │
│  ┌─────────────────────────────────────────┐    │
│  │        FastAPI (Python)                  │    │
│  │  ┌──────┐ ┌────────┐ ┌──────────────┐  │    │
│  │  │ Auth │ │Channels│ │  Moderation  │  │    │
│  │  │ JWT  │ │Messages│ │  Roles/Perms │  │    │
│  │  └──────┘ └────────┘ └──────────────┘  │    │
│  └────────┬────────────────────────────────┘    │
│           │                                      │
├───────────┼─────────────────────────────────────┤
│           ▼        Data Layer                    │
│  ┌─────────────────┐  ┌──────────────────┐      │
│  │    MongoDB       │  │  (Future: S3)    │      │
│  │  Users, Servers  │  │  File Storage    │      │
│  │  Channels, Msgs  │  │                  │      │
│  └─────────────────┘  └──────────────────┘      │
└─────────────────────────────────────────────────┘
```

## Target Architecture (Rust + PostgreSQL + LiveKit + Tauri 2)

```
┌─────────────────────────────────────────────────────────┐
│                      Client Layer                        │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │  React/Vite  │  │   Tauri 2     │  │   Mobile     │ │
│  │  Web Client  │  │ Desktop Client│  │  (Future)    │ │
│  └──────┬───────┘  └──────┬────────┘  └──────────────┘ │
│         │ REST/WS          │ REST/WS + native IPC       │
├─────────┼──────────────────┼────────────────────────────┤
│         ▼                  ▼                             │
│  ┌────────────────────────────────────────────┐         │
│  │   Rust Backend (Axum + Tokio)              │         │
│  │  ┌──────┐ ┌────────┐ ┌────────┐ ┌──────┐ │         │
│  │  │ Auth │ │ Comms  │ │ Admin  │ │ E2EE │ │         │
│  │  │WebAuthn│ │Service│ │Service │ │ MLS  │ │         │
│  │  └──────┘ └────────┘ └────────┘ └──────┘ │         │
│  └─────┬──────────────────┬──────────────────┘         │
│        │                  │                              │
├────────┼──────────────────┼──────────────────────────────┤
│        ▼                  ▼                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │PostgreSQL│  │  Redis   │  │  LiveKit │  │ MinIO  │ │
│  │  + SQLX  │  │  Cache   │  │   SFU    │  │  S3    │ │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘ │
│                               ┌──────────┐             │
│                               │  coturn  │             │
│                               │NAT Trav. │             │
│                               └──────────┘             │
└─────────────────────────────────────────────────────────┘
```

## Migration Path

### Phase 1: Backend Migration (FastAPI → Rust/Axum)
1. **Database**: MongoDB → PostgreSQL with SQLX
   - Create migration scripts for all collections → tables
   - Users, Servers, Channels, Messages, DMs, Roles, Members, Invites, AuditLog
   - Use UUID primary keys (already in place)
2. **Auth**: bcrypt → Argon2id, add WebAuthn/Passkey support
3. **API**: Keep same REST endpoint structure, implement in Axum
4. **WebSocket**: Port to Tokio-based WebSocket with connection pooling
5. **Performance**: Add connection pooling, prepared statements, query optimization

### Phase 2: Voice Integration (LiveKit)
1. Deploy self-hosted LiveKit server
2. Implement SFU token generation in backend
3. Replace voice status UI with real WebRTC audio via LiveKit client SDK
4. Add Push-to-Talk using LiveKit's audio track API
5. Deploy coturn for NAT traversal

### Phase 3: Desktop Client (Tauri 2)
1. Shared React UI layer (already built)
2. Tauri IPC for native features:
   - Global hotkeys (Push-to-Talk)
   - System tray
   - Desktop notifications
   - OS keychain for key storage
   - Auto-reconnect
3. Secure key storage via Tauri's native plugin system

### Phase 4: Enhanced E2EE
1. Upgrade from ECDH+AES-GCM to MLS (Message Layer Security)
2. Group key management for private channels
3. Forward secrecy and post-compromise security
4. Key backup and device synchronization

## Data Model

### Users
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| email | string | Unique, indexed |
| username | string | Unique, lowercase |
| display_name | string | |
| password_hash | string | bcrypt (MVP) / Argon2id (target) |
| avatar_url | string | |
| status | enum | online/offline/away/dnd |
| public_key | string | JWK for E2EE |
| role | enum | admin/user |
| created_at | datetime | |
| last_seen | datetime | |

### Servers
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| name | string | |
| description | string | |
| icon_url | string | |
| owner_id | UUID | FK to Users |
| settings | JSON | retention, invites, etc. |
| created_at | datetime | |

### Channels
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| server_id | UUID | FK to Servers |
| name | string | |
| type | enum | text/voice/private |
| topic | string | |
| parent_id | UUID | For sub-channels |
| position | int | Sort order |
| is_private | bool | |
| slowmode_seconds | int | |
| created_at | datetime | |

### Messages
| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| channel_id | UUID | FK to Channels |
| author_id | UUID | FK to Users |
| content | string | |
| type | enum | text/system |
| attachments | JSON[] | |
| reactions | JSON | emoji → user_ids |
| reply_to_id | UUID | |
| edited_at | datetime | |
| is_deleted | bool | Soft delete |
| created_at | datetime | |

## Security Considerations

- **No telemetry** - zero third-party analytics
- **Minimal logging** - no message content in logs
- **E2EE for DMs** - ECDH key exchange + AES-256-GCM
- **Brute force protection** - 5 attempts / 15 min lockout
- **HTTP-only cookies** - JWT tokens stored securely
- **CORS configured** - specific origins only
- **Data minimization** - no unnecessary data collection
- **Audit logs** - privacy-aware, admin-only access
