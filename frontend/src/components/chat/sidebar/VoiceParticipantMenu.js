/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { Prohibit, UserMinus } from "@phosphor-icons/react";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";

export default function VoiceParticipantMenu({
  participant,
  capabilities,
  currentUserId,
  onUpdateLocalPreferences,
  onOpenMediaStage,
  onHandleModerationAction,
  t,
}) {
  const isSelf = participant.id === currentUserId;

  return (
    <DropdownMenuContent className="w-64 border-[#27272A] bg-[#18181B] text-white">
      <DropdownMenuLabel>{participant.name}</DropdownMenuLabel>
      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center justify-between text-xs text-[#71717A]">
          <span>{t("channel.userVolume")}</span>
          <span>{participant.volume}%</span>
        </div>
        <Slider
          value={[participant.volume]}
          min={0}
          max={200}
          step={5}
          onValueChange={([value]) => {
            void onUpdateLocalPreferences({ perUserVolumes: { [participant.id]: value } });
          }}
        />
      </div>
      <DropdownMenuCheckboxItem
        checked={participant.locallyMuted}
        onCheckedChange={(checked) => {
          void onUpdateLocalPreferences({ locallyMutedParticipants: { [participant.id]: checked } });
        }}
      >
        {t("channel.muteForMe")}
      </DropdownMenuCheckboxItem>
      <DropdownMenuItem
        onClick={() => {
          void onUpdateLocalPreferences({
            perUserVolumes: { [participant.id]: 100 },
            locallyMutedParticipants: { [participant.id]: false },
          });
        }}
      >
        {t("channel.resetLocalAudio")}
      </DropdownMenuItem>
      {(participant.hasCamera || participant.hasScreenShare) && (
        <>
          <DropdownMenuSeparator className="bg-[#27272A]" />
          {participant.hasScreenShare && (
            <DropdownMenuItem onClick={() => onOpenMediaStage(participant.id, "screen_share")}>
              {t("channel.watchStream")}
            </DropdownMenuItem>
          )}
          {participant.hasCamera && (
            <DropdownMenuItem onClick={() => onOpenMediaStage(participant.id, "camera")}>
              {t("channel.viewCamera")}
            </DropdownMenuItem>
          )}
        </>
      )}
      {!isSelf && (
        <>
          {(capabilities.canMuteMembers || capabilities.canDeafenMembers || capabilities.canKickMembers || capabilities.canBanMembers) && (
            <DropdownMenuSeparator className="bg-[#27272A]" />
          )}
          {capabilities.canMuteMembers && (
            <DropdownMenuItem onClick={() => onHandleModerationAction(participant.id, "mute")}>
              {t("channel.serverMute")}
            </DropdownMenuItem>
          )}
          {capabilities.canDeafenMembers && (
            <DropdownMenuItem onClick={() => onHandleModerationAction(participant.id, participant.isDeafened ? "server-undeafen" : "server-deafen")}>
              {participant.isDeafened ? t("channel.serverUndeafen") : t("channel.serverDeafen")}
            </DropdownMenuItem>
          )}
          {capabilities.canKickMembers && !participant.isServerOwner && (
            <DropdownMenuItem className="text-[#EF4444]" onClick={() => onHandleModerationAction(participant.id, "kick")}>
              <UserMinus size={14} className="mr-2" /> {t("memberList.kick")}
            </DropdownMenuItem>
          )}
          {capabilities.canBanMembers && !participant.isServerOwner && (
            <DropdownMenuItem className="text-[#EF4444]" onClick={() => onHandleModerationAction(participant.id, "ban")}>
              <Prohibit size={14} className="mr-2" /> {t("memberList.ban")}
            </DropdownMenuItem>
          )}
        </>
      )}
    </DropdownMenuContent>
  );
}
