import {
  buildServerCapabilities,
  canCreateServer,
  getChannelPermissions,
  getServerPermissions,
} from "../serverPermissions";

describe("serverPermissions", () => {
  it("lets instance owners create servers", () => {
    expect(canCreateServer({ instance_role: "owner" })).toBe(true);
    expect(canCreateServer({ instance_role: "admin" })).toBe(false);
  });

  it("grants all permissions to the server owner", () => {
    const permissions = getServerPermissions({}, { owner_id: "owner-1" }, { id: "owner-1" });
    expect(Object.values(permissions).every(Boolean)).toBe(true);
  });

  it("merges viewer context permissions for a regular member", () => {
    const permissions = getServerPermissions(
      { server_permissions: { send_messages: false, mention_everyone: true, stream: false } },
      { owner_id: "owner-1" },
      { id: "user-1" },
    );

    expect(permissions.send_messages).toBe(false);
    expect(permissions.mention_everyone).toBe(true);
    expect(permissions.stream).toBe(false);
  });

  it("prefers channel permissions over server permissions for channel-scoped UI", () => {
    const permissions = getChannelPermissions(
      {
        server_permissions: { join_voice: true, speak: true, stream: false },
        channel_permissions: {
          "channel-1": { speak: false, stream: true },
        },
      },
      "channel-1",
      { owner_id: "owner-1" },
      { id: "user-1" },
    );

    expect(permissions.join_voice).toBe(true);
    expect(permissions.speak).toBe(false);
    expect(permissions.stream).toBe(true);
  });

  it("builds moderation capabilities from the resolved permission set", () => {
    const capabilities = buildServerCapabilities({
      user: { id: "user-1", instance_role: "user" },
      server: { owner_id: "owner-1" },
      viewerContext: {
        server_permissions: {
          manage_members: true,
          deafen_members: true,
        },
      },
    });

    expect(capabilities.canManageMembers).toBe(true);
    expect(capabilities.canDeafenMembers).toBe(true);
    expect(capabilities.canOpenServerSettings).toBe(true);
  });
});
