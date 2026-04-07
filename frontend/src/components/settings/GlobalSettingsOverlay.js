/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * GlobalSettingsOverlay – Thin orchestrator.
 * Each tab is a self-contained component in ./global/.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DesktopTower,
  Lock,
  ShieldCheck,
  SignOut,
  SlidersHorizontal,
  UserCircle,
} from "@phosphor-icons/react";
import { useAuth } from "@/contexts/AuthContext";
import SettingsOverlayShell from "@/components/settings/SettingsOverlayShell";
import VoiceSettingsTab from "./global/VoiceSettingsTab";
import AccountSettingsTab from "./global/AccountSettingsTab";
import SecuritySettingsTab from "./global/SecuritySettingsTab";
import PrivacySettingsTab from "./global/PrivacySettingsTab";
import InstancesSettingsTab from "./global/InstancesSettingsTab";

const SECTION_ICONS = [
  <SlidersHorizontal key="v" size={16} />,
  <UserCircle key="a" size={16} />,
  <Lock key="s" size={16} />,
  <ShieldCheck key="p" size={16} />,
  <DesktopTower key="i" size={16} />,
];

export default function GlobalSettingsOverlay({
  open,
  onClose,
  user,
  voiceEngineRef,
  onUserUpdated,
  onLogout,
  pttDebug = null,
  // `channels` kept in signature for backward-compat but unused here
}) {
  const { t } = useTranslation();
  const { token } = useAuth();
  const [activeSection, setActiveSection] = useState("voice");

  const sectionConfig = useMemo(
    () => [
      { id: "voice",     icon: SECTION_ICONS[0], label: t("settings.voiceVideo") },
      { id: "account",   icon: SECTION_ICONS[1], label: t("settings.account") },
      { id: "security",  icon: SECTION_ICONS[2], label: t("settings.security") },
      { id: "privacy",   icon: SECTION_ICONS[3], label: t("settings.privacy") },
      { id: "instances", icon: SECTION_ICONS[4], label: t("settings.instances") },
    ],
    [t],
  );

  return (
    <SettingsOverlayShell
      open={open}
      title={t("settings.userSettingsTitle")}
      sections={sectionConfig}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      onClose={onClose}
      footerActions={[
        {
          id: "logout",
          label: t("settings.logoutAction"),
          icon: <SignOut size={16} />,
          tone: "danger",
          onClick: () => {
            onClose?.();
            onLogout?.();
          },
          testId: "settings-logout-button",
        },
      ]}
    >
      {activeSection === "voice" && (
        <VoiceSettingsTab user={user} voiceEngineRef={voiceEngineRef} pttDebug={pttDebug} />
      )}
      {activeSection === "account" && (
        <AccountSettingsTab user={user} onUserUpdated={onUserUpdated} />
      )}
      {activeSection === "security" && <SecuritySettingsTab token={token} />}
      {activeSection === "privacy" && <PrivacySettingsTab />}
      {activeSection === "instances" && <InstancesSettingsTab />}
    </SettingsOverlayShell>
  );
}
