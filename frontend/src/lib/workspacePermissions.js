const DEFAULT_PERMISSIONS = {
  manage_server: false,
  manage_channels: false,
  manage_roles: false,
  manage_members: false,
  kick_members: false,
  ban_members: false,
  send_messages: true,
  read_messages: true,
  manage_messages: false,
  attach_files: true,
  mention_everyone: false,
  join_voice: true,
  speak: true,
  mute_members: false,
  deafen_members: false,
  priority_speaker: false,
  create_invites: true,
  pin_messages: false,
  manage_emojis: false,
  manage_webhooks: false,
};

const ALL_PERMISSIONS = Object.fromEntries(
  Object.keys(DEFAULT_PERMISSIONS).map((permission) => [permission, true]),
);

export function canCreateCommunity(user) {
  return ["owner", "admin"].includes(user?.instance_role);
}

function mergePermissions(basePermissions, incomingPermissions = {}) {
  const nextPermissions = { ...basePermissions };
  Object.entries(incomingPermissions).forEach(([permission, allowed]) => {
    nextPermissions[permission] = Boolean(nextPermissions[permission] || allowed);
  });
  return nextPermissions;
}

export function getWorkspacePermissions({ user, server, members = [], roles = [] }) {
  if (!user) {
    return { ...DEFAULT_PERMISSIONS };
  }

  if (server?.owner_id === user.id) {
    return { ...ALL_PERMISSIONS };
  }

  const currentMember = members.find((member) => member.user_id === user.id);
  if (!currentMember) {
    return { ...DEFAULT_PERMISSIONS };
  }

  let permissions = { ...DEFAULT_PERMISSIONS };
  const defaultRole = roles.find((role) => role.is_default);
  if (defaultRole?.permissions) {
    permissions = mergePermissions(permissions, defaultRole.permissions);
  }

  currentMember.roles?.forEach((roleId) => {
    const role = roles.find((entry) => entry.id === roleId);
    if (role?.permissions) {
      permissions = mergePermissions(permissions, role.permissions);
    }
  });

  return permissions;
}

export function buildWorkspaceCapabilities({ user, server, members = [], roles = [] }) {
  const permissions = getWorkspacePermissions({ user, server, members, roles });

  return {
    permissions,
    canCreateServer: canCreateCommunity(user),
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
