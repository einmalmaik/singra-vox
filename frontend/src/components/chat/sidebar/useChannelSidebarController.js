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
import {
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { useRuntime } from "@/contexts/RuntimeContext";
import { useE2EE } from "@/contexts/E2EEContext";
import { loadVoicePreferences, saveVoicePreferences, subscribeVoicePreferences } from "@/lib/voicePreferences";
import { buildServerCapabilities } from "@/lib/serverPermissions";
import {
  buildChannelOrganization,
  computeChannelReorderPayload,
  parseContainerDropId,
  ROOT_CHANNEL_CONTAINER_ID,
} from "@/lib/channelOrganization";
import { useDesktopPtt } from "@/hooks/useDesktopPtt";
import { useDesktopCaptureSources } from "@/hooks/useDesktopCaptureSources";
import { useVoiceCleanup } from "@/hooks/useVoiceCleanup";
import { getScreenShareCapabilities } from "@/lib/screenShareCapabilities";
import { EMPTY_LOCAL_MEDIA_STATE, findVideoTrackRef } from "@/lib/videoTrackRefs";
import {
  DEFAULT_NATIVE_SCREEN_SHARE_PRESET_ID,
  DEFAULT_SCREEN_SHARE_PRESET_ID,
  getScreenSharePresetOptions,
  resolveScreenSharePreset,
} from "@/lib/screenSharePresets";
import {
  buildChannelParticipantEntries,
  buildLiveMediaEntries,
  createClosedStageState,
  createEmptyScreenShareMeta,
  createEmptyVoiceActivity,
  resolveParticipantDisplayName,
  ROOT_PARENT_ID,
} from "./channelSidebarUtils";

export function useChannelSidebarController({
  server,
  channels,
  currentChannel,
  onSelectChannel,
  onRefreshChannels,
  user,
  members,
  roles,
  viewerContext,
  unreadMap,
  voiceEngineRef,
  onLogout,
  onUserUpdated,
  onRefreshServers,
  serverSettingsRequest,
  t,
}) {
  const { config, runtimeInfo } = useRuntime();
  const { ready: e2eeReady } = useE2EE();
  const isDesktop = Boolean(config?.isDesktop);
  const screenShareCapabilities = useMemo(
    () => getScreenShareCapabilities({ isDesktop, runtimeInfo }),
    [isDesktop, runtimeInfo],
  );
  const useNativeScreenShare = Boolean(isDesktop && screenShareCapabilities.supportsNativeCapture);
  const screenSharePresetOptions = useMemo(
    () => getScreenSharePresetOptions({ isDesktop: useNativeScreenShare }),
    [useNativeScreenShare],
  );

  const [showCreate, setShowCreate] = useState(false);
  const [chName, setChName] = useState("");
  const [chType, setChType] = useState("text");
  const [chParentId, setChParentId] = useState(ROOT_PARENT_ID);
  const [creating, setCreating] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [screenShareDialogOpen, setScreenShareDialogOpen] = useState(false);
  const [screenShareQuality, setScreenShareQuality] = useState(DEFAULT_SCREEN_SHARE_PRESET_ID);
  const [screenShareAudio, setScreenShareAudio] = useState(false);
  const [screenShareAudioVolume, setScreenShareAudioVolume] = useState(100);
  const [screenShareSurface, setScreenShareSurface] = useState("monitor");
  const [screenShareMeta, setScreenShareMeta] = useState(createEmptyScreenShareMeta);
  const [voiceChannel, setVoiceChannel] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [activeDragId, setActiveDragId] = useState(null);
  const [voiceActivity, setVoiceActivity] = useState(createEmptyVoiceActivity);
  const [mediaParticipants, setMediaParticipants] = useState([]);
  const [videoTrackRefs, setVideoTrackRefs] = useState([]);
  const [localMediaState, setLocalMediaState] = useState(EMPTY_LOCAL_MEDIA_STATE);
  const [stageState, setStageState] = useState(createClosedStageState);
  const [localVoicePreferences, setLocalVoicePreferences] = useState(
    loadVoicePreferences(user?.id, { isDesktop }),
  );

  const preferredMuted = Boolean(localVoicePreferences.selfMuteEnabled);
  const preferredDeafened = Boolean(localVoicePreferences.selfDeafenEnabled);
  const capabilities = buildServerCapabilities({ user, server, viewerContext });
  const channelOrganization = useMemo(
    () => buildChannelOrganization(channels),
    [channels],
  );
  const categories = useMemo(
    () => channelOrganization.topLevelItems.filter((channel) => channel.type === "category"),
    [channelOrganization],
  );
  const currentVoiceParticipantIds = useMemo(() => {
    if (!voiceChannel?.id) {
      return [];
    }
    const nextChannel = channels.find((channel) => channel.id === voiceChannel.id);
    const participantIds = (nextChannel?.voice_states || []).map((state) => state.user_id).filter(Boolean);
    return [...new Set(participantIds)].sort();
  }, [channels, voiceChannel?.id]);
  const activeDragChannel = activeDragId ? channelOrganization.byId[activeDragId] : null;
  const isDraggingChannel = Boolean(activeDragChannel);
  const canDropIntoCategory = activeDragChannel?.type && activeDragChannel.type !== "category";

  useVoiceCleanup({ serverId: server?.id, voiceChannelId: voiceChannel?.id, voiceEngineRef });

  const mediaByUserId = useMemo(
    () => new Map(mediaParticipants.map((participant) => [participant.userId, participant])),
    [mediaParticipants],
  );
  const videoTrackRefsById = useMemo(
    () => new Map(videoTrackRefs.map((trackRef) => [trackRef.id, trackRef])),
    [videoTrackRefs],
  );
  const memberDisplayNames = useMemo(
    () => new Map(
      members.map((member) => [
        member.user_id,
        member.user?.display_name || member.display_name || t("common.unknown"),
      ]),
    ),
    [members, t],
  );
  const selectedStageTrackRef = useMemo(
    () => (stageState.trackRefId ? (videoTrackRefsById.get(stageState.trackRefId) || null) : null),
    [stageState.trackRefId, videoTrackRefsById],
  );
  const selectedStageParticipantName = useMemo(() => {
    if (!selectedStageTrackRef?.participantId) {
      return "";
    }
    if (selectedStageTrackRef.participantId === user?.id) {
      return resolveParticipantDisplayName(user, t);
    }
    return memberDisplayNames.get(selectedStageTrackRef.participantId) || t("common.unknown");
  }, [memberDisplayNames, selectedStageTrackRef?.participantId, t, user]);
  const liveMediaEntries = useMemo(
    () => buildLiveMediaEntries({ videoTrackRefs, user, memberDisplayNames, t }),
    [memberDisplayNames, t, user, videoTrackRefs],
  );
  const channelParticipantEntries = useMemo(
    () => buildChannelParticipantEntries({
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
    }),
    [
      cameraEnabled,
      channels,
      isDeafened,
      localVoicePreferences,
      mediaByUserId,
      screenShareEnabled,
      server,
      t,
      user,
      voiceActivity,
    ],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  const handleCaptureSourcesLoadError = useCallback((error) => {
    toast.error(formatAppError(t, error, { fallbackKey: "errors.nativeCaptureSourcesLoadFailed" }));
  }, [t]);

  const {
    captureSourcesStatus,
    captureSources,
    captureSourceType,
    selectedCaptureSourceId,
    filteredCaptureSources,
    setCaptureSourceType,
    setSelectedCaptureSourceId,
  } = useDesktopCaptureSources({
    enabled: Boolean(screenShareDialogOpen && useNativeScreenShare),
    onError: handleCaptureSourcesLoadError,
  });

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
        if (!event.wasClientInitiated) {
          if (voiceEngineRef?.current === engine) {
            voiceEngineRef.current = null;
          }
          setVoiceChannel(null);
        }
      }
    };

    engine.onStateChange = handleEvent;
    return engine.addStateListener(handleEvent);
  }, [voiceEngineRef]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const joinedVoiceChannel = channels.find((channel) => (
      channel.type === "voice"
      && channel.voice_states?.some((state) => state.user_id === user.id)
    )) || null;
    const hasLocalEngine = Boolean(voiceEngineRef?.current?.room);

    if (joinedVoiceChannel && !hasLocalEngine && !voiceChannel) {
      return;
    }
    if (joinedVoiceChannel && hasLocalEngine && voiceChannel?.id !== joinedVoiceChannel.id) {
      setVoiceChannel(joinedVoiceChannel);
      return;
    }
    if (!joinedVoiceChannel && voiceChannel) {
      setVoiceChannel(null);
    }
  }, [channels, user?.id, voiceChannel, voiceEngineRef]);

  useEffect(() => {
    if (!voiceChannel || !user?.id) {
      return;
    }
    const nextChannel = channels.find((channel) => channel.id === voiceChannel.id);
    const selfState = nextChannel?.voice_states?.find((state) => state.user_id === user.id);
    if (!nextChannel || !selfState) {
      setVoiceChannel(null);
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
  }, [channels, preferredDeafened, preferredMuted, user?.id, voiceChannel, voiceEngineRef]);

  useEffect(() => {
    if (serverSettingsRequest?.serverId && serverSettingsRequest.serverId === server?.id) {
      setServerSettingsOpen(true);
    }
  }, [server?.id, serverSettingsRequest]);

  useEffect(() => {
    const validPresetIds = new Set(screenSharePresetOptions.map((preset) => preset.id));
    if (validPresetIds.has(screenShareQuality)) {
      return;
    }
    setScreenShareQuality(
      useNativeScreenShare ? DEFAULT_NATIVE_SCREEN_SHARE_PRESET_ID : DEFAULT_SCREEN_SHARE_PRESET_ID,
    );
  }, [screenSharePresetOptions, screenShareQuality, useNativeScreenShare]);

  useEffect(() => {
    if (!screenShareCapabilities.supportsSystemAudio && screenShareAudio) {
      setScreenShareAudio(false);
    }
  }, [screenShareAudio, screenShareCapabilities.supportsSystemAudio]);

  useEffect(() => {
    if (!voiceChannel?.is_private || !voiceEngineRef?.current || currentVoiceParticipantIds.length === 0) {
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
  }, [currentVoiceParticipantIds, t, voiceChannel?.id, voiceChannel?.is_private, voiceEngineRef]);

  useEffect(() => {
    if (!stageState.open || !stageState.trackRefId) {
      return;
    }
    if (!videoTrackRefsById.has(stageState.trackRefId)) {
      setStageState(createClosedStageState());
    }
  }, [stageState, videoTrackRefsById]);

  const updateLocalPreferences = useCallback(async (partialUpdate) => {
    const nextPreferences = saveVoicePreferences(user?.id, partialUpdate, { isDesktop });
    setLocalVoicePreferences(nextPreferences);
    if (voiceEngineRef?.current) {
      await voiceEngineRef.current.setPreferences(nextPreferences);
    }
    return nextPreferences;
  }, [isDesktop, user?.id, voiceEngineRef]);

  const openCreateDialog = useCallback((type = "text", parentId = null) => {
    setChType(type);
    setChParentId(parentId || ROOT_PARENT_ID);
    setChName("");
    setShowCreate(true);
  }, []);

  const openCreateDialogFromButton = useCallback(() => {
    setShowCreate(true);
  }, []);

  const createChannel = useCallback(async (event) => {
    event.preventDefault();
    if (!chName.trim()) {
      return;
    }

    setCreating(true);
    try {
      await api.post(`/servers/${server.id}/channels`, {
        name: chName.trim(),
        type: chType,
        parent_id: chType === "category" ? null : (chParentId === ROOT_PARENT_ID ? null : chParentId),
      });
      toast.success(chType === "category" ? t("serverSettings.categoryCreated") : t("serverSettings.channelCreated"));
      setShowCreate(false);
      setChName("");
      onRefreshChannels?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelCreateFailed" }));
    } finally {
      setCreating(false);
    }
  }, [chName, chParentId, chType, onRefreshChannels, server?.id, t]);

  const syncChannelOrder = useCallback(async (items) => {
    if (!items?.length) {
      return;
    }
    await api.put(`/servers/${server.id}/channels/reorder`, { items });
    onRefreshChannels?.();
  }, [onRefreshChannels, server?.id]);

  const collisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    return rectIntersection(args);
  }, []);

  const handleChannelDragStart = useCallback((event) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleChannelDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);

  const handleChannelDragEnd = useCallback(async (event) => {
    setActiveDragId(null);

    const activeId = String(event.active?.id || "");
    const rawOverId = event.over?.id;
    if (!activeId || !rawOverId) {
      return;
    }

    const overId = String(rawOverId);
    const overContainerId = parseContainerDropId(overId);
    const payload = computeChannelReorderPayload({
      channels,
      activeId,
      overId: overContainerId ? null : overId,
      overContainerId,
    });

    if (!payload.length) {
      return;
    }

    try {
      await syncChannelOrder(payload);
      toast.success(t("serverSettings.channelOrderUpdated"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelReorderFailed" }));
    }
  }, [channels, syncChannelOrder, t]);

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

      const { VoiceEngine } = await import("@/lib/voiceEngine");
      const engine = new VoiceEngine();
      await engine.init({
        serverId: server.id,
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

      await api.post(`/servers/${server.id}/voice/${channel.id}/join`);
      await engine.joinChannel();
      const stateResponse = await api.put(`/servers/${server.id}/voice/${channel.id}/state`, {
        is_muted: desiredMuted,
        is_deafened: desiredDeafened,
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
    server?.id,
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
      if (voiceEngineRef?.current) {
        await voiceEngineRef.current.disconnect();
        voiceEngineRef.current = null;
      }
      await api.post(`/servers/${server.id}/voice/${voiceChannel.id}/leave`);
      setVoiceChannel(null);
      setIsMuted(preferredMuted);
      setIsDeafened(preferredDeafened);
      setCameraEnabled(false);
      setScreenShareEnabled(false);
      setScreenShareMeta(createEmptyScreenShareMeta());
      setVideoTrackRefs([]);
      setMediaParticipants([]);
      setLocalMediaState(EMPTY_LOCAL_MEDIA_STATE);
      setStageState(createClosedStageState());
      onRefreshChannels?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "channel.leaveVoiceFailed" }));
    }
  }, [onRefreshChannels, preferredDeafened, preferredMuted, server?.id, t, voiceChannel, voiceEngineRef]);

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
      const response = await api.put(`/servers/${server.id}/voice/${voiceChannel.id}/state`, { is_muted: nextMuted });
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
  }, [isMuted, localVoicePreferences.selfMuteEnabled, onRefreshChannels, server?.id, t, updateLocalPreferences, voiceChannel, voiceEngineRef]);

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
      const response = await api.put(`/servers/${server.id}/voice/${voiceChannel.id}/state`, { is_deafened: nextDeafened });
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
  }, [isDeafened, localVoicePreferences.selfDeafenEnabled, onRefreshChannels, server?.id, t, updateLocalPreferences, voiceChannel, voiceEngineRef]);

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

  const toggleScreenShare = useCallback(async () => {
    if (!voiceChannel || !voiceEngineRef?.current) {
      return;
    }
    if (!screenShareEnabled || isDesktop) {
      setScreenShareDialogOpen(true);
      return;
    }
    try {
      const enabled = await voiceEngineRef.current.toggleScreenShare();
      setScreenShareEnabled(Boolean(enabled));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "errors.screenShareToggleFailed" }));
    }
  }, [isDesktop, screenShareEnabled, t, voiceChannel, voiceEngineRef]);

  const updateScreenShareAudioVolume = useCallback((value) => {
    setScreenShareAudioVolume(value);
    voiceEngineRef?.current?.setScreenShareAudioVolume?.(value);
  }, [voiceEngineRef]);

  const startScreenShare = useCallback(async () => {
    if (!voiceChannel || !voiceEngineRef?.current) {
      return;
    }
    try {
      if (useNativeScreenShare && !selectedCaptureSourceId) {
        toast.error(t("channel.captureSourceMissing"));
        return;
      }

      const selectedSource = captureSources.find((source) => source.id === selectedCaptureSourceId) || null;
      const selectedPreset = resolveScreenSharePreset(screenShareQuality, {
        isDesktop: useNativeScreenShare,
        source: selectedSource,
      });

      voiceEngineRef.current.setScreenShareAudioVolume(screenShareAudioVolume);

      const enabled = await voiceEngineRef.current.startScreenShare(
        useNativeScreenShare
          ? {
            audio: screenShareAudio,
            nativeCapture: true,
            sourceId: selectedCaptureSourceId,
            sourceKind: selectedSource?.kind || captureSourceType,
            sourceLabel: selectedSource?.label || null,
            resolution: selectedPreset.resolution,
            qualityPreset: selectedPreset.id,
          }
          : {
            audio: screenShareAudio,
            displaySurface: screenShareSurface,
            resolution: selectedPreset.resolution,
            qualityPreset: selectedPreset.id,
          },
      );
      setScreenShareEnabled(Boolean(enabled));
      setScreenShareDialogOpen(false);
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "errors.screenShareStartFailed" }));
    }
  }, [
    captureSourceType,
    captureSources,
    screenShareAudio,
    screenShareAudioVolume,
    screenShareQuality,
    screenShareSurface,
    selectedCaptureSourceId,
    t,
    useNativeScreenShare,
    voiceChannel,
    voiceEngineRef,
  ]);

  const stopScreenShareFromDialog = useCallback(async () => {
    if (!voiceEngineRef?.current) {
      return;
    }
    try {
      await voiceEngineRef.current.stopScreenShare();
      setScreenShareEnabled(false);
      setScreenShareDialogOpen(false);
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "errors.screenShareStopFailed" }));
    }
  }, [t, voiceEngineRef]);

  const handleModerationAction = useCallback(async (participantId, action) => {
    try {
      if (action === "mute") {
        await api.post(`/servers/${server.id}/moderation/mute`, { user_id: participantId, duration_minutes: 10 });
      } else if (action === "server-deafen") {
        await api.post(`/servers/${server.id}/moderation/deafen`, { user_id: participantId });
      } else if (action === "server-undeafen") {
        await api.post(`/servers/${server.id}/moderation/undeafen`, { user_id: participantId });
      } else if (action === "kick") {
        await api.delete(`/servers/${server.id}/members/${participantId}`);
      } else if (action === "ban") {
        await api.post(`/servers/${server.id}/moderation/ban`, { user_id: participantId, reason: "Banned by moderator" });
      }
      onRefreshChannels?.();
      toast.success(t("serverSettings.memberUpdated"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.memberActionGenericFailed" }));
    }
  }, [onRefreshChannels, server?.id, t]);

  const renameChannelQuick = useCallback(async (channel) => {
    const nextName = window.prompt(
      channel.type === "category" ? t("serverSettings.renameCategoryPrompt") : t("serverSettings.renameChannelPrompt"),
      channel.name,
    );
    if (!nextName || !nextName.trim() || nextName.trim() === channel.name) {
      return;
    }
    try {
      await api.put(`/channels/${channel.id}`, { name: nextName.trim() });
      toast.success(channel.type === "category" ? t("serverSettings.categoryRenamed") : t("serverSettings.channelRenamed"));
      onRefreshChannels?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelRenameFailed" }));
    }
  }, [onRefreshChannels, t]);

  const deleteChannelQuick = useCallback(async (channel) => {
    const confirmed = window.confirm(
      channel.type === "category"
        ? t("serverSettings.deleteCategoryConfirm", { name: channel.name })
        : t("serverSettings.deleteChannelConfirm", { name: channel.name }),
    );
    if (!confirmed) {
      return;
    }
    try {
      await api.delete(`/channels/${channel.id}`);
      toast.success(channel.type === "category" ? t("serverSettings.categoryDeleted") : t("serverSettings.channelDeleted"));
      onRefreshChannels?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelDeleteFailed" }));
    }
  }, [onRefreshChannels, t]);

  const moveChannelToRoot = useCallback(async (channelId) => {
    const payload = computeChannelReorderPayload({
      channels,
      activeId: channelId,
      overContainerId: ROOT_CHANNEL_CONTAINER_ID,
    });
    if (!payload.length) {
      return;
    }
    try {
      await syncChannelOrder(payload);
      toast.success(t("serverSettings.movedToTopLevel"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelReorderFailed" }));
    }
  }, [channels, syncChannelOrder, t]);

  const resolveStageTrackRefId = useCallback((participantId, source) => (
    findVideoTrackRef(videoTrackRefs, {
      participantId,
      source,
      preferLocal: participantId === user?.id,
    })?.id || null
  ), [user?.id, videoTrackRefs]);

  const openMediaStage = useCallback((participantId, source, explicitTrackRefId = null) => {
    const trackRefId = explicitTrackRefId || resolveStageTrackRefId(participantId, source);
    if (!trackRefId) {
      return;
    }
    setStageState({
      open: true,
      trackRefId,
    });
  }, [resolveStageTrackRefId]);

  const closeMediaStage = useCallback(() => {
    setStageState(createClosedStageState());
  }, []);

  const handleActivateChannel = useCallback((channel) => {
    if (channel.type === "text") {
      onSelectChannel(channel);
      return;
    }
    if (channel.type === "voice") {
      void joinVoice(channel);
      return;
    }
    setCollapsedCategories((previous) => ({
      ...previous,
      [channel.id]: !previous[channel.id],
    }));
  }, [joinVoice, onSelectChannel]);
  return {
    layout: {
      header: {
        serverName: server?.name,
        canManageChannels: capabilities.canManageChannels,
        canOpenServerSettings: capabilities.canOpenServerSettings,
        onOpenCreateDialog: openCreateDialog,
        onOpenServerSettings: () => setServerSettingsOpen(true),
        t,
      },
    },
    channelTree: {
      sensors,
      collisionDetection,
      onDragStart: handleChannelDragStart,
      onDragCancel: handleChannelDragCancel,
      onDragEnd: handleChannelDragEnd,
      channelOrganization,
      currentChannel,
      unreadMap,
      collapsedCategories,
      capabilities,
      activeDragChannel,
      isDraggingChannel,
      canDropIntoCategory,
      channelParticipantEntries,
      currentUserId: user?.id,
      onUpdateLocalPreferences: updateLocalPreferences,
      onOpenMediaStage: openMediaStage,
      onHandleModerationAction: handleModerationAction,
      onOpenCreateDialog: openCreateDialog,
      onOpenCreateDialogButton: openCreateDialogFromButton,
      onRenameChannel: renameChannelQuick,
      onDeleteChannel: deleteChannelQuick,
      onMoveChannelToRoot: moveChannelToRoot,
      onOpenServerSettings: () => setServerSettingsOpen(true),
      onActivateChannel: handleActivateChannel,
      createButtonLabel: chType === "category" ? t("channel.addCategory") : t("channel.addChannel"),
      t,
    },
    voiceDock: {
      voiceChannel,
      voiceActivity,
      liveMediaEntries,
      cameraEnabled,
      screenShareEnabled,
      onToggleCamera: () => void toggleCamera(),
      onToggleScreenShare: () => void toggleScreenShare(),
      onLeaveVoice: () => void leaveVoice(),
      onOpenMediaStage: openMediaStage,
      t,
    },
    dialogs: {
      createChannel: {
        open: showCreate,
        onOpenChange: setShowCreate,
        channelName: chName,
        channelType: chType,
        parentId: chParentId,
        categories,
        creating,
        onChannelNameChange: setChName,
        onChannelTypeChange: setChType,
        onParentIdChange: setChParentId,
        onSubmit: createChannel,
        t,
      },
      screenShare: {
        open: screenShareDialogOpen,
        onOpenChange: setScreenShareDialogOpen,
        isDesktop,
        useNativeScreenShare,
        screenShareCapabilities,
        captureSourcesStatus,
        captureSourceType,
        filteredCaptureSources,
        selectedCaptureSourceId,
        screenSharePresetOptions,
        screenShareQuality,
        screenShareAudio,
        screenShareAudioVolume,
        screenShareSurface,
        screenShareEnabled,
        screenShareMeta,
        onCaptureSourceTypeChange: setCaptureSourceType,
        onSelectedCaptureSourceChange: setSelectedCaptureSourceId,
        onScreenShareQualityChange: setScreenShareQuality,
        onScreenShareAudioChange: setScreenShareAudio,
        onScreenShareSurfaceChange: setScreenShareSurface,
        onUpdateScreenShareAudioVolume: updateScreenShareAudioVolume,
        onStartScreenShare: startScreenShare,
        onStopScreenShare: stopScreenShareFromDialog,
        t,
      },
      serverSettings: {
        open: serverSettingsOpen,
        onClose: () => setServerSettingsOpen(false),
        server,
        channels,
        members,
        roles,
        user,
        viewerContext,
        onRefreshServers,
      },
      userSettings: {
        open: userSettingsOpen,
        onClose: () => setUserSettingsOpen(false),
        user,
        voiceEngineRef,
        channels,
        onUserUpdated,
        onLogout,
        pttDebug,
      },
      mediaStage: {
        open: stageState.open,
        onClose: closeMediaStage,
        voiceEngineRef,
        trackRefId: stageState.trackRefId,
        participantName: selectedStageParticipantName,
        source: selectedStageTrackRef?.source || null,
        selectedTrackRef: selectedStageTrackRef,
      },
    },
    userBar: {
      user,
      onUserUpdated,
      isMuted,
      isDeafened,
      onToggleMute: () => void toggleMute(),
      onToggleDeafen: () => void toggleDeafen(),
      onOpenSettings: () => setUserSettingsOpen(true),
      t,
    },
  };
}
