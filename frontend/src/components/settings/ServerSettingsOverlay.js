/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * ServerSettingsOverlay – Thin orchestrator.
 * Each tab is a self-contained component in ./server/.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ClipboardText,
  GearSix,
  Hash,
  Shield,
  UserPlus,
  UsersThree,
} from "@phosphor-icons/react";
import { buildServerCapabilities } from "@/lib/serverPermissions";
import SettingsOverlayShell from "@/components/settings/SettingsOverlayShell";
import ServerGeneralTab from "./server/ServerGeneralTab";
import ServerChannelsTab from "./server/ServerChannelsTab";
import ServerRolesTab from "./server/ServerRolesTab";
import ServerMembersTab from "./server/ServerMembersTab";
import ServerInvitesTab from "./server/ServerInvitesTab";
import ServerAuditTab from "./server/ServerAuditTab";

const SECTION_ICONS = [
  <GearSix key="g" size={16} />,
  <Hash key="c" size={16} />,
  <Shield key="r" size={16} />,
  <UsersThree key="m" size={16} />,
  <UserPlus key="i" size={16} />,
  <ClipboardText key="a" size={16} />,
];

export default function ServerSettingsOverlay({
  open,
  onClose,
  server,
  channels,
  members,
  roles,
  user,
  viewerContext,
  onRefreshServers,
}) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState("general");

  const capabilities = useMemo(
    () => buildServerCapabilities({ user, server, viewerContext }),
    [server, user, viewerContext],
  );

  const sectionConfig = useMemo(
    () => [
      { id: "general",  icon: SECTION_ICONS[0], label: t("server.general") },
      { id: "channels", icon: SECTION_ICONS[1], label: t("server.channels") },
      { id: "roles",    icon: SECTION_ICONS[2], label: t("server.roles") },
      { id: "members",  icon: SECTION_ICONS[3], label: t("server.members") },
      { id: "invites",  icon: SECTION_ICONS[4], label: t("server.invites") },
      { id: "audit",    icon: SECTION_ICONS[5], label: t("server.audit") },
    ],
    [t],
  );

  // Reset ownership target when server changes
  useEffect(() => {
    if (!open) return;
    setActiveSection("general");
  }, [open, server?.id]);

  if (!server) return null;

  return (
    <SettingsOverlayShell
      open={open}
      title={t("server.settingsTitle", { name: server.name })}
      sections={sectionConfig}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      onClose={onClose}
      data-testid="server-settings-overlay"
    >
      {activeSection === "general" && (
        <ServerGeneralTab
          server={server}
          members={members}
          user={user}
          capabilities={capabilities}
          onRefreshServers={onRefreshServers}
          onClose={onClose}
        />
      )}
      {activeSection === "channels" && (
        <ServerChannelsTab server={server} channels={channels} />
      )}
      {activeSection === "roles" && (
        <ServerRolesTab server={server} roles={roles} />
      )}
      {activeSection === "members" && (
        <ServerMembersTab
          server={server}
          members={members}
          roles={roles}
          capabilities={capabilities}
        />
      )}
      {activeSection === "invites" && <ServerInvitesTab server={server} />}
      {activeSection === "audit" && <ServerAuditTab server={server} />}
    </SettingsOverlayShell>
  );
}
