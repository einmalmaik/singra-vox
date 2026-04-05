"""
Singra Vox ID – Pydantic Models
================================

Request/response models for all identity endpoints.
Kept separate from route handlers for reusability and documentation.
"""
from pydantic import BaseModel, Field
from typing import List, Optional


# ── Registration ─────────────────────────────────────────────────────────────

class SvidRegisterInput(BaseModel):
    """Create a new Singra Vox ID account."""
    email: str
    username: str
    password: str = Field(min_length=10, max_length=256)
    display_name: str = Field(min_length=1, max_length=80)


class SvidVerifyEmailInput(BaseModel):
    """Verify email with a 6-digit code."""
    email: str
    code: str = Field(min_length=4, max_length=8)


class SvidResendVerificationInput(BaseModel):
    email: str


# ── Login ────────────────────────────────────────────────────────────────────

class SvidLoginInput(BaseModel):
    """Login to Singra Vox ID."""
    email: str
    password: str


class SvidLogin2FAInput(BaseModel):
    """Complete login with 2FA code."""
    pending_token: str
    code: str = Field(min_length=6, max_length=6)


# ── Profile ──────────────────────────────────────────────────────────────────

class SvidProfileUpdateInput(BaseModel):
    """Update profile fields.  Only non-None fields are applied."""
    display_name: Optional[str] = Field(None, min_length=1, max_length=80)
    avatar_url: Optional[str] = None


# ── 2FA ──────────────────────────────────────────────────────────────────────

class SvidEnable2FAInput(BaseModel):
    """Confirm 2FA setup with first TOTP code."""
    code: str = Field(min_length=6, max_length=6)


class SvidDisable2FAInput(BaseModel):
    """Disable 2FA – requires current password for security."""
    password: str
    code: str = Field(min_length=6, max_length=8)


# ── OAuth2 ───────────────────────────────────────────────────────────────────

class SvidOAuthAuthorizeInput(BaseModel):
    """OAuth2 authorization request from an instance."""
    client_id: str
    redirect_uri: str
    scope: str = "openid profile"
    state: str = ""


class SvidOAuthTokenInput(BaseModel):
    """Exchange authorization code for tokens."""
    grant_type: str = "authorization_code"
    code: str
    client_id: str
    client_secret: str
    redirect_uri: str


class SvidOAuthClientRegisterInput(BaseModel):
    """Register a new OAuth2 client (instance)."""
    instance_name: str = Field(min_length=2, max_length=80)
    instance_url: str
    redirect_uris: List[str]


# ── Password ─────────────────────────────────────────────────────────────────

class SvidPasswordCheckInput(BaseModel):
    password: str


class SvidPasswordChangeInput(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=256)


class SvidForgotPasswordInput(BaseModel):
    email: str


class SvidResetPasswordInput(BaseModel):
    email: str
    code: str = Field(min_length=4, max_length=8)
    new_password: str = Field(min_length=10, max_length=256)
