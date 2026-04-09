/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import UserStatusPanel from "@/components/chat/UserStatusPanel";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  CaretDown,
  CaretRight,
  Folder,
  GearSix,
  Hash,
  Lock,
  Microphone,
  MicrophoneSlash,
  MonitorPlay,
  Plus,
  Prohibit,
  SpeakerHigh,
  SpeakerSlash,
  UserMinus,
  VideoCamera,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { useRuntime } from "@/contexts/RuntimeContext";
import { useE2EE } from "@/contexts/E2EEContext";
import { loadVoicePreferences, saveVoicePreferences, subscribeVoicePreferences } from "@/lib/voicePreferences";
import { buildServerCapabilities } from "@/lib/serverPermissions";
import {
  buildChannelOrganization,
  computeChannelReorderPayload,
  getContainerDropId,
  parseContainerDropId,
  ROOT_CHANNEL_CONTAINER_ID,
} from "@/lib/channelOrganization";
import SortableChannelItem from "@/components/channels/SortableChannelItem";
import ChannelContainerDropZone from "@/components/channels/ChannelContainerDropZone";
import ServerSettingsOverlay from "@/components/settings/ServerSettingsOverlay";
import GlobalSettingsOverlay from "@/components/settings/GlobalSettingsOverlay";
import VoiceMediaStage from "@/components/chat/VoiceMediaStage";
import { useDesktopPtt } from "@/hooks/useDesktopPtt";
import { useVoiceCleanup } from "@/hooks/useVoiceCleanup";
import { getNativeScreenShareSession, listDesktopCaptureSources } from "@/lib/desktop";
import { getScreenShareCapabilities } from "@/lib/screenShareCapabilities";
import { buildMediaStageRevision, EMPTY_LOCAL_MEDIA_STATE } from "@/lib/mediaStageRevision";
import { findVideoTrackRef } from "@/lib/videoTrackRefs";
import {
  DEFAULT_NATIVE_SCREEN_SHARE_PRESET_ID,
  DEFAULT_SCREEN_SHARE_PRESET_ID,
  getScreenSharePresetOptions,
  resolveScreenSharePreset,
} from "@/lib/screenSharePresets";

function resolveParticipantDisplayName(participant, t) {
  return participant?.display_name || participant?.username || t("common.unknown");
}

export default function ChannelSidebar({
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
}) {
  const { t } = useTranslation();
  const { config } = useRuntime();
  const { ready: e2eeReady, isDesktopCapable } = useE2EE();
  const isDesktop = Boolean(config?.isDesktop);
  const screenShareCapabilities = useMemo(
    () => getScreenShareCapabilities({ isDesktop }),
    [isDesktop],
  );
  const screenSharePresetOptions = useMemo(
    () => getScreenSharePresetOptions({ isDesktop }),
    [isDesktop],
  );
  const [showCreate, setShowCreate] = useState(false);
  const [chName, setChName] = useState("");
  const [chType, setChType] = useState("text");
  const [chParentId, setChParentId] = useState("__root__");
  const [creating, setCreating] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [screenShareDialogOpen, setScreenShareDialogOpen] = useState(false);
  const [screenShareQuality, setScreenShareQuality] = useState(() => (
    isDesktop ? DEFAULT_NATIVE_SCREEN_SHARE_PRESET_ID : DEFAULT_SCREEN_SHARE_PRESET_ID
  ));
  // Systemaudio ist standardmäßig AUS – Nutzer aktiviert es explizit
  const [screenShareAudio, setScreenShareAudio] = useState(false);
  // Lautstärke des geteilten Audios (0-200%, Default 100%)
  const [screenShareAudioVolume, setScreenShareAudioVolume] = useState(100);
  const [screenShareSurface, setScreenShareSurface] = useState("monitor");
  const [captureSourcesStatus, setCaptureSourcesStatus] = useState("idle");
  const [captureSources, setCaptureSources] = useState([]);
  const [captureSourceType, setCaptureSourceType] = useState("display");
  const [selectedCaptureSourceId, setSelectedCaptureSourceId] = useState(null);
  const [screenShareMeta, setScreenShareMeta] = useState({
    hasAudio: false,
    actualCaptureSettings: null,
    sourceId: null,
    sourceKind: null,
    sourceLabel: null,
    provider: null,
  });
  const [voiceChannel, setVoiceChannel] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [activeDragId, setActiveDragId] = useState(null);
  const [voiceActivity, setVoiceActivity] = useState({
    localSpeaking: false,
    activeSpeakerIds: [],
    audioLevel: 0,
  });
  const [mediaParticipants, setMediaParticipants] = useState([]);
  const [videoTrackRefs, setVideoTrackRefs] = useState([]);
  const [localMediaState, setLocalMediaState] = useState(EMPTY_LOCAL_MEDIA_STATE);
  const [stageState, setStageState] = useState({
    open: false,
    trackRefId: null,
    participantId: null,
    participantName: "",
    source: null,
  });
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
  const filteredCaptureSources = useMemo(
    () => captureSources.filter((source) => source.kind === captureSourceType),
    [captureSourceType, captureSources],
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

  // Voice-Session sauber aufräumen wenn der Browser-Tab geschlossen wird
  useVoiceCleanup({ serverId: server?.id, voiceChannelId: voiceChannel?.id, voiceEngineRef });
  const mediaByUserId = useMemo(
    () => new Map(mediaParticipants.map((participant) => [participant.userId, participant])),
    [mediaParticipants],
  );
  const videoTrackRefsById = useMemo(
    () => new Map(videoTrackRefs.map((trackRef) => [trackRef.id, trackRef])),
    [videoTrackRefs],
  );
  const mediaStageRevision = useMemo(() => buildMediaStageRevision({
    selectedTrackRefId: stageState.trackRefId,
    trackRefs: videoTrackRefs,
  }), [stageState.trackRefId, videoTrackRefs]);
  const memberDisplayNames = useMemo(
    () => new Map(
      members.map((member) => [
        member.user_id,
        member.user?.display_name || member.display_name || t("common.unknown"),
      ]),
    ),
    [members, t],
  );
  const liveMediaEntries = useMemo(() => {
    return videoTrackRefs
      .filter((trackRef) => trackRef.state === "ready" || trackRef.isLocal)
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
  }, [
    memberDisplayNames,
    t,
    user,
    videoTrackRefs,
  ]);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  const pttDebug = useDesktopPtt({
    enabled: Boolean(isDesktop && localVoicePreferences.pttEnabled),
    shortcut: localVoicePreferences.pttKey,
    voiceEngineRef,
    active: Boolean(isDesktop),
  });

  useEffect(() => {
    setLocalVoicePreferences(loadVoicePreferences(user?.id, { isDesktop }));
  }, [isDesktop, user?.id]);

  useEffect(() => {
    return subscribeVoicePreferences(user?.id, (nextPreferences) => {
      setLocalVoicePreferences(nextPreferences);
    });
  }, [user?.id]);

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
        setVoiceActivity({ localSpeaking: false, activeSpeakerIds: [], audioLevel: 0 });
        setCameraEnabled(false);
        setScreenShareEnabled(false);
        setScreenShareMeta({
          hasAudio: false,
          actualCaptureSettings: null,
          sourceId: null,
          sourceKind: null,
          sourceLabel: null,
          provider: null,
        });
        setVideoTrackRefs([]);
        setMediaParticipants([]);
        setLocalMediaState(EMPTY_LOCAL_MEDIA_STATE);

        // Wenn die Trennung NICHT von uns initiiert wurde (z.B. weil ein
        // anderer Client mit gleicher Identity beigetreten ist), VoiceEngine
        // aufräumen und voiceChannel zurücksetzen. Die DB-Bereinigung erfolgt
        // automatisch über den voice_join des anderen Clients.
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

  // ── Voice-State-Sync: Discord-Verhalten ──────────────────────────────────
  // Wir synchronisieren voiceChannel NUR wenn ein lokaler VoiceEngine aktiv ist.
  // Wenn der User von Tauri aus verbunden ist und die Web-App öffnet, soll die
  // Web-App ihn NICHT automatisch als verbunden anzeigen – er muss den Kanal
  // manuell neu joinen (wie bei Discord).
  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const joinedVoiceChannel = channels.find((channel) => (
      channel.type === "voice"
      && channel.voice_states?.some((state) => state.user_id === user.id)
    )) || null;

    const hasLocalEngine = Boolean(voiceEngineRef?.current?.room);

    // Wenn die DB zeigt dass wir in einem Kanal sind, ABER kein lokaler
    // VoiceEngine verbunden ist → NICHT automatisch als verbunden anzeigen.
    // Der User muss den Kanal auf diesem Client explizit joinen.
    if (joinedVoiceChannel && !hasLocalEngine && !voiceChannel) {
      // Nichts tun – auf diesem Client ist der User nicht verbunden
      return;
    }

    // Wenn der lokale Engine aktiv ist UND die DB einen anderen Kanal zeigt,
    // updaten wir den State (z.B. nach Channel-Wechsel)
    if (joinedVoiceChannel && hasLocalEngine && voiceChannel?.id !== joinedVoiceChannel.id) {
      setVoiceChannel(joinedVoiceChannel);
      return;
    }

    // Wenn die DB zeigt dass der User NICHT mehr verbunden ist, aufräumen
    if (!joinedVoiceChannel && voiceChannel) {
      setVoiceChannel(null);
    }
  }, [channels, user?.id, voiceChannel, voiceEngineRef]);

  useEffect(() => {
    if (!voiceChannel || !user?.id) return;
    const nextChannel = channels.find((channel) => channel.id === voiceChannel.id);
    const selfState = nextChannel?.voice_states?.find((state) => state.user_id === user.id);
    if (!nextChannel || !selfState) {
      setVoiceChannel(null);
      setIsMuted(preferredMuted);
      setIsDeafened(preferredDeafened);
      setCameraEnabled(false);
      setScreenShareEnabled(false);
      setScreenShareMeta({
        hasAudio: false,
        actualCaptureSettings: null,
        sourceId: null,
        sourceKind: null,
        sourceLabel: null,
        provider: null,
      });
      setVoiceActivity({ localSpeaking: false, activeSpeakerIds: [], audioLevel: 0 });
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
    if (!isDesktop || !screenShareDialogOpen) {
      return undefined;
    }

    let cancelled = false;

    const loadCaptureSources = async () => {
      setCaptureSourcesStatus("loading");
      try {
        const [sources, activeSession] = await Promise.all([
          listDesktopCaptureSources(),
          getNativeScreenShareSession().catch(() => null),
        ]);

        if (cancelled) {
          return;
        }

        setCaptureSources(Array.isArray(sources) ? sources : []);
        setCaptureSourcesStatus("ready");

        const preferredSourceKind = activeSession?.sourceKind || "display";
        const nextSelectedSourceId = activeSession?.sourceId
          || (Array.isArray(sources)
            ? (sources.find((source) => source.kind === preferredSourceKind)?.id || sources[0]?.id || null)
            : null);
        const nextSelectedSource = (sources || []).find((source) => source.id === nextSelectedSourceId) || null;
        if (nextSelectedSourceId) {
          setSelectedCaptureSourceId(nextSelectedSourceId);
        }
        if (nextSelectedSource?.kind) {
          setCaptureSourceType(nextSelectedSource.kind);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setCaptureSourcesStatus("error");
        toast.error(formatAppError(t, error, { fallbackKey: "errors.nativeCaptureSourcesLoadFailed" }));
      }
    };

    void loadCaptureSources();

    return () => {
      cancelled = true;
    };
  }, [isDesktop, screenShareDialogOpen, t]);

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

    // Keep the LiveKit room key aligned with the current voice audience. This
    // runs on membership changes and periodically during long-lived calls so a
    // kicked or departed participant cannot continue using an old room key.
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
      setStageState({
        open: false,
        trackRefId: null,
        participantId: null,
        participantName: "",
        source: null,
      });
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
    setChParentId(parentId || "__root__");
    setChName("");
    setShowCreate(true);
  }, []);

  const createChannel = useCallback(async (event) => {
    event.preventDefault();
    if (!chName.trim()) return;

    setCreating(true);
    try {
      await api.post(`/servers/${server.id}/channels`, {
        name: chName.trim(),
        type: chType,
        parent_id: chType === "category" ? null : (chParentId === "__root__" ? null : chParentId),
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
      if (voiceChannel?.id === channel.id) return;
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
      setScreenShareMeta({
        hasAudio: false,
        actualCaptureSettings: null,
        sourceId: null,
        sourceKind: null,
        sourceLabel: null,
        provider: null,
      });
      setVideoTrackRefs([]);
      setLocalMediaState(EMPTY_LOCAL_MEDIA_STATE);
      onRefreshChannels?.();
      toast.success(t("channel.voiceConnected"));
    } catch (error) {
      console.error("Voice join error:", error);
      toast.error(formatAppError(t, error, { fallbackKey: "channel.joinVoiceFailed" }));
    }
  }, [bindVoiceEngine, config, e2eeReady, isDesktop, localVoicePreferences.selfDeafenEnabled, localVoicePreferences.selfMuteEnabled, onRefreshChannels, server?.id, t, user?.id, voiceChannel?.id, voiceEngineRef]);

  const leaveVoice = useCallback(async () => {
    if (!voiceChannel) return;
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
      setScreenShareMeta({
        hasAudio: false,
        actualCaptureSettings: null,
        sourceId: null,
        sourceKind: null,
        sourceLabel: null,
        provider: null,
      });
      setVideoTrackRefs([]);
      setMediaParticipants([]);
      setLocalMediaState(EMPTY_LOCAL_MEDIA_STATE);
      setStageState({ open: false, trackRefId: null, participantId: null, participantName: "", source: null });
      onRefreshChannels?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "channel.leaveVoiceFailed" }));
    }
  }, [onRefreshChannels, preferredDeafened, preferredMuted, server?.id, t, voiceChannel, voiceEngineRef]);

  const toggleMute = async () => {
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
  };

  const toggleDeafen = async () => {
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
  };

  const toggleCamera = async () => {
    if (!voiceChannel || !voiceEngineRef?.current) return;
    try {
      const enabled = await voiceEngineRef.current.toggleCamera();
      setCameraEnabled(Boolean(enabled));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "errors.cameraToggleFailed" }));
    }
  };

  const toggleScreenShare = async () => {
    if (!voiceChannel || !voiceEngineRef?.current) return;
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
  };

  const startScreenShare = async () => {
    if (!voiceChannel || !voiceEngineRef?.current) return;
    try {
      if (isDesktop && !selectedCaptureSourceId) {
        toast.error(t("channel.captureSourceMissing"));
        return;
      }

      const selectedSource = captureSources.find((source) => source.id === selectedCaptureSourceId) || null;
      const selectedPreset = resolveScreenSharePreset(screenShareQuality, {
        isDesktop,
        source: selectedSource,
      });

      // Audio-Lautstärke VOR dem Start setzen, damit der GainNode
      // mit dem richtigen Wert initialisiert wird
      voiceEngineRef.current.setScreenShareAudioVolume(screenShareAudioVolume);

      const enabled = await voiceEngineRef.current.startScreenShare(
        isDesktop
          ? {
            audio: false,
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
  };

  const stopScreenShareFromDialog = async () => {
    if (!voiceEngineRef?.current) return;
    try {
      await voiceEngineRef.current.stopScreenShare();
      setScreenShareEnabled(false);
      setScreenShareDialogOpen(false);
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "errors.screenShareStopFailed" }));
    }
  };

  const handleModerationAction = async (participantId, action) => {
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
  };

  const renameChannelQuick = async (channel) => {
    const nextName = window.prompt(
      channel.type === "category" ? t("serverSettings.renameCategoryPrompt") : t("serverSettings.renameChannelPrompt"),
      channel.name,
    );
    if (!nextName || nextName.trim() === channel.name) return;
    try {
      await api.put(`/channels/${channel.id}`, { name: nextName.trim() });
      toast.success(channel.type === "category" ? t("serverSettings.categoryRenamed") : t("serverSettings.channelRenamed"));
      onRefreshChannels?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelRenameFailed" }));
    }
  };

  const deleteChannelQuick = async (channel) => {
    const confirmed = window.confirm(
      channel.type === "category"
        ? t("serverSettings.deleteCategoryConfirm", { name: channel.name })
        : t("serverSettings.deleteChannelConfirm", { name: channel.name }),
    );
    if (!confirmed) return;
    try {
      await api.delete(`/channels/${channel.id}`);
      toast.success(channel.type === "category" ? t("serverSettings.categoryDeleted") : t("serverSettings.channelDeleted"));
      onRefreshChannels?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelDeleteFailed" }));
    }
  };

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

  const resolveStageTrackRefId = useCallback((participantId, source) => {
    return findVideoTrackRef(videoTrackRefs, {
      participantId,
      source,
      preferLocal: participantId === user?.id,
    })?.id || null;
  }, [user?.id, videoTrackRefs]);

  const openMediaStage = useCallback((participantId, participantName, source, explicitTrackRefId = null) => {
    const trackRefId = explicitTrackRefId || resolveStageTrackRefId(participantId, source);
    if (!trackRefId) {
      return;
    }
    setStageState({
      open: true,
      trackRefId,
      participantId,
      participantName,
      source,
    });
  }, [resolveStageTrackRefId]);

  const renderChannelRow = (channel, { nested = false } = {}) => {
    const unread = unreadMap?.[channel.id];
    const categoryCollapsed = Boolean(collapsedCategories[channel.id]);
    const hasUnread = Boolean(unread?.count) && currentChannel?.id !== channel.id && channel.type === "text";
    const hasMentionUnread = hasUnread && unread?.mentions > 0;
    return (
      <ContextMenu key={channel.id}>
        <SortableChannelItem
          id={channel.id}
          disabled={!capabilities.canManageChannels}
          data={{
            itemType: channel.type,
            containerId: channel.type === "category"
              ? ROOT_CHANNEL_CONTAINER_ID
              : (channel.parent_id || ROOT_CHANNEL_CONTAINER_ID),
          }}
        >
          {({ setNodeRef, attributes, listeners, isDragging, isOver, style }) => (
            <ContextMenuTrigger asChild>
              <button
                ref={setNodeRef}
                type="button"
                {...attributes}
                {...listeners}
                style={{
                  ...style,
                  paddingLeft: nested ? "28px" : undefined,
                }}
                onClick={() => {
                  if (channel.type === "text") {
                    onSelectChannel(channel);
                  } else if (channel.type === "voice") {
                    void joinVoice(channel);
                  } else {
                    setCollapsedCategories((previous) => ({
                      ...previous,
                      [channel.id]: !previous[channel.id],
                    }));
                  }
                }}
                className={`channel-item w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm touch-none transition-all ${
                  currentChannel?.id === channel.id
                    ? "active text-white bg-cyan-500/12 workspace-cyan-glow"
                    : hasMentionUnread
                      ? "bg-[#2A1616] text-white font-semibold"
                      : hasUnread
                        ? "text-white font-semibold hover:bg-white/5"
                        : "text-[#A1A1AA] hover:bg-white/5 hover:text-white"
                } ${isOver ? "ring-1 ring-cyan-400/70 bg-white/5" : ""} ${isDragging ? "opacity-60" : ""}`}
                data-testid={`channel-${channel.name}`}
              >
                {hasUnread && (
                  <span
                    className={`h-5 rounded-r-full transition-all ${
                      hasMentionUnread ? "w-2 bg-[#EF4444] animate-pulse" : "w-1 bg-white/90"
                    }`}
                  />
                )}
                {channel.type === "category" ? (
                  <>
                    {categoryCollapsed ? (
                      <CaretRight size={12} weight="bold" className="text-[#71717A] shrink-0" />
                    ) : (
                      <CaretDown size={12} weight="bold" className="text-[#71717A] shrink-0" />
                    )}
                    <Folder size={16} weight="bold" className="text-[#71717A] shrink-0" />
                  </>
                ) : channel.type === "voice" ? (
                  <SpeakerHigh size={16} weight="bold" className="text-[#71717A] shrink-0" />
                ) : channel.is_private ? (
                  <Lock size={16} weight="bold" className="text-[#71717A] shrink-0" />
                ) : (
                  <Hash size={16} weight="bold" className="text-[#71717A] shrink-0" />
                )}
                <span className="truncate flex-1">{channel.name}</span>
                {unread?.count > 0 && currentChannel?.id !== channel.id && channel.type === "text" && (
                  <span className={`shrink-0 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center ${
                    unread.mentions > 0 ? "bg-[#EF4444] text-white" : "bg-[#6366F1] text-white"
                  }`}>
                    {unread.count > 99 ? "99+" : unread.count}
                  </span>
                )}
              </button>
            </ContextMenuTrigger>
          )}
        </SortableChannelItem>
        <ContextMenuContent className="w-52 border-[#27272A] bg-[#18181B] text-white">
          {capabilities.canManageChannels ? (
            channel.type === "category" ? (
              <>
                <ContextMenuItem onClick={() => openCreateDialog("text", channel.id)}>{t("serverSettings.createTextChannel")}</ContextMenuItem>
                <ContextMenuItem onClick={() => openCreateDialog("voice", channel.id)}>{t("serverSettings.createVoiceChannel")}</ContextMenuItem>
                <ContextMenuItem onClick={() => renameChannelQuick(channel)}>{t("serverSettings.renameCategoryAction")}</ContextMenuItem>
                <ContextMenuItem className="text-[#EF4444]" onClick={() => deleteChannelQuick(channel)}>{t("serverSettings.deleteCategoryAction")}</ContextMenuItem>
              </>
            ) : (
              <>
                <ContextMenuItem onClick={() => renameChannelQuick(channel)}>{t("serverSettings.renameChannelAction")}</ContextMenuItem>
                {channel.parent_id && (
                  <ContextMenuItem onClick={() => { void moveChannelToRoot(channel.id); }}>
                    {t("serverSettings.moveToRoot")}
                  </ContextMenuItem>
                )}
                <ContextMenuItem className="text-[#EF4444]" onClick={() => deleteChannelQuick(channel)}>{t("serverSettings.deleteChannelAction")}</ContextMenuItem>
                <ContextMenuItem onClick={() => setServerSettingsOpen(true)}>{t("serverSettings.editChannel")}</ContextMenuItem>
              </>
            )
          ) : (
            <ContextMenuItem disabled className="text-[#71717A] focus:text-[#71717A] focus:bg-transparent cursor-default">
              {t("common.noActionsAvailable", { defaultValue: "No actions available" })}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const renderCategoryBlock = (category) => {
    const collapsed = Boolean(collapsedCategories[category.id]);
    const childIds = channelOrganization.childIdsByCategory[category.id] || [];

    return (
      <div key={category.id} className="workspace-card px-1.5 py-1.5">
        {renderChannelRow(category)}
        {!collapsed && (
          <div className="space-y-1 border-t border-[#202027] pt-1">
            {canDropIntoCategory && (
              <ChannelContainerDropZone
                id={getContainerDropId(category.id)}
                data={{ containerId: category.id }}
              >
                {({ setNodeRef, isOver }) => (
                  <div
                    ref={setNodeRef}
                    className={`ml-7 rounded-md border border-dashed px-3 py-1 text-[11px] transition-colors ${
                      isOver
                        ? "border-[#6366F1] bg-[#18181B] text-[#A5B4FC]"
                        : "border-[#27272A] bg-[#111113] text-[#52525B]"
                    }`}
                  >
                    {t("serverSettings.dropIntoCategory", { name: category.name })}
                  </div>
                )}
              </ChannelContainerDropZone>
            )}
              <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
                {childIds.map((channelId) => {
                  const childChannel = channelOrganization.byId[channelId];
                if (!childChannel) {
                  return null;
                }
                return (
                  <div key={channelId}>
                    {renderChannelRow(childChannel, { nested: true })}
                    {childChannel.type === "voice" && renderVoiceParticipants(childChannel)}
                  </div>
                );
              })}
            </SortableContext>
            {childIds.length === 0 && !canDropIntoCategory && (
              <div className="px-7 py-1 text-[11px] text-[#5A5A63]">{t("channel.noChannelsYet")}</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderVoiceParticipants = (channel) => {
    if (!channel.voice_states?.length) return null;

    return (
      <div className="pl-8 space-y-1">
        {channel.voice_states.map((voiceState) => {
          const participantId = voiceState.user_id;
          const locallyMuted = Boolean(localVoicePreferences.locallyMutedParticipants?.[participantId]);
          const participantVolume = localVoicePreferences.perUserVolumes?.[participantId] ?? 100;
          const remoteSpeakingVisible = !isDeafened && !locallyMuted;
          const speaking = participantId === user?.id
            ? voiceActivity.localSpeaking
            : (remoteSpeakingVisible && voiceActivity.activeSpeakerIds.includes(participantId));
          const isServerOwner = server?.owner_id === participantId;
          const participantMedia = participantId === user?.id
            ? {
                hasCamera: cameraEnabled,
                hasScreenShare: screenShareEnabled,
              }
            : mediaByUserId.get(participantId);
          const hasCamera = Boolean(participantMedia?.hasCamera);
          const hasScreenShare = Boolean(participantMedia?.hasScreenShare);
          const participantName = voiceState.user?.display_name || t("common.unknown");

          return (
            <DropdownMenu key={participantId}>
              <DropdownMenuTrigger asChild>
                <button className="w-full flex items-center gap-2 rounded-xl px-2 py-1.5 text-xs text-[#A1A1AA] hover:bg-white/5 hover:text-white text-left transition-colors">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold ${
                    speaking ? "bg-[#6366F1] voice-active" : "bg-[#27272A]"
                  }`}>
                    {voiceState.user?.display_name?.[0]?.toUpperCase() || "?"}
                  </div>
                  <span className="truncate flex-1">{participantName}</span>
                  {hasCamera && (
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
                        openMediaStage(participantId, participantName, "camera");
                      }}
                      className="rounded p-0.5 text-[#22C55E] transition-colors hover:bg-[#27272A] hover:text-white"
                      title={t("channel.viewCamera")}
                    >
                      <VideoCamera size={12} weight="fill" />
                    </span>
                  )}
                  {hasScreenShare && (
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
                        openMediaStage(participantId, participantName, "screen_share");
                      }}
                      className="rounded p-0.5 text-[#22C55E] transition-colors hover:bg-[#27272A] hover:text-white"
                      title={t("channel.watchStream")}
                    >
                      <MonitorPlay size={12} weight="fill" />
                    </span>
                  )}
                  {voiceState.is_muted && <MicrophoneSlash size={12} className="text-[#EF4444]" />}
                  {voiceState.is_deafened && <SpeakerSlash size={12} className="text-[#EF4444]" />}
                  {locallyMuted && <Prohibit size={12} className="text-[#F59E0B]" />}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64 border-[#27272A] bg-[#18181B] text-white">
                <DropdownMenuLabel>{voiceState.user?.display_name || t("common.unknown")}</DropdownMenuLabel>
                <div className="px-3 py-2 space-y-2">
                  <div className="flex items-center justify-between text-xs text-[#71717A]">
                    <span>{t("channel.userVolume")}</span>
                    <span>{participantVolume}%</span>
                  </div>
                  <Slider
                    value={[participantVolume]}
                    min={0}
                    max={200}
                    step={5}
                    onValueChange={([value]) => {
                      void updateLocalPreferences({ perUserVolumes: { [participantId]: value } });
                    }}
                  />
                </div>
                <DropdownMenuCheckboxItem
                  checked={locallyMuted}
                  onCheckedChange={(checked) => {
                    void updateLocalPreferences({ locallyMutedParticipants: { [participantId]: checked } });
                  }}
                >
                  {t("channel.muteForMe")}
                </DropdownMenuCheckboxItem>
                <DropdownMenuItem
                  onClick={() => {
                    void updateLocalPreferences({
                      perUserVolumes: { [participantId]: 100 },
                      locallyMutedParticipants: { [participantId]: false },
                    });
                  }}
                >
                  {t("channel.resetLocalAudio")}
                </DropdownMenuItem>
                {(hasCamera || hasScreenShare) && (
                  <>
                    <DropdownMenuSeparator className="bg-[#27272A]" />
                    {hasScreenShare && (
                      <DropdownMenuItem onClick={() => openMediaStage(participantId, participantName, "screen_share")}>
                        {t("channel.watchStream")}
                      </DropdownMenuItem>
                    )}
                    {hasCamera && (
                      <DropdownMenuItem onClick={() => openMediaStage(participantId, participantName, "camera")}>
                        {t("channel.viewCamera")}
                      </DropdownMenuItem>
                    )}
                  </>
                )}
                {participantId !== user?.id && (
                  <>
                    {(capabilities.canMuteMembers || capabilities.canDeafenMembers || capabilities.canKickMembers || capabilities.canBanMembers) && (
                      <DropdownMenuSeparator className="bg-[#27272A]" />
                    )}
                    {capabilities.canMuteMembers && (
                      <DropdownMenuItem onClick={() => handleModerationAction(participantId, "mute")}>
                        {t("channel.serverMute")}
                      </DropdownMenuItem>
                    )}
                    {capabilities.canDeafenMembers && (
                      <DropdownMenuItem onClick={() => handleModerationAction(participantId, voiceState.is_deafened ? "server-undeafen" : "server-deafen")}>
                        {voiceState.is_deafened ? t("channel.serverUndeafen") : t("channel.serverDeafen")}
                      </DropdownMenuItem>
                    )}
                    {capabilities.canKickMembers && !isServerOwner && (
                      <DropdownMenuItem className="text-[#EF4444]" onClick={() => handleModerationAction(participantId, "kick")}>
                        <UserMinus size={14} className="mr-2" /> {t("memberList.kick")}
                      </DropdownMenuItem>
                    )}
                    {capabilities.canBanMembers && !isServerOwner && (
                      <DropdownMenuItem className="text-[#EF4444]" onClick={() => handleModerationAction(participantId, "ban")}>
                        <Prohibit size={14} className="mr-2" /> {t("memberList.ban")}
                      </DropdownMenuItem>
                    )}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>
    );
  };

  return (
    <>
      <div className="workspace-panel w-[300px] h-full min-h-0 flex flex-col shrink-0 overflow-hidden" data-testid="channel-sidebar">
        <div className="h-14 flex items-center justify-between px-4 border-b workspace-divider shrink-0 bg-zinc-900/25">
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <h3 className="text-base font-bold text-white truncate" style={{ fontFamily: "Manrope" }} data-testid="server-name-header">
                {server?.name}
              </h3>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-52 border-[#27272A] bg-[#18181B] text-white">
              {capabilities.canManageChannels ? (
                <>
                  <ContextMenuItem onClick={() => openCreateDialog("category", null)}>{t("serverSettings.createCategory")}</ContextMenuItem>
                  <ContextMenuItem onClick={() => openCreateDialog("text", null)}>{t("serverSettings.createTextChannel")}</ContextMenuItem>
                  <ContextMenuItem onClick={() => openCreateDialog("voice", null)}>{t("serverSettings.createVoiceChannel")}</ContextMenuItem>
                </>
              ) : (
                <ContextMenuItem disabled className="text-[#71717A] focus:text-[#71717A] focus:bg-transparent cursor-default">
                  {t("common.noActionsAvailable", { defaultValue: "No actions available" })}
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
          {capabilities.canOpenServerSettings && (
            <button
              className="workspace-icon-button"
              onClick={() => setServerSettingsOpen(true)}
              data-testid="server-settings-button"
            >
              <GearSix size={16} weight="bold" />
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          {/* dnd-kit keeps pointer and hover state stable inside nested lists. The
              old native HTML5 path flickered here because rows, gaps, and menus
              all competed for drag events. */}
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleChannelDragStart}
            onDragCancel={handleChannelDragCancel}
            onDragEnd={handleChannelDragEnd}
          >
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
                  <div className="space-y-3">
                    <SortableContext items={channelOrganization.rootIds} strategy={verticalListSortingStrategy}>
                      {channelOrganization.rootIds.map((channelId) => {
                        const channel = channelOrganization.byId[channelId];
                        if (!channel) {
                          return null;
                        }
                        if (channel.type === "category") {
                          return renderCategoryBlock(channel);
                        }
                        return (
                          <div key={channel.id}>
                            {renderChannelRow(channel)}
                            {channel.type === "voice" && renderVoiceParticipants(channel)}
                          </div>
                        );
                      })}
                    </SortableContext>
                    {capabilities.canManageChannels && isDraggingChannel && (
                      <ChannelContainerDropZone
                        id={getContainerDropId(ROOT_CHANNEL_CONTAINER_ID)}
                        data={{ containerId: ROOT_CHANNEL_CONTAINER_ID }}
                      >
                        {({ setNodeRef, isOver }) => (
                          <div
                            ref={setNodeRef}
                            className={`rounded-xl border border-dashed px-3 py-2 text-[11px] transition-colors ${
                              isOver
                                ? "border-cyan-400 bg-cyan-500/10 text-cyan-200"
                                : "border-white/10 bg-zinc-950/55 text-[#71717A]"
                            }`}
                          >
                            {t("serverSettings.dropToTopLevel")}
                          </div>
                        )}
                      </ChannelContainerDropZone>
                    )}
                  </div>

                  {capabilities.canManageChannels && (
                    <Dialog open={showCreate} onOpenChange={setShowCreate}>
                      <DialogTrigger asChild>
                        <button
                          data-testid="create-channel-button"
                          className="mt-1 flex w-full items-center gap-2 rounded-xl border border-dashed border-white/10 bg-zinc-950/35 px-3 py-2 text-sm text-[#A1A1AA] transition-all hover:border-cyan-400/40 hover:bg-cyan-500/8 hover:text-white"
                        >
                          <Plus size={14} weight="bold" />
                          <span>{chType === "category" ? t("channel.addCategory") : t("channel.addChannel")}</span>
                        </button>
                      </DialogTrigger>
                        <DialogContent className="workspace-panel-solid max-w-sm text-white">
                        <DialogHeader>
                          <DialogTitle style={{ fontFamily: "Manrope" }}>
                            {chType === "category" ? t("serverSettings.createCategory") : t("channel.addChannel")}
                          </DialogTitle>
                        </DialogHeader>
                        <form onSubmit={createChannel} className="space-y-4 mt-2">
                          <div className="space-y-2">
                            <Label className="workspace-section-label">
                              {chType === "category" ? t("serverSettings.categoryName") : t("serverSettings.channelName")}
                            </Label>
                            <Input
                              value={chName}
                              onChange={(event) => setChName(event.target.value)}
                              placeholder={chType === "category" ? t("serverSettings.newCategoryPlaceholder") : t("serverSettings.createChannelPlaceholder")}
                              className="h-11 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus-visible:border-cyan-400/50 focus-visible:ring-cyan-400/40"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="workspace-section-label">{t("common.type")}</Label>
                            <Select value={chType} onValueChange={setChType}>
                              <SelectTrigger className="h-11 rounded-2xl border-white/10 bg-zinc-950/70 text-white focus:border-cyan-400/50 focus:ring-cyan-400/40">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="border-white/10 bg-zinc-900 text-white">
                                <SelectItem value="text">{t("serverSettings.channelTypeText")}</SelectItem>
                                <SelectItem value="voice">{t("serverSettings.channelTypeVoice")}</SelectItem>
                                <SelectItem value="category">{t("serverSettings.channelTypeCategory")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {chType !== "category" && (
                            <div className="space-y-2">
                              <Label className="workspace-section-label">{t("common.category")}</Label>
                              <Select value={chParentId} onValueChange={setChParentId}>
                                <SelectTrigger className="h-11 rounded-2xl border-white/10 bg-zinc-950/70 text-white focus:border-cyan-400/50 focus:ring-cyan-400/40">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="border-white/10 bg-zinc-900 text-white">
                                  <SelectItem value="__root__">{t("common.noCategory")}</SelectItem>
                                  {categories.map((category) => (
                                    <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          <Button type="submit" disabled={creating || !chName.trim()} className="w-full rounded-2xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300 font-semibold">
                            {creating ? t("server.creating") : t("common.create")}
                          </Button>
                        </form>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-52 border-[#27272A] bg-[#18181B] text-white">
                {capabilities.canManageChannels ? (
                  <>
                    <ContextMenuItem onClick={() => openCreateDialog("category", null)}>{t("serverSettings.createCategory")}</ContextMenuItem>
                    <ContextMenuItem onClick={() => openCreateDialog("text", null)}>{t("serverSettings.createTextChannel")}</ContextMenuItem>
                    <ContextMenuItem onClick={() => openCreateDialog("voice", null)}>{t("serverSettings.createVoiceChannel")}</ContextMenuItem>
                  </>
                ) : (
                  <ContextMenuItem disabled className="text-[#71717A] focus:text-[#71717A] focus:bg-transparent cursor-default">
                    {t("common.noActionsAvailable", { defaultValue: "No actions available" })}
                  </ContextMenuItem>
                )}
              </ContextMenuContent>
            </ContextMenu>

            <DragOverlay>
              {activeDragChannel ? (
                <div
                  className="flex items-center gap-2 rounded-md border border-[#6366F1] bg-[#18181B] px-3 py-2 text-sm text-white shadow-2xl"
                  style={{ transform: "translateY(-14px)" }}
                >
                  {activeDragChannel.type === "category" ? (
                    <Folder size={16} weight="bold" className="text-[#A5B4FC]" />
                  ) : activeDragChannel.type === "voice" ? (
                    <SpeakerHigh size={16} weight="bold" className="text-[#A5B4FC]" />
                  ) : activeDragChannel.is_private ? (
                    <Lock size={16} weight="bold" className="text-[#A5B4FC]" />
                  ) : (
                    <Hash size={16} weight="bold" className="text-[#A5B4FC]" />
                  )}
                  <span className="truncate">{activeDragChannel.name}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>

          {voiceChannel && (
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
                        onClick={() => openMediaStage(
                          entry.userId,
                          entry.participantName,
                          entry.source,
                          entry.trackRefId,
                        )}
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
                  onClick={toggleCamera}
                  data-testid="voice-camera-toggle"
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    cameraEnabled ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-white/5 text-[#A1A1AA] hover:text-white"
                  }`}
                >
                  <VideoCamera size={14} />
                  {cameraEnabled ? t("channel.cameraOn") : t("channel.camera")}
                </button>
                <button
                  onClick={toggleScreenShare}
                  data-testid="voice-screen-share-toggle"
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    screenShareEnabled ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-white/5 text-[#A1A1AA] hover:text-white"
                  }`}
                >
                  <MonitorPlay size={14} />
                  {screenShareEnabled ? t("channel.sharing") : t("channel.share")}
                </button>
                <button
                  onClick={leaveVoice}
                  data-testid="voice-disconnect"
                  className="px-3 py-1.5 rounded-md bg-[#EF4444]/20 text-[#EF4444] text-xs font-medium hover:bg-[#EF4444]/30 transition-colors"
                >
                  {t("channel.leave")}
                </button>
              </div>
            </div>
          )}

            <div className="flex items-center gap-3 px-3 py-3 border-t workspace-divider bg-zinc-950/55 shrink-0" data-testid="user-bar">
            <UserStatusPanel user={user} onUserUpdated={onUserUpdated} />
            <button
              className={`workspace-icon-button ${isMuted ? "border-red-500/30 bg-red-500/15 text-red-400" : ""}`}
              onClick={toggleMute}
              data-testid="user-bar-mute-toggle"
              title={isMuted ? t("channel.muted") : t("channel.mute")}
            >
              {isMuted ? <MicrophoneSlash size={16} weight="bold" /> : <Microphone size={16} weight="bold" />}
            </button>
            <button
              className={`workspace-icon-button ${isDeafened ? "border-red-500/30 bg-red-500/15 text-red-400" : ""}`}
              onClick={toggleDeafen}
              data-testid="user-bar-deafen-toggle"
              title={isDeafened ? t("channel.deafened") : t("channel.deafen")}
            >
              {isDeafened ? <SpeakerSlash size={16} weight="bold" /> : <SpeakerHigh size={16} weight="bold" />}
            </button>
            <button
              className="workspace-icon-button"
              onClick={() => setUserSettingsOpen(true)}
              data-testid="user-settings-button"
            >
              <GearSix size={16} weight="bold" />
            </button>
          </div>
        </div>
      </div>

      <ServerSettingsOverlay
        open={serverSettingsOpen}
        onClose={() => setServerSettingsOpen(false)}
        server={server}
        channels={channels}
        members={members}
        roles={roles}
        user={user}
        viewerContext={viewerContext}
        onRefreshServers={onRefreshServers}
      />
      <GlobalSettingsOverlay
        open={userSettingsOpen}
        onClose={() => setUserSettingsOpen(false)}
        user={user}
        voiceEngineRef={voiceEngineRef}
        channels={channels}
        onUserUpdated={onUserUpdated}
        onLogout={onLogout}
        pttDebug={pttDebug}
      />
      <Dialog open={screenShareDialogOpen} onOpenChange={setScreenShareDialogOpen}>
        <DialogContent className="workspace-panel-solid max-w-3xl text-white">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Manrope" }}>{t("channel.shareScreen")}</DialogTitle>
          </DialogHeader>
          {isDesktop ? (
            <div className="grid gap-5 lg:grid-cols-[1.35fr_minmax(0,0.9fr)]">
              <div className="space-y-4">
                <Tabs value={captureSourceType} onValueChange={setCaptureSourceType}>
                  <TabsList className="grid w-full grid-cols-2 rounded-2xl border border-white/10 bg-zinc-950/70 p-1 text-white">
                    <TabsTrigger value="display" className="rounded-xl data-[state=active]:bg-cyan-400 data-[state=active]:text-zinc-950">
                      {t("channel.shareEntireScreen")}
                    </TabsTrigger>
                    <TabsTrigger value="window" className="rounded-xl data-[state=active]:bg-cyan-400 data-[state=active]:text-zinc-950">
                      {t("channel.shareWindow")}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="workspace-card overflow-hidden border border-white/10 bg-zinc-950/70">
                  <ScrollArea className="h-[22rem]">
                    <div className="space-y-2 p-3">
                      {captureSourcesStatus === "loading" && (
                        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-400">
                          {t("channel.loadingCaptureSources")}
                        </div>
                      )}
                      {captureSourcesStatus === "ready" && filteredCaptureSources.length === 0 && (
                        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-400">
                          {t("channel.noCaptureSources")}
                        </div>
                      )}
                      {filteredCaptureSources.map((source) => {
                        const isSelected = source.id === selectedCaptureSourceId;
                        return (
                          <button
                            key={source.id}
                            type="button"
                            onClick={() => setSelectedCaptureSourceId(source.id)}
                            className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                              isSelected
                                ? "border-cyan-400/70 bg-cyan-400/12 shadow-[0_0_0_1px_rgba(34,211,238,0.28)]"
                                : "border-white/8 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="space-y-1">
                                <p className="text-sm font-semibold text-white">{source.label}</p>
                                <p className="text-xs text-zinc-400">
                                  {source.appName
                                    ? `${source.appName} · ${source.width} × ${source.height}`
                                    : `${source.width} × ${source.height}`}
                                </p>
                              </div>
                              {isSelected && (
                                <span className="rounded-full bg-cyan-400/15 px-2 py-1 text-[11px] font-medium text-cyan-200">
                                  {t("common.selected")}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="workspace-section-label">{t("channel.shareQuality")}</Label>
                  <select
                    value={screenShareQuality}
                    onChange={(event) => setScreenShareQuality(event.target.value)}
                    className="h-12 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                  >
                    {screenSharePresetOptions.map((preset) => (
                      <option key={preset.id} value={preset.id} className="bg-zinc-950 text-white">
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </div>

                {screenShareCapabilities.supportsSystemAudio && (
                  <div className="workspace-card space-y-3 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-white">{t("channel.shareSystemAudio")}</p>
                        <p className="text-xs text-zinc-400">
                          {t("channel.shareSystemAudioHelp")}
                        </p>
                      </div>
                      <Switch checked={screenShareAudio} onCheckedChange={setScreenShareAudio} />
                    </div>
                    {screenShareAudio && screenShareCapabilities.supportsAudioVolumeControl && (
                      <div className="space-y-2 pt-1 border-t border-white/5">
                        <div className="flex items-center justify-between text-xs text-zinc-400">
                          <span>{t("channel.shareAudioVolume", { defaultValue: "Audio-Lautstärke" })}</span>
                          <span>{screenShareAudioVolume}%</span>
                        </div>
                        <Slider
                          value={[screenShareAudioVolume]}
                          min={0}
                          max={200}
                          step={5}
                          onValueChange={([value]) => {
                            setScreenShareAudioVolume(value);
                            voiceEngineRef?.current?.setScreenShareAudioVolume?.(value);
                          }}
                          data-testid="screen-share-audio-volume-slider"
                        />
                      </div>
                    )}
                  </div>
                )}

                <div className="workspace-card space-y-2 px-4 py-3 text-xs text-zinc-400">
                  <p>{t("channel.nativeShareHint")}</p>
                  {screenShareEnabled && screenShareMeta.sourceLabel && (
                    <p className="text-cyan-200">
                      {t("channel.currentShareSource", { source: screenShareMeta.sourceLabel })}
                    </p>
                  )}
                </div>

                {screenShareEnabled && screenShareMeta.actualCaptureSettings && (
                  <div className="workspace-card px-4 py-3 text-xs text-zinc-400">
                    {`${Math.round(screenShareMeta.actualCaptureSettings.width || 0)} × ${Math.round(screenShareMeta.actualCaptureSettings.height || 0)} @ ${Math.round(screenShareMeta.actualCaptureSettings.frameRate || 0)} FPS`}
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setScreenShareDialogOpen(false)}
                    className="rounded-2xl border-white/10 bg-transparent text-white hover:bg-white/8"
                  >
                    {t("common.cancel")}
                  </Button>
                  {screenShareEnabled && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void stopScreenShareFromDialog()}
                      className="rounded-2xl border-red-400/30 bg-red-500/10 text-red-100 hover:bg-red-500/15"
                    >
                      {t("channel.stopSharing")}
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={() => void startScreenShare()}
                    className="rounded-2xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300"
                    disabled={captureSourcesStatus !== "ready" || !selectedCaptureSourceId}
                  >
                    {screenShareEnabled
                      ? t("channel.switchShareSource")
                      : t("channel.startSharing")}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
            <div className="space-y-2">
              <Label className="workspace-section-label">{t("channel.shareQuality")}</Label>
              <select
                value={screenShareQuality}
                onChange={(event) => setScreenShareQuality(event.target.value)}
                className="h-12 w-full rounded-2xl border border-white/10 bg-zinc-950/70 px-4 text-sm text-white outline-none transition focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
              >
                {screenSharePresetOptions.map((preset) => (
                  <option key={preset.id} value={preset.id} className="bg-zinc-950 text-white">
                    {preset.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label className="workspace-section-label">{t("channel.shareSurface")}</Label>
              <Select value={screenShareSurface} onValueChange={setScreenShareSurface}>
                <SelectTrigger className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="workspace-panel-solid border-white/10 text-white">
                  <SelectItem value="monitor">{t("channel.shareEntireScreen")}</SelectItem>
                  <SelectItem value="window">{t("channel.shareWindow")}</SelectItem>
                  <SelectItem value="browser">{t("channel.shareTab")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="workspace-card space-y-3 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{t("channel.shareSystemAudio")}</p>
                  <p className="text-xs text-[#71717A]">{t("channel.shareSystemAudioHelp")}</p>
                </div>
                <Switch checked={screenShareAudio} onCheckedChange={setScreenShareAudio} />
              </div>
              {/* Lautstärkeregler – nur sichtbar wenn Systemaudio aktiv */}
              {screenShareAudio && (
                <div className="space-y-2 pt-1 border-t border-white/5">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>{t("channel.shareAudioVolume", { defaultValue: "Audio-Lautstärke" })}</span>
                    <span>{screenShareAudioVolume}%</span>
                  </div>
                  <Slider
                    value={[screenShareAudioVolume]}
                    min={0}
                    max={200}
                    step={5}
                    onValueChange={([value]) => {
                      setScreenShareAudioVolume(value);
                      // Lautstärke sofort an den VoiceEngine weiterleiten
                      voiceEngineRef?.current?.setScreenShareAudioVolume?.(value);
                    }}
                    data-testid="screen-share-audio-volume-web"
                  />
                </div>
              )}
            </div>

            <div className="workspace-card px-4 py-3 text-xs text-[#71717A]">
              {t("channel.shareScreenPickerHint")}
            </div>

            {screenShareEnabled && screenShareMeta.actualCaptureSettings && (
              <div className="workspace-card px-4 py-3 text-xs text-zinc-400">
                {`${Math.round(screenShareMeta.actualCaptureSettings.width || 0)} × ${Math.round(screenShareMeta.actualCaptureSettings.height || 0)} @ ${Math.round(screenShareMeta.actualCaptureSettings.frameRate || 0)} FPS`}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setScreenShareDialogOpen(false)}
                className="rounded-2xl border-white/10 bg-transparent text-white hover:bg-white/8"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => void startScreenShare()}
                className="rounded-2xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300"
              >
                {t("channel.startSharing")}
              </Button>
            </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <VoiceMediaStage
        open={stageState.open}
        onClose={() => setStageState({
          open: false,
          trackRefId: null,
          participantId: null,
          participantName: "",
          source: null,
        })}
        voiceEngineRef={voiceEngineRef}
        trackRefId={stageState.trackRefId}
        participantId={stageState.participantId}
        participantName={stageState.participantName}
        source={stageState.source}
        mediaRevision={mediaStageRevision}
      />
    </>
  );
}
