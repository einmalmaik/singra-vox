/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

export const ROOT_PARENT_ID = "__root__";

export function resolveParticipantDisplayName(participant, t) {
  return participant?.display_name || participant?.username || t("common.unknown");
}

export function createEmptyScreenShareMeta() {
  return {
    hasAudio: false,
    actualCaptureSettings: null,
    sourceId: null,
    sourceKind: null,
    sourceLabel: null,
    provider: null,
  };
}

export function createEmptyVoiceActivity() {
  return {
    localSpeaking: false,
    activeSpeakerIds: [],
    audioLevel: 0,
  };
}

export function createClosedStageState() {
  return {
    open: false,
    trackRefId: null,
  };
}

export function buildLiveMediaEntries({ videoTrackRefs, user, memberDisplayNames, t }) {
  return (videoTrackRefs || [])
    .filter((trackRef) => trackRef.isAvailable || trackRef.isLocal)
    .map((trackRef) => ({
      trackRefId: trackRef.id,
      userId: trackRef.participantId,
      participantName: trackRef.participantId === user?.id
        ? resolveParticipantDisplayName(user, t)
        : (memberDisplayNames.get(trackRef.participantId) || t("common.unknown")),
      source: trackRef.source,
      badge: trackRef.source === "screen_share"
        ? t("channel.liveStreamBadge")
        : t("channel.liveCameraBadge"),
      hasAudio: Boolean(trackRef.hasAudio),
    }));
}

export function buildChannelParticipantEntries({
  channels,
  user,
  server,
  localVoicePreferences,
  isDeafened,
  voiceActivity,
  mediaByUserId,
  cameraEnabled,
  screenShareEnabled,
  t,
}) {
  return (channels || []).reduce((accumulator, channel) => {
    if (channel.type !== "voice" || !channel.voice_states?.length) {
      return accumulator;
    }

    accumulator[channel.id] = channel.voice_states.map((voiceState) => {
      const participantId = voiceState.user_id;
      const locallyMuted = Boolean(localVoicePreferences.locallyMutedParticipants?.[participantId]);
      const volume = localVoicePreferences.perUserVolumes?.[participantId] ?? 100;
      const remoteSpeakingVisible = !isDeafened && !locallyMuted;
      const speaking = participantId === user?.id
        ? voiceActivity.localSpeaking
        : (remoteSpeakingVisible && voiceActivity.activeSpeakerIds.includes(participantId));
      const participantMedia = participantId === user?.id
        ? {
          hasCamera: cameraEnabled,
          hasScreenShare: screenShareEnabled,
        }
        : mediaByUserId.get(participantId);

      return {
        id: participantId,
        name: voiceState.user?.display_name || t("common.unknown"),
        initial: voiceState.user?.display_name?.[0]?.toUpperCase() || "?",
        locallyMuted,
        volume,
        speaking,
        hasCamera: Boolean(participantMedia?.hasCamera),
        hasScreenShare: Boolean(participantMedia?.hasScreenShare),
        isMuted: Boolean(voiceState.is_muted),
        isDeafened: Boolean(voiceState.is_deafened),
        isServerOwner: server?.owner_id === participantId,
      };
    });

    return accumulator;
  }, {});
}
