/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { MonitorPlay, VideoCamera } from "@phosphor-icons/react";

export default function VoiceDock({
  voiceChannel,
  voiceActivity,
  liveMediaEntries,
  cameraEnabled,
  screenShareEnabled,
  onToggleCamera,
  onToggleScreenShare,
  onLeaveVoice,
  onOpenMediaStage,
  t,
}) {
  if (!voiceChannel) {
    return null;
  }

  return (
    <div className="border-t workspace-divider bg-zinc-950/45 p-3" data-testid="voice-controls">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-2 h-2 rounded-full bg-[#22C55E] ${voiceActivity.localSpeaking ? "voice-active" : ""}`} />
        <span className="text-xs text-[#22C55E] font-medium">
          {voiceActivity.localSpeaking ? t("channel.speaking") : t("channel.voiceConnected")}
        </span>
      </div>
      <p className="text-xs text-[#71717A] mb-2 truncate">{voiceChannel.name}</p>
      {liveMediaEntries.length > 0 && (
        <div className="mb-3 space-y-2">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#71717A]">
            {t("channel.liveMedia")}
          </p>
          <div className="space-y-2">
            {liveMediaEntries.map((entry) => (
              <button
                key={`${entry.userId}:${entry.source}`}
                type="button"
                onClick={() => onOpenMediaStage(entry.userId, entry.source, entry.trackRefId)}
                className="workspace-card w-full px-3 py-2 text-left transition-colors hover:border-cyan-400/30 hover:bg-white/5"
              >
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1F2937] text-[#A5B4FC]">
                    {entry.source === "screen_share" ? <MonitorPlay size={15} weight="fill" /> : <VideoCamera size={15} weight="fill" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{entry.participantName}</p>
                    <p className="truncate text-xs text-[#71717A]">
                      {entry.source === "screen_share"
                        ? (entry.hasAudio ? t("channel.streamWithAudio") : t("channel.streamNoAudio"))
                        : t("channel.liveCameraBadge")}
                    </p>
                  </div>
                  <span className="rounded-full bg-[#22C55E]/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#22C55E]">
                    {entry.badge}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button
          onClick={onToggleCamera}
          data-testid="voice-camera-toggle"
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            cameraEnabled ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-white/5 text-[#A1A1AA] hover:text-white"
          }`}
        >
          <VideoCamera size={14} />
          {cameraEnabled ? t("channel.cameraOn") : t("channel.camera")}
        </button>
        <button
          onClick={onToggleScreenShare}
          data-testid="voice-screen-share-toggle"
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
            screenShareEnabled ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-white/5 text-[#A1A1AA] hover:text-white"
          }`}
        >
          <MonitorPlay size={14} />
          {screenShareEnabled ? t("channel.sharing") : t("channel.share")}
        </button>
        <button
          onClick={onLeaveVoice}
          data-testid="voice-disconnect"
          className="px-3 py-1.5 rounded-md bg-[#EF4444]/20 text-[#EF4444] text-xs font-medium hover:bg-[#EF4444]/30 transition-colors"
        >
          {t("channel.leave")}
        </button>
      </div>
    </div>
  );
}
