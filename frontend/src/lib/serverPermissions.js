// Sync mit: /app/schema/permissions.json (Single Source of Truth)
// Sync mit: /app/backend/app/permissions.py DEFAULT_PERMISSIONS
const DEFAULT_SERVER_PERMISSIONS = {
  // ── Server-Verwaltung ─────────────────────────────────────────────────────
  manage_server: false,
  manage_channels: false,
  manage_roles: false,
  manage_members: false,
  kick_members: false,
  ban_members: false,
  manage_webhooks: false,
  manage_emojis: false,
  create_invites: true,
  // ── Kanal / Nachrichten ───────────────────────────────────────────────────
  view_channels: true,         // War bisher fehlend – sync mit backend
  read_messages: true,
  read_message_history: true,
  send_messages: true,
  attach_files: true,
  mention_everyone: false,
  manage_messages: false,
  pin_messages: false,
  // ── Voice / Video ─────────────────────────────────────────────────────────
  join_voice: true,
  speak: true,
  stream: true,
  mute_members: false,
  deafen_members: false,
  priority_speaker: false,
};

const ALL_SERVER_PERMISSIONS = Object.fromEntries(
  Object.keys(DEFAULT_SERVER_PERMISSIONS).map((permission) => [permission, true]),
);

export function canCreateServer(user) {
  return user?.instance_role === "owner";
}

export function getServerPermissions(viewerContext, server, user) {
  if (server?.owner_id && user?.id && server.owner_id === user.id) {
    return { ...ALL_SERVER_PERMISSIONS };
  }
  return {
    ...DEFAULT_SERVER_PERMISSIONS,
    ...(viewerContext?.server_permissions || {}),
  };
}

export function getChannelPermissions(viewerContext, channelId, server, user) {
  if (server?.owner_id && user?.id && server.owner_id === user.id) {
    return { ...ALL_SERVER_PERMISSIONS };
  }
  const channelPermissions = viewerContext?.channel_permissions || {};
  return {
    ...getServerPermissions(viewerContext, server, user),
    ...(channelId ? channelPermissions[channelId] || {} : {}),
  };
}

export function buildServerCapabilities({ user, server, viewerContext, channelId = null }) {
  const permissions = channelId
    ? getChannelPermissions(viewerContext, channelId, server, user)
    : getServerPermissions(viewerContext, server, user);

  return {
    permissions,
    canCreateServer: canCreateServer(user),
    canViewChannels: Boolean(permissions.view_channels),
    canManageServer: Boolean(permissions.manage_server),
    canManageChannels: Boolean(permissions.manage_channels),
    canManageRoles: Boolean(permissions.manage_roles),
    canManageMembers: Boolean(permissions.manage_members),
    canMuteMembers: Boolean(permissions.mute_members),
    canDeafenMembers: Boolean(permissions.deafen_members),
    canKickMembers: Boolean(permissions.kick_members),
    canBanMembers: Boolean(permissions.ban_members),
    canCreateInvites: Boolean(permissions.create_invites),
    canOpenServerSettings: [
      permissions.manage_server,
      permissions.manage_channels,
      permissions.manage_roles,
      permissions.manage_members,
      permissions.kick_members,
      permissions.ban_members,
      permissions.mute_members,
      permissions.deafen_members,
    ].some(Boolean),
  };
}

export { DEFAULT_SERVER_PERMISSIONS };
