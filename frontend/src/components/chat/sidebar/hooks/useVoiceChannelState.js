/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { useDesktopPtt } from "@/hooks/useDesktopPtt";
import { useVoiceCleanup } from "@/hooks/useVoiceCleanup";
import {
  loadVoicePreferences,
  saveVoicePreferences,
  subscribeVoicePreferences,
} from "@/lib/voicePreferences";
import { attachVoiceDebugEngine } from "../../../../lib/voice/voiceDebug";
import { EMPTY_LOCAL_MEDIA_STATE } from "@/lib/videoTrackRefs";
import {
  createEmptyScreenShareMeta,
  createEmptyVoiceActivity,
} from "../channelSidebarUtils";

const VOICE_SESSION_IDLE = "idle";
const VOICE_SESSION_JOINING = "joining";
const VOICE_SESSION_CONNECTED = "connected";
const VOICE_SESSION_LEAVING = "leaving";

function createIdleVoiceSession() {
  return {
    status: VOICE_SESSION_IDLE,
    joinedChannelId: null,
    snapshotConfirmed: false,
  };
}

export function useVoiceChannelState({
  serverId,
  channels,
  user,
  config,
  isDesktop,
  e2eeReady,
  voiceEngineRef,
  onRefreshChannels,
  t,
}) {
  const [voiceChannel, setVoiceChannel] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [screenShareMeta, setScreenShareMeta] = useState(createEmptyScreenShareMeta);
  const [voiceActivity, setVoiceActivity] = useState(createEmptyVoiceActivity);
  const [mediaParticipants, setMediaParticipants] = useState([]);
  const [videoTrackRefs, setVideoTrackRefs] = useState([]);
  const [localMediaState, setLocalMediaState] = useState(EMPTY_LOCAL_MEDIA_STATE);
  const [voiceSession, setVoiceSession] = useState(createIdleVoiceSession);
  const [localVoicePreferences, setLocalVoicePreferences] = useState(
    loadVoicePreferences(user?.id, { isDesktop }),
  );

  const preferredMuted = Boolean(localVoicePreferences.selfMuteEnabled);
  const preferredDeafened = Boolean(localVoicePreferences.selfDeafenEnabled);
  const currentVoiceParticipantIds = useMemo(() => (
    channels.find((channel) => channel.id === voiceChannel?.id)?.voice_states
      ?.map((state) => state.user_id)
      .filter(Boolean)
      .filter((participantId, index, values) => values.indexOf(participantId) === index)
      .sort() || []
  ), [channels, voiceChannel?.id]);

  useVoiceCleanup({ serverId, voiceChannelId: voiceChannel?.id, voiceEngineRef });

  const pttDebug = useDesktopPtt({
    enabled: Boolean(isDesktop && localVoicePreferences.pttEnabled),
    shortcut: localVoicePreferences.pttKey,
    voiceEngineRef,
    active: Boolean(isDesktop),
  });

  useEffect(() => {
    setLocalVoicePreferences(loadVoicePreferences(user?.id, { isDesktop }));
  }, [isDesktop, user?.id]);

  useEffect(() => subscribeVoicePreferences(user?.id, (nextPreferences) => {
    setLocalVoicePreferences(nextPreferences);
  }), [user?.id]);

  useEffect(() => {
    if (voiceChannel) {
      return;
    }
    setIsMuted(preferredMuted);
    setIsDeafened(preferredDeafened);
  }, [preferredDeafened, preferredMuted, voiceChannel]);

  const bindVoiceEngine = useCallback((engine) => {
    const detachVoiceDebug = attachVoiceDebugEngine(engine);
    const handleEvent = (event) => {
      if (event.type === "mute_change") setIsMuted(Boolean(event.isMuted));
      if (event.type === "deafen_change") setIsDeafened(Boolean(event.isDeafened));
      if (event.type === "camera_change") setCameraEnabled(Boolean(event.enabled));
      if (event.type === "screen_share_change") {
        setScreenShareEnabled(Boolean(event.enabled));
        setScreenShareMeta({
          hasAudio: Boolean(event.hasAudio),
          actualCaptureSettings: event.actualCaptureSettings || null,
          sourceId: event.sourceId || null,
          sourceKind: event.sourceKind || null,
          sourceLabel: event.sourceLabel || null,
          provider: event.provider || null,
        });
      }
      if (event.type === "media_tracks_update") {
        setVideoTrackRefs(event.trackRefs || []);
        setMediaParticipants(event.participants || []);
        setLocalMediaState({
          ...EMPTY_LOCAL_MEDIA_STATE,
          ...(event.local || {}),
        });
      }
      if (event.type === "speaking_update") {
        setVoiceActivity({
          localSpeaking: Boolean(event.localSpeaking),
          activeSpeakerIds: event.activeSpeakerIds || [],
          audioLevel: event.audioLevel || 0,
        });
      }
      if (event.type === "disconnected") {
        setVoiceActivity(createEmptyVoiceActivity());
        setCameraEnabled(false);
        setScreenShareEnabled(false);
        setScreenShareMeta(createEmptyScreenShareMeta());
        setVideoTrackRefs([]);
        setMediaParticipants([]);
        setLocalMediaState(EMPTY_LOCAL_MEDIA_STATE);
        setVoiceSession(createIdleVoiceSession());
        if (!event.wasClientInitiated) {
          if (voiceEngineRef?.current === engine) {
            voiceEngineRef.current = null;
          }
          setVoiceChannel(null);
        }
      }
    };

    engine.onStateChange = handleEvent;
    const detachStateListener = engine.addStateListener(handleEvent);
    return () => {
      detachVoiceDebug?.();
      detachStateListener?.();
    };
  }, [voiceEngineRef]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const joinedVoiceChannel = channels.find((channel) => (
      channel.type === "voice"
      && channel.voice_states?.some((state) => state.user_id === user.id)
    )) || null;
    const joinedVoiceChannelId = joinedVoiceChannel?.id || null;
    const hasLocalEngine = Boolean(voiceEngineRef?.current?.room);
    const localJoinedChannelId = voiceSession.joinedChannelId;
    const hasLocallyJoinedSession = (
      (voiceSession.status === VOICE_SESSION_JOINING || voiceSession.status === VOICE_SESSION_CONNECTED)
      && Boolean(localJoinedChannelId)
    );

    if (joinedVoiceChannelId && joinedVoiceChannelId === localJoinedChannelId) {
      if (voiceChannel?.id !== joinedVoiceChannelId) {
        setVoiceChannel(joinedVoiceChannel);
      }
      setVoiceSession((previous) => (
        previous.snapshotConfirmed
          ? previous
          : {
            status: VOICE_SESSION_CONNECTED,
            joinedChannelId: joinedVoiceChannelId,
            snapshotConfirmed: true,
          }
      ));
      return;
    }

    if (joinedVoiceChannel && (!hasLocallyJoinedSession || joinedVoiceChannelId !== localJoinedChannelId)) {
      setVoiceChannel(joinedVoiceChannel);
      setVoiceSession({
        status: VOICE_SESSION_CONNECTED,
        joinedChannelId: joinedVoiceChannel.id,
        snapshotConfirmed: true,
      });
      return;
    }

    // The channel snapshot can lag behind the successful join response by one
    // render. Keep the local session hydrated until the server confirms it.
    if (hasLocallyJoinedSession && hasLocalEngine && localJoinedChannelId) {
      if (voiceChannel?.id !== localJoinedChannelId) {
        const hydratedChannel = channels.find((channel) => channel.id === localJoinedChannelId) || voiceChannel;
        if (hydratedChannel) {
          setVoiceChannel(hydratedChannel);
        }
      }
      return;
    }

    if (!joinedVoiceChannel && voiceSession.status === VOICE_SESSION_LEAVING) {
      setVoiceSession(createIdleVoiceSession());
      if (voiceChannel) {
        setVoiceChannel(null);
      }
      return;
    }

    if (!joinedVoiceChannel && voiceChannel) {
      setVoiceChannel(null);
      setVoiceSession(createIdleVoiceSession());
    }
  }, [channels, user?.id, voiceChannel, voiceEngineRef, voiceSession]);

  useEffect(() => {
    if (!voiceChannel || !user?.id) {
      return;
    }
    const nextChannel = channels.find((channel) => channel.id === voiceChannel.id);
    const selfState = nextChannel?.voice_states?.find((state) => state.user_id === user.id);
    const hasLocalVoiceHydration = (
      (voiceSession.status === VOICE_SESSION_JOINING || voiceSession.status === VOICE_SESSION_CONNECTED)
      && voiceSession.joinedChannelId === voiceChannel.id
      && Boolean(voiceEngineRef?.current?.room)
    );
    if (!nextChannel || !selfState) {
      if (hasLocalVoiceHydration) {
        return;
      }
      setVoiceChannel(null);
      setVoiceSession(createIdleVoiceSession());
      setIsMuted(preferredMuted);
      setIsDeafened(preferredDeafened);
      setCameraEnabled(false);
      setScreenShareEnabled(false);
      setScreenShareMeta(createEmptyScreenShareMeta());
      setVoiceActivity(createEmptyVoiceActivity());
      return;
    }

    const engine = voiceEngineRef?.current;
    if (engine && engine.isMuted !== Boolean(selfState.is_muted)) {
      engine.setMuted(Boolean(selfState.is_muted));
    }
    if (engine && engine.isDeafened !== Boolean(selfState.is_deafened)) {
      engine.setDeafened(Boolean(selfState.is_deafened));
    }
    setIsMuted(Boolean(selfState.is_muted));
    setIsDeafened(Boolean(selfState.is_deafened));
  }, [channels, preferredDeafened, preferredMuted, user?.id, voiceChannel, voiceEngineRef, voiceSession]);

  useEffect(() => {
    if (
      !voiceChannel?.is_private
      || !voiceEngineRef?.current
      || currentVoiceParticipantIds.length === 0
      || !currentVoiceParticipantIds.includes(user?.id)
    ) {
      return undefined;
    }

    let cancelled = false;
    const participantSignature = currentVoiceParticipantIds.join(":");
    const syncParticipants = async (reason) => {
      try {
        if (!cancelled) {
          await voiceEngineRef.current.syncEncryptedMediaParticipants(currentVoiceParticipantIds, reason);
        }
      } catch (error) {
        console.error("Encrypted media rotation failed", error);
        if (!cancelled) {
          toast.error(formatAppError(t, error, { fallbackKey: "errors.encryptedMediaKeysRotateFailed" }));
        }
      }
    };

    void syncParticipants("membership");
    const intervalId = window.setInterval(() => {
      void syncParticipants(`periodic-${participantSignature}`);
    }, 10 * 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentVoiceParticipantIds, t, user?.id, voiceChannel?.id, voiceChannel?.is_private, voiceEngineRef]);

  const updateLocalPreferences = useCallback(async (partialUpdate) => {
    const nextPreferences = saveVoicePreferences(user?.id, partialUpdate, { isDesktop });
    setLocalVoicePreferences(nextPreferences);
    if (voiceEngineRef?.current) {
      await voiceEngineRef.current.setPreferences(nextPreferences);
    }
    return nextPreferences;
  }, [isDesktop, user?.id, voiceEngineRef]);

  const joinVoice = useCallback(async (channel) => {
    try {
      if (voiceChannel?.id === channel.id) {
        return;
      }
      if (channel.is_private && !e2eeReady) {
        toast.error(t("e2ee.privateChannelVerifyDevice"));
        return;
      }

      if (voiceEngineRef?.current) {
        await voiceEngineRef.current.disconnect();
        voiceEngineRef.current = null;
      }

      setVoiceSession({
        status: VOICE_SESSION_JOINING,
        joinedChannelId: channel.id,
        snapshotConfirmed: false,
      });
      const { VoiceEngine } = await import("@/lib/voiceEngine");
      const engine = new VoiceEngine();
      await engine.init({
        serverId,
        channelId: channel.id,
        userId: user?.id,
        preferences: loadVoicePreferences(user?.id, { isDesktop }),
        runtimeConfig: config,
      });
      bindVoiceEngine(engine);
      if (voiceEngineRef) {
        voiceEngineRef.current = engine;
      }

      const desiredMuted = Boolean(localVoicePreferences.selfMuteEnabled);
      const desiredDeafened = Boolean(localVoicePreferences.selfDeafenEnabled);
      engine.setMuted(desiredMuted);
      engine.setDeafened(desiredDeafened);

      await api.post(`/servers/${serverId}/voice/${channel.id}/join`);
      await engine.joinChannel();
      const stateResponse = await api.put(`/servers/${serverId}/voice/${channel.id}/state`, {
        is_muted: desiredMuted,
        is_deafened: desiredDeafened,
      });
      setVoiceSession({
        status: VOICE_SESSION_CONNECTED,
        joinedChannelId: channel.id,
        snapshotConfirmed: false,
      });
      setVoiceChannel(channel);
      setIsMuted(Boolean(stateResponse?.data?.is_muted ?? desiredMuted));
      setIsDeafened(Boolean(stateResponse?.data?.is_deafened ?? desiredDeafened));
      setCameraEnabled(false);
      setScreenShareEnabled(false);
      setScreenShareMeta(createEmptyScreenShareMeta());
      setVideoTrackRefs([]);
      setLocalMediaState(EMPTY_LOCAL_MEDIA_STATE);
      onRefreshChannels?.();
      toast.success(t("channel.voiceConnected"));
    } catch (error) {
      if (voiceEngineRef?.current) {
        await voiceEngineRef.current.disconnect().catch(() => {});
        voiceEngineRef.current = null;
      }
      setVoiceSession(createIdleVoiceSession());
      setVoiceChannel(null);
      console.error("Voice join error:", error);
      toast.error(formatAppError(t, error, { fallbackKey: "channel.joinVoiceFailed" }));
    }
  }, [
    bindVoiceEngine,
    config,
    e2eeReady,
    isDesktop,
    localVoicePreferences.selfDeafenEnabled,
    localVoicePreferences.selfMuteEnabled,
    onRefreshChannels,
    serverId,
    t,
    user?.id,
    voiceChannel?.id,
    voiceEngineRef,
  ]);

  const leaveVoice = useCallback(async () => {
    if (!voiceChannel) {
      return;
    }
    try {
      setVoiceSession({
        status: VOICE_SESSION_LEAVING,
        joinedChannelId: voiceChannel.id,
        snapshotConfirmed: false,
      });
      if (voiceEngineRef?.current) {
        await voiceEngineRef.current.disconnect();
        voiceEngineRef.current = null;
      }
      await api.post(`/servers/${serverId}/voice/${voiceChannel.id}/leave`);
      setVoiceChannel(null);
      setIsMuted(preferredMuted);
      setIsDeafened(preferredDeafened);
      setCameraEnabled(false);
      setScreenShareEnabled(false);
      setScreenShareMeta(createEmptyScreenShareMeta());
      setVideoTrackRefs([]);
      setMediaParticipants([]);
      setLocalMediaState(EMPTY_LOCAL_MEDIA_STATE);
      setVoiceSession(createIdleVoiceSession());
      onRefreshChannels?.();
    } catch (error) {
      setVoiceSession({
        status: VOICE_SESSION_CONNECTED,
        joinedChannelId: voiceChannel.id,
        snapshotConfirmed: voiceSession.snapshotConfirmed,
      });
      toast.error(formatAppError(t, error, { fallbackKey: "channel.leaveVoiceFailed" }));
    }
  }, [onRefreshChannels, preferredDeafened, preferredMuted, serverId, t, voiceChannel, voiceEngineRef, voiceSession.snapshotConfirmed]);

  const toggleMute = useCallback(async () => {
    const engine = voiceEngineRef?.current;
    const previousMuted = Boolean(localVoicePreferences.selfMuteEnabled);
    const nextMuted = !isMuted;
    engine?.setMuted(nextMuted);
    setIsMuted(nextMuted);
    await updateLocalPreferences({ selfMuteEnabled: nextMuted });
    if (!voiceChannel) {
      return;
    }
    try {
      const response = await api.put(`/servers/${serverId}/voice/${voiceChannel.id}/state`, { is_muted: nextMuted });
      const persistedMuted = Boolean(response?.data?.is_muted ?? nextMuted);
      engine?.setMuted(persistedMuted);
      setIsMuted(persistedMuted);
      await updateLocalPreferences({ selfMuteEnabled: persistedMuted });
      onRefreshChannels?.();
    } catch (error) {
      engine?.setMuted(previousMuted);
      setIsMuted(previousMuted);
      await updateLocalPreferences({ selfMuteEnabled: previousMuted });
      toast.error(formatAppError(t, error, { fallbackKey: "channel.muteUpdateFailed" }));
    }
  }, [isMuted, localVoicePreferences.selfMuteEnabled, onRefreshChannels, serverId, t, updateLocalPreferences, voiceChannel, voiceEngineRef]);

  const toggleDeafen = useCallback(async () => {
    const engine = voiceEngineRef?.current;
    const previousDeafened = Boolean(localVoicePreferences.selfDeafenEnabled);
    const nextDeafened = !isDeafened;
    engine?.setDeafened(nextDeafened);
    setIsDeafened(nextDeafened);
    await updateLocalPreferences({ selfDeafenEnabled: nextDeafened });
    if (!voiceChannel) {
      return;
    }
    try {
      const response = await api.put(`/servers/${serverId}/voice/${voiceChannel.id}/state`, { is_deafened: nextDeafened });
      const persistedDeafened = Boolean(response?.data?.is_deafened ?? nextDeafened);
      engine?.setDeafened(persistedDeafened);
      setIsDeafened(persistedDeafened);
      await updateLocalPreferences({ selfDeafenEnabled: persistedDeafened });
      onRefreshChannels?.();
    } catch (error) {
      engine?.setDeafened(previousDeafened);
      setIsDeafened(previousDeafened);
      await updateLocalPreferences({ selfDeafenEnabled: previousDeafened });
      toast.error(formatAppError(t, error, { fallbackKey: "channel.deafenUpdateFailed" }));
    }
  }, [isDeafened, localVoicePreferences.selfDeafenEnabled, onRefreshChannels, serverId, t, updateLocalPreferences, voiceChannel, voiceEngineRef]);

  const toggleCamera = useCallback(async () => {
    if (!voiceChannel || !voiceEngineRef?.current) {
      return;
    }
    try {
      const enabled = await voiceEngineRef.current.toggleCamera();
      setCameraEnabled(Boolean(enabled));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "errors.cameraToggleFailed" }));
    }
  }, [t, voiceChannel, voiceEngineRef]);

  return {
    updateLocalPreferences,
    joinVoice,
    leaveVoice,
    toggleMute,
    toggleDeafen,
    toggleCamera,
    voiceChannel,
    isMuted,
    isDeafened,
    cameraEnabled,
    screenShareEnabled,
    screenShareMeta,
    voiceActivity,
    mediaParticipants,
    videoTrackRefs,
    localMediaState,
    localVoicePreferences,
    pttDebug,
  };
}
