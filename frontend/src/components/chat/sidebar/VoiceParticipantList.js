/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import {
  MicrophoneSlash,
  MonitorPlay,
  Prohibit,
  SpeakerSlash,
  VideoCamera,
} from "@phosphor-icons/react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import VoiceParticipantMenu from "./VoiceParticipantMenu";

export default function VoiceParticipantList({
  participants,
  capabilities,
  currentUserId,
  onUpdateLocalPreferences,
  onOpenMediaStage,
  onHandleModerationAction,
  t,
}) {
  if (!participants?.length) {
    return null;
  }

  return (
    <div className="pl-8 space-y-1">
      {participants.map((participant) => (
        <DropdownMenu key={participant.id}>
          <DropdownMenuTrigger asChild>
            <button className="w-full flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs text-[#A1A1AA] hover:bg-white/5 hover:text-white text-left transition-colors">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold ${
                participant.speaking ? "bg-[#6366F1] voice-active" : "bg-[#27272A]"
              }`}>
                {participant.initial}
              </div>
              <span className="truncate flex-1">{participant.name}</span>
              {participant.hasCamera && (
                <span
                  role="button"
                  tabIndex={0}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenMediaStage(participant.id, "camera");
                  }}
                  className="rounded p-0.5 text-[#22C55E] transition-colors hover:bg-[#27272A] hover:text-white"
                  title={t("channel.viewCamera")}
                >
                  <VideoCamera size={12} weight="fill" />
                </span>
              )}
              {participant.hasScreenShare && (
                <span
                  role="button"
                  tabIndex={0}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onOpenMediaStage(participant.id, "screen_share");
                  }}
                  className="rounded p-0.5 text-[#22C55E] transition-colors hover:bg-[#27272A] hover:text-white"
                  title={t("channel.watchStream")}
                >
                  <MonitorPlay size={12} weight="fill" />
                </span>
              )}
              {participant.isMuted && <MicrophoneSlash size={12} className="text-[#EF4444]" />}
              {participant.isDeafened && <SpeakerSlash size={12} className="text-[#EF4444]" />}
              {participant.locallyMuted && <Prohibit size={12} className="text-[#F59E0B]" />}
            </button>
          </DropdownMenuTrigger>
          <VoiceParticipantMenu
            participant={participant}
            capabilities={capabilities}
            currentUserId={currentUserId}
            onUpdateLocalPreferences={onUpdateLocalPreferences}
            onOpenMediaStage={onOpenMediaStage}
            onHandleModerationAction={onHandleModerationAction}
            t={t}
          />
        </DropdownMenu>
      ))}
    </div>
  );
}
