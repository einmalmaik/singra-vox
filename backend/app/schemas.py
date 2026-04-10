from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from app.core.constants import E2EE_PROTOCOL_VERSION, MAX_E2EE_BLOB_BYTES


class RegisterInput(BaseModel):
    email: str
    username: str
    password: str = Field(min_length=8, max_length=256)
    display_name: str = ""


class LoginInput(BaseModel):
    email: str
    password: str


class RefreshInput(BaseModel):
    refresh_token: Optional[str] = None


class VerifyEmailInput(BaseModel):
    email: str
    code: str = Field(min_length=4, max_length=8)


class ResendVerificationInput(BaseModel):
    email: str


class ForgotPasswordInput(BaseModel):
    email: str


class ResetPasswordInput(BaseModel):
    email: str
    code: str = Field(min_length=4, max_length=8)
    new_password: str = Field(min_length=8, max_length=256)


class PasswordChangeInput(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=256)


class PasswordResetLookupInput(BaseModel):
    email: str


class SvidLoginToInstanceInput(BaseModel):
    svid_access_token: str


class SvidLinkInput(BaseModel):
    svid_access_token: str
    disable_local_password_login: bool = True


class BootstrapInput(BaseModel):
    instance_name: str = Field(min_length=2, max_length=80)
    owner_email: str
    owner_username: str
    owner_password: str = Field(min_length=8, max_length=256)
    owner_display_name: str = Field(min_length=1, max_length=80)
    allow_open_signup: bool = True


class InstanceAdminUpdateInput(BaseModel):
    user_id: str


class ServerCreateInput(BaseModel):
    name: str
    description: str = ""


class ChannelCreateInput(BaseModel):
    name: str
    type: str = "text"
    topic: str = ""
    parent_id: Optional[str] = None
    is_private: bool = False


class ChannelReorderItem(BaseModel):
    id: str
    parent_id: Optional[str] = None
    position: int


class ChannelReorderInput(BaseModel):
    items: list[ChannelReorderItem] = Field(default_factory=list)


class MessageCreateInput(BaseModel):
    content: str = ""
    reply_to_id: Optional[str] = None
    attachments: list[dict] = Field(default_factory=list)
    mentioned_user_ids: list[str] = Field(default_factory=list)
    mentioned_role_ids: list[str] = Field(default_factory=list)
    mentions_everyone: bool = False
    is_e2ee: bool = False
    ciphertext: Optional[str] = None
    nonce: Optional[str] = None
    sender_device_id: Optional[str] = None
    protocol_version: str = E2EE_PROTOCOL_VERSION
    message_type: str = "text"
    key_envelopes: list[dict] = Field(default_factory=list)


class DMCreateInput(BaseModel):
    content: str = ""
    encrypted_content: Optional[str] = None
    is_encrypted: bool = False
    nonce: Optional[str] = None
    attachments: list[dict] = Field(default_factory=list)
    is_e2ee: bool = False
    ciphertext: Optional[str] = None
    sender_device_id: Optional[str] = None
    protocol_version: str = E2EE_PROTOCOL_VERSION
    message_type: str = "text"
    key_envelopes: list[dict] = Field(default_factory=list)


class E2EEBootstrapInput(BaseModel):
    device_id: str
    device_name: str = Field(min_length=2, max_length=80)
    device_public_key: str
    recovery_public_key: str
    encrypted_recovery_private_key: str
    recovery_salt: str
    recovery_nonce: str


class E2EEDeviceInput(BaseModel):
    device_id: str
    device_name: str = Field(min_length=2, max_length=80)
    device_public_key: str


class EncryptedBlobInitInput(BaseModel):
    scope_kind: str
    scope_id: str
    participant_user_ids: list[str] = Field(default_factory=list)


class EncryptedBlobContentInput(BaseModel):
    ciphertext_b64: str
    sha256: str
    size_bytes: int = Field(gt=0, le=MAX_E2EE_BLOB_BYTES)
    content_type: str = "application/octet-stream"


class EncryptedMediaKeyInput(BaseModel):
    sender_device_id: str
    key_version: str
    participant_user_ids: list[str] = Field(default_factory=list)
    key_envelopes: list[dict] = Field(default_factory=list)


class RoleCreateInput(BaseModel):
    name: str
    color: str = "#99AAB5"
    permissions: dict = Field(default_factory=dict)
    mentionable: bool = False
    hoist: bool = False


class InviteCreateInput(BaseModel):
    max_uses: int = Field(default=0, ge=0)
    expires_hours: int = Field(default=24, ge=0)


class ModerationInput(BaseModel):
    user_id: str
    reason: str = ""
    duration_minutes: int = 0


class OwnershipTransferInput(BaseModel):
    user_id: str


class ProfileUpdateInput(BaseModel):
    username: Optional[str] = None
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    status: Optional[str] = None


class VoiceTokenInput(BaseModel):
    server_id: str
    channel_id: str


class NativeScreenShareTokenInput(BaseModel):
    server_id: str
    channel_id: str
