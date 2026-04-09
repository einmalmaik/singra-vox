/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { GearSix, Microphone, MicrophoneSlash, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import UserStatusPanel from "@/components/chat/UserStatusPanel";

export default function UserBar({
  user,
  onUserUpdated,
  isMuted,
  isDeafened,
  onToggleMute,
  onToggleDeafen,
  onOpenSettings,
  t,
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-3 border-t workspace-divider bg-zinc-950/55 shrink-0" data-testid="user-bar">
      <UserStatusPanel user={user} onUserUpdated={onUserUpdated} />
      <button
        className={`workspace-icon-button ${isMuted ? "border-red-500/30 bg-red-500/15 text-red-400" : ""}`}
        onClick={onToggleMute}
        data-testid="user-bar-mute-toggle"
        title={isMuted ? t("channel.muted") : t("channel.mute")}
      >
        {isMuted ? <MicrophoneSlash size={16} weight="bold" /> : <Microphone size={16} weight="bold" />}
      </button>
      <button
        className={`workspace-icon-button ${isDeafened ? "border-red-500/30 bg-red-500/15 text-red-400" : ""}`}
        onClick={onToggleDeafen}
        data-testid="user-bar-deafen-toggle"
        title={isDeafened ? t("channel.deafened") : t("channel.deafen")}
      >
        {isDeafened ? <SpeakerSlash size={16} weight="bold" /> : <SpeakerHigh size={16} weight="bold" />}
      </button>
      <button
        className="workspace-icon-button"
        onClick={onOpenSettings}
        data-testid="user-settings-button"
      >
        <GearSix size={16} weight="bold" />
      </button>
    </div>
  );
}
