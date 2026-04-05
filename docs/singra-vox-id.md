# Singra Vox ID – Federated Identity System

## Overview

Singra Vox ID is a **central identity provider** that allows users to maintain **one account across all Singra Vox instances**. Instead of creating a separate account on each self-hosted server, users register once on a Singra Vox ID server and can then sign in to any instance with a single click.

**Think of it like "Login with Google" – but fully open source, self-hostable, and under your control.**

## How It Works

```
                ┌─────────────────────────────────┐
                │       Singra Vox ID Server       │
                │       (id.singravox.com)         │
                │                                  │
                │  Stores: Email, Username, Avatar │
                │  Does NOT store: Messages, Files │
                │  Supports: 2FA, Password Policy  │
                └──────┬───────────┬───────────────┘
                       │           │
             OAuth2    │           │   OAuth2
                       ▼           ▼
              ┌──────────┐  ┌──────────┐
              │Instance A │  │Instance B │
              │gaming.xyz │  │work.corp  │
              │           │  │           │
              │ Messages  │  │ Messages  │
              │ Channels  │  │ Channels  │
              │ Voice     │  │ Voice     │
              │ E2EE Keys │  │ E2EE Keys │
              └───────────┘  └───────────┘
```

### User Flow

1. **Register once** at the Singra Vox ID server (email + password)
2. **Verify email** with 6-digit code
3. **(Optional)** Enable 2FA with any TOTP authenticator app
4. **Sign in to any instance** by clicking "Sign in with Singra Vox ID"
5. Instance creates a local profile linked to your Singra Vox ID
6. **Switch between instances** without logging in again

### Data Separation (Privacy by Design)

| Data                    | Stored on ID Server | Stored on Instance |
|-------------------------|:-------------------:|:------------------:|
| Email + Password Hash   | ✓                   |                    |
| Username + Display Name | ✓                   | ✓ (synced)         |
| Avatar URL              | ✓                   | ✓ (synced)         |
| 2FA Secret              | ✓                   |                    |
| Messages                |                     | ✓                  |
| Channels & Servers      |                     | ✓                  |
| Voice State             |                     | ✓                  |
| E2EE Keys               |                     | ✓                  |
| Roles & Permissions     |                     | ✓                  |
| Files & Attachments     |                     | ✓                  |

**The ID server never sees your messages, files, or encryption keys.**

## Architecture

### Module Structure

```
backend/app/identity/
├── __init__.py      # Module documentation
├── config.py        # Environment variables & defaults
├── models.py        # Pydantic request/response models
├── password.py      # Password strength checker & generator
├── totp.py          # TOTP 2FA (Google Authenticator compatible)
├── oauth2.py        # OAuth2/OIDC token generation & validation
└── routes.py        # All REST API endpoints (/api/id/*)
```

### Database Collections (MongoDB, prefixed `svid_`)

| Collection            | Purpose                               |
|-----------------------|---------------------------------------|
| `svid_accounts`       | Central user accounts                 |
| `svid_sessions`       | Login sessions                        |
| `svid_totp`           | 2FA secrets & hashed backup codes     |
| `svid_email_codes`    | Verification & password reset codes   |
| `svid_oauth_clients`  | Registered instances (OAuth2 clients) |
| `svid_oauth_codes`    | Short-lived authorization codes       |
| `svid_user_instances` | Which instances a user has joined     |

### Security Features

- **Argon2id** password hashing (same as instance auth)
- **TOTP 2FA** with 8 single-use backup codes (SHA-256 hashed)
- **Password policy**: min 10 chars, uppercase + lowercase + digit + special char
- **Common password rejection** (top-100 list)
- **Sequential pattern detection** (abc, 1234, qwerty)
- **Rate limiting** on all auth endpoints
- **JWT tokens** with short TTL (30 min access, 30 day refresh)
- **OAuth2 authorization codes** expire after 5 minutes, single-use

## API Reference

### Registration & Email

| Method | Endpoint                    | Auth | Description              |
|--------|-----------------------------|------|--------------------------|
| POST   | `/api/id/register`          | No   | Create account           |
| POST   | `/api/id/verify-email`      | No   | Verify with 6-digit code |
| POST   | `/api/id/resend-verification`| No  | Resend verification code |

### Authentication

| Method | Endpoint              | Auth | Description                        |
|--------|-----------------------|------|------------------------------------|
| POST   | `/api/id/login`       | No   | Login (returns token or 2FA flow)  |
| POST   | `/api/id/login/2fa`   | No   | Complete login with TOTP code      |
| POST   | `/api/id/logout`      | Yes  | End session                        |

### Profile

| Method | Endpoint       | Auth | Description           |
|--------|----------------|------|-----------------------|
| GET    | `/api/id/me`   | Yes  | Get own profile       |
| PUT    | `/api/id/me`   | Yes  | Update profile fields |

### Password Management

| Method | Endpoint                    | Auth | Description              |
|--------|-----------------------------|------|--------------------------|
| POST   | `/api/id/password/check`    | No   | Check password strength  |
| POST   | `/api/id/password/generate` | No   | Generate secure password |
| POST   | `/api/id/password/change`   | Yes  | Change password          |
| POST   | `/api/id/password/forgot`   | No   | Request reset code       |
| POST   | `/api/id/password/reset`    | No   | Reset with emailed code  |

### Two-Factor Authentication

| Method | Endpoint               | Auth | Description                |
|--------|------------------------|------|----------------------------|
| POST   | `/api/id/2fa/setup`    | Yes  | Start 2FA enrollment       |
| POST   | `/api/id/2fa/confirm`  | Yes  | Confirm with first code    |
| POST   | `/api/id/2fa/disable`  | Yes  | Disable (requires pw+code) |

### OAuth2 / OpenID Connect

| Method | Endpoint                                    | Auth    | Description             |
|--------|---------------------------------------------|---------|-------------------------|
| POST   | `/api/id/oauth/clients`                     | Yes     | Register instance       |
| POST   | `/api/id/oauth/authorize`                   | Yes     | Get authorization code  |
| POST   | `/api/id/oauth/token`                       | Client  | Exchange code for token |
| GET    | `/api/id/oauth/userinfo`                    | Yes     | Get user profile        |
| GET    | `/api/id/.well-known/openid-configuration`  | No      | OIDC discovery          |

### Instance Management

| Method | Endpoint             | Auth | Description                    |
|--------|----------------------|------|--------------------------------|
| GET    | `/api/id/instances`  | Yes  | List connected instances       |

## Self-Hosting the ID Server

The Singra Vox ID module lives in the same repository as the instance code. You can:

1. **Run it alongside an instance** (default): Both the ID server and instance share the same backend process. This is the simplest setup.

2. **Run it as a standalone service**: Deploy just the identity module on a separate server (e.g., `id.yourdomain.com`). Set `SVID_ISSUER` to your domain.

### Environment Variables

| Variable                        | Required | Default        | Description                      |
|---------------------------------|----------|----------------|----------------------------------|
| `SVID_ISSUER`                   | Yes*     | (auto-detect)  | Canonical URL of the ID server   |
| `SVID_JWT_SECRET`               | Yes*     | (random)       | JWT signing secret (keep safe!)  |
| `SVID_ACCESS_TOKEN_TTL_MINUTES` | No       | 30             | Access token lifetime            |
| `SVID_REFRESH_TOKEN_TTL_DAYS`   | No       | 30             | Refresh token lifetime           |

*In production, these MUST be set explicitly.

## For Developers

### Extending the Identity Module

The module follows a clean separation:
- **`models.py`** – Add new Pydantic models here for new endpoints
- **`routes.py`** – Add new API routes, following the existing pattern
- **`oauth2.py`** – OAuth2/OIDC logic is isolated here
- **`password.py`** – Password policy can be extended (e.g., breach database)
- **`totp.py`** – 2FA logic, could be extended for WebAuthn/FIDO2

### Key Design Decisions

1. **Same repo, separate module** – The identity code CAN be extracted into its own service without refactoring. Collections are prefixed with `svid_` to avoid conflicts.

2. **OAuth2 Authorization Code flow** – Industry standard. Works across domains. Any instance can trust any ID server by its issuer URL.

3. **Minimal data** – The ID server stores the absolute minimum needed for identity. All content data stays on instances.

4. **Backward compatible** – Instances can still use local accounts. Singra Vox ID is an opt-in, not a replacement.
