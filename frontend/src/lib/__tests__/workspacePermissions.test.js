import {
  buildWorkspaceCapabilities,
  canCreateCommunity,
  getWorkspacePermissions,
} from "../workspacePermissions";

describe("workspacePermissions", () => {
  it("lets instance owners create communities", () => {
    expect(canCreateCommunity({ instance_role: "owner" })).toBe(true);
    expect(canCreateCommunity({ instance_role: "admin" })).toBe(false);
  });

  it("grants all permissions to the server owner", () => {
    const permissions = getWorkspacePermissions({
      user: { id: "owner-1" },
      server: { owner_id: "owner-1" },
      members: [],
      roles: [],
    });

    expect(Object.values(permissions).every(Boolean)).toBe(true);
  });

  it("merges default role permissions and additive role permissions", () => {
    const permissions = getWorkspacePermissions({
      user: { id: "user-1" },
      server: { owner_id: "owner-1" },
      members: [{ user_id: "user-1", roles: ["role-mod"] }],
      roles: [
        { id: "everyone", is_default: true, permissions: { send_messages: false, mention_everyone: true } },
        { id: "role-mod", permissions: { manage_messages: true, mute_members: true } },
      ],
    });

    expect(permissions.send_messages).toBe(false);
    expect(permissions.mention_everyone).toBe(true);
    expect(permissions.manage_messages).toBe(true);
    expect(permissions.mute_members).toBe(true);
  });

  it("builds moderation capabilities from the resolved permission set", () => {
    const capabilities = buildWorkspaceCapabilities({
      user: { id: "user-1", instance_role: "user" },
      server: { owner_id: "owner-1" },
      members: [{ user_id: "user-1", roles: ["role-admin"] }],
      roles: [{ id: "role-admin", permissions: { manage_members: true, deafen_members: true } }],
    });

    expect(capabilities.canManageMembers).toBe(true);
    expect(capabilities.canDeafenMembers).toBe(true);
    expect(capabilities.canOpenServerSettings).toBe(true);
  });
});
