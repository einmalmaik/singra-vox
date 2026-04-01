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
  SignOut,
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
import api, { formatError } from "@/lib/api";
import { useRuntime } from "@/contexts/RuntimeContext";
import { useE2EE } from "@/contexts/E2EEContext";
import { loadVoicePreferences, saveVoicePreferences, subscribeVoicePreferences } from "@/lib/voicePreferences";
import { buildWorkspaceCapabilities } from "@/lib/workspacePermissions";
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

const SCREEN_SHARE_PRESETS = {
  "480p30": { width: 854, height: 480, frameRate: 30 },
  "720p30": { width: 1280, height: 720, frameRate: 30 },
  "1080p60": { width: 1920, height: 1080, frameRate: 60 },
};

export default function ChannelSidebar({
  server,
  channels,
  currentChannel,
  onSelectChannel,
  onRefreshChannels,
  user,
  members,
  roles,
  unreadMap,
  voiceEngineRef,
  onLogout,
  onUserUpdated,
  onRefreshServers,
}) {
  const { t } = useTranslation();
  const { config } = useRuntime();
  const { ready: e2eeReady, isDesktopCapable } = useE2EE();
  const isDesktop = Boolean(config?.isDesktop);
  const [showCreate, setShowCreate] = useState(false);
  const [chName, setChName] = useState("");
  const [chType, setChType] = useState("text");
  const [chParentId, setChParentId] = useState("__root__");
  const [creating, setCreating] = useState(false);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [screenShareDialogOpen, setScreenShareDialogOpen] = useState(false);
  const [screenShareQuality, setScreenShareQuality] = useState("1080p60");
  const [screenShareAudio, setScreenShareAudio] = useState(true);
  const [screenShareSurface, setScreenShareSurface] = useState("monitor");
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
  const [stageState, setStageState] = useState({
    open: false,
    participantId: null,
    participantName: "",
    source: null,
  });
  const [localVoicePreferences, setLocalVoicePreferences] = useState(
    loadVoicePreferences(user?.id, { isDesktop }),
  );
  const capabilities = buildWorkspaceCapabilities({ user, server, members, roles });
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
  const mediaByUserId = useMemo(
    () => new Map(mediaParticipants.map((participant) => [participant.userId, participant])),
    [mediaParticipants],
  );
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

  const bindVoiceEngine = useCallback((engine) => {
    const handleEvent = (event) => {
      if (event.type === "mute_change") setIsMuted(Boolean(event.isMuted));
      if (event.type === "deafen_change") setIsDeafened(Boolean(event.isDeafened));
      if (event.type === "camera_change") setCameraEnabled(Boolean(event.enabled));
      if (event.type === "screen_share_change") setScreenShareEnabled(Boolean(event.enabled));
      if (event.type === "media_tracks_update") {
        setMediaParticipants(event.participants || []);
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
        setMediaParticipants([]);
      }
    };

    engine.onStateChange = handleEvent;
    return engine.addStateListener(handleEvent);
  }, []);

  useEffect(() => {
    if (!voiceChannel || !user?.id) return;
    const nextChannel = channels.find((channel) => channel.id === voiceChannel.id);
    const selfState = nextChannel?.voice_states?.find((state) => state.user_id === user.id);
    if (!nextChannel || !selfState) {
      setVoiceChannel(null);
      setIsMuted(false);
      setIsDeafened(false);
      setCameraEnabled(false);
      setScreenShareEnabled(false);
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
  }, [channels, user?.id, voiceChannel, voiceEngineRef]);

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
          toast.error(formatError(error?.response?.data?.detail || "Encrypted media keys could not be rotated."));
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
  }, [currentVoiceParticipantIds, voiceChannel?.id, voiceChannel?.is_private, voiceEngineRef]);

  useEffect(() => {
    if (!stageState.open || !stageState.participantId || !stageState.source) {
      return;
    }

    const participantMedia = stageState.participantId === user?.id
      ? {
          hasCamera: cameraEnabled,
          hasScreenShare: screenShareEnabled,
        }
      : mediaByUserId.get(stageState.participantId);

    const stillAvailable = stageState.source === "screen_share"
      ? Boolean(participantMedia?.hasScreenShare)
      : Boolean(participantMedia?.hasCamera);

    if (!stillAvailable) {
      setStageState({
        open: false,
        participantId: null,
        participantName: "",
        source: null,
      });
    }
  }, [cameraEnabled, mediaByUserId, screenShareEnabled, stageState, user?.id]);

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
      toast.error(formatError(error.response?.data?.detail));
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
      toast.error(formatError(error.response?.data?.detail));
    }
  }, [channels, syncChannelOrder, t]);

  const joinVoice = useCallback(async (channel) => {
    try {
      if (voiceChannel?.id === channel.id) return;
      if (channel.is_private && !isDesktopCapable) {
        toast.error("Encrypted voice channels are only available in the desktop app.");
        return;
      }
      if (channel.is_private && !e2eeReady) {
        toast.error("Restore or verify this desktop device before joining encrypted voice channels.");
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

      await api.post(`/servers/${server.id}/voice/${channel.id}/join`);
      await engine.joinChannel();
      setVoiceChannel(channel);
      setIsMuted(false);
      setIsDeafened(false);
      setCameraEnabled(false);
      setScreenShareEnabled(false);
      onRefreshChannels?.();
      toast.success(t("channel.voiceConnected"));
    } catch (error) {
      console.error("Voice join error:", error);
      toast.error(formatError(error?.response?.data?.detail || t("channel.joinVoiceFailed")));
    }
  }, [bindVoiceEngine, config, e2eeReady, isDesktop, isDesktopCapable, onRefreshChannels, server?.id, t, user?.id, voiceChannel?.id, voiceEngineRef]);

  const leaveVoice = useCallback(async () => {
    if (!voiceChannel) return;
    try {
      if (voiceEngineRef?.current) {
        await voiceEngineRef.current.disconnect();
        voiceEngineRef.current = null;
      }
      await api.post(`/servers/${server.id}/voice/${voiceChannel.id}/leave`);
      setVoiceChannel(null);
      setIsMuted(false);
      setIsDeafened(false);
      setCameraEnabled(false);
      setScreenShareEnabled(false);
      setMediaParticipants([]);
      setStageState({ open: false, participantId: null, participantName: "", source: null });
      onRefreshChannels?.();
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail || t("channel.leaveVoiceFailed")));
    }
  }, [onRefreshChannels, server?.id, t, voiceChannel, voiceEngineRef]);

  const toggleMute = async () => {
    if (!voiceChannel) return;
    const engine = voiceEngineRef?.current;
    const nextMuted = engine ? engine.setMuted(!isMuted) : !isMuted;
    setIsMuted(nextMuted);
    try {
      const response = await api.put(`/servers/${server.id}/voice/${voiceChannel.id}/state`, { is_muted: nextMuted });
      const persistedMuted = Boolean(response?.data?.is_muted ?? nextMuted);
      engine?.setMuted(persistedMuted);
      setIsMuted(persistedMuted);
      onRefreshChannels?.();
    } catch (error) {
      engine?.setMuted(!nextMuted);
      setIsMuted(!nextMuted);
      toast.error(formatError(error.response?.data?.detail || t("channel.muteUpdateFailed")));
    }
  };

  const toggleDeafen = async () => {
    if (!voiceChannel) return;
    const engine = voiceEngineRef?.current;
    const nextDeafened = engine ? engine.setDeafened(!isDeafened) : !isDeafened;
    setIsDeafened(nextDeafened);
    try {
      const response = await api.put(`/servers/${server.id}/voice/${voiceChannel.id}/state`, { is_deafened: nextDeafened });
      const persistedDeafened = Boolean(response?.data?.is_deafened ?? nextDeafened);
      engine?.setDeafened(persistedDeafened);
      setIsDeafened(persistedDeafened);
      onRefreshChannels?.();
    } catch (error) {
      engine?.setDeafened(!nextDeafened);
      setIsDeafened(!nextDeafened);
      toast.error(formatError(error.response?.data?.detail || t("channel.deafenUpdateFailed")));
    }
  };

  const toggleCamera = async () => {
    if (!voiceChannel || !voiceEngineRef?.current) return;
    try {
      const enabled = await voiceEngineRef.current.toggleCamera();
      setCameraEnabled(Boolean(enabled));
    } catch (error) {
      toast.error(formatError(error?.message || "Camera could not be toggled."));
    }
  };

  const toggleScreenShare = async () => {
    if (!voiceChannel || !voiceEngineRef?.current) return;
    if (!screenShareEnabled) {
      setScreenShareDialogOpen(true);
      return;
    }
    try {
      const enabled = await voiceEngineRef.current.toggleScreenShare();
      setScreenShareEnabled(Boolean(enabled));
    } catch (error) {
      toast.error(formatError(error?.message || "Screen sharing could not be toggled."));
    }
  };

  const startScreenShare = async () => {
    if (!voiceChannel || !voiceEngineRef?.current) return;
    try {
      const enabled = await voiceEngineRef.current.startScreenShare({
        audio: screenShareAudio,
        displaySurface: screenShareSurface,
        resolution: SCREEN_SHARE_PRESETS[screenShareQuality] || SCREEN_SHARE_PRESETS["1080p60"],
      });
      setScreenShareEnabled(Boolean(enabled));
      setScreenShareDialogOpen(false);
    } catch (error) {
      toast.error(formatError(error?.message || "Screen sharing could not be started."));
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
      toast.error(formatError(error.response?.data?.detail || t("serverSettings.memberActionGenericFailed")));
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
      toast.error(formatError(error.response?.data?.detail));
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
      toast.error(formatError(error.response?.data?.detail));
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
      toast.error(formatError(error.response?.data?.detail));
    }
  }, [channels, syncChannelOrder, t]);

  const openMediaStage = useCallback((participantId, participantName, source) => {
    setStageState({
      open: true,
      participantId,
      participantName,
      source,
    });
  }, []);

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
                className={`channel-item w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm touch-none ${
                  currentChannel?.id === channel.id
                    ? "active text-white"
                    : hasMentionUnread
                      ? "bg-[#2A1616] text-white font-semibold"
                      : hasUnread
                        ? "text-white font-semibold"
                        : "text-[#A1A1AA]"
                } ${isOver ? "ring-1 ring-[#6366F1] bg-[#18181B]" : ""} ${isDragging ? "opacity-60" : ""}`}
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
        {capabilities.canManageChannels && (
          <ContextMenuContent className="w-52 border-[#27272A] bg-[#18181B] text-white">
            {channel.type === "category" ? (
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
            )}
          </ContextMenuContent>
        )}
      </ContextMenu>
    );
  };

  const renderCategoryBlock = (category) => {
    const collapsed = Boolean(collapsedCategories[category.id]);
    const childIds = channelOrganization.childIdsByCategory[category.id] || [];

    return (
      <div key={category.id} className="rounded-lg border border-[#202027] bg-[#101114]/70 px-1 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
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
      <div className="pl-8 space-y-0.5">
        {channel.voice_states.map((voiceState) => {
          const participantId = voiceState.user_id;
          const locallyMuted = Boolean(localVoicePreferences.locallyMutedParticipants?.[participantId]);
          const participantVolume = localVoicePreferences.perUserVolumes?.[participantId] ?? 100;
          const speaking = participantId === user?.id
            ? voiceActivity.localSpeaking
            : voiceActivity.activeSpeakerIds.includes(participantId);
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
                <button className="w-full flex items-center gap-2 py-1 text-xs text-[#A1A1AA] hover:text-white text-left">
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
      <div className="w-[300px] h-full min-h-0 bg-[#121212] border-r border-[#27272A]/40 flex flex-col shrink-0" data-testid="channel-sidebar">
        <div className="h-12 flex items-center justify-between px-4 border-b border-[#27272A] shrink-0">
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <h3 className="text-sm font-bold text-white truncate" style={{ fontFamily: "Manrope" }} data-testid="server-name-header">
                {server?.name}
              </h3>
            </ContextMenuTrigger>
            {capabilities.canManageChannels && (
              <ContextMenuContent className="w-52 border-[#27272A] bg-[#18181B] text-white">
                <ContextMenuItem onClick={() => openCreateDialog("category", null)}>{t("serverSettings.createCategory")}</ContextMenuItem>
                <ContextMenuItem onClick={() => openCreateDialog("text", null)}>{t("serverSettings.createTextChannel")}</ContextMenuItem>
                <ContextMenuItem onClick={() => openCreateDialog("voice", null)}>{t("serverSettings.createVoiceChannel")}</ContextMenuItem>
              </ContextMenuContent>
            )}
          </ContextMenu>
          {capabilities.canOpenServerSettings && (
            <button
              className="rounded p-1 text-[#71717A] transition-colors hover:bg-[#27272A] hover:text-white"
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
                <div className="flex-1 min-h-0 overflow-y-auto py-2 px-2">
                  <div className="space-y-2">
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
                            className={`rounded-md border border-dashed px-3 py-2 text-[11px] transition-colors ${
                              isOver
                                ? "border-[#6366F1] bg-[#18181B] text-[#A5B4FC]"
                                : "border-[#27272A] bg-[#111113] text-[#71717A]"
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
                          className="flex items-center gap-2 px-2 py-1.5 mt-2 text-[#71717A] hover:text-[#A1A1AA] text-sm w-full rounded-md hover:bg-[#27272A]/30 transition-colors"
                        >
                          <Plus size={14} weight="bold" />
                          <span>{chType === "category" ? t("channel.addCategory") : t("channel.addChannel")}</span>
                        </button>
                      </DialogTrigger>
                      <DialogContent className="bg-[#18181B] border-[#27272A] text-white max-w-sm">
                        <DialogHeader>
                          <DialogTitle style={{ fontFamily: "Manrope" }}>
                            {chType === "category" ? t("serverSettings.createCategory") : t("channel.addChannel")}
                          </DialogTitle>
                        </DialogHeader>
                        <form onSubmit={createChannel} className="space-y-4 mt-2">
                          <div className="space-y-2">
                            <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">
                              {chType === "category" ? t("serverSettings.categoryName") : t("serverSettings.channelName")}
                            </Label>
                            <Input
                              value={chName}
                              onChange={(event) => setChName(event.target.value)}
                              placeholder={chType === "category" ? t("serverSettings.newCategoryPlaceholder") : t("serverSettings.createChannelPlaceholder")}
                              className="bg-[#121212] border-[#27272A] focus:border-[#6366F1] text-white"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("common.type")}</Label>
                            <Select value={chType} onValueChange={setChType}>
                              <SelectTrigger className="bg-[#121212] border-[#27272A] text-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-[#18181B] border-[#27272A] text-white">
                                <SelectItem value="text">{t("serverSettings.channelTypeText")}</SelectItem>
                                <SelectItem value="voice">{t("serverSettings.channelTypeVoice")}</SelectItem>
                                <SelectItem value="category">{t("serverSettings.channelTypeCategory")}</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {chType !== "category" && (
                            <div className="space-y-2">
                              <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("common.category")}</Label>
                              <Select value={chParentId} onValueChange={setChParentId}>
                                <SelectTrigger className="bg-[#121212] border-[#27272A] text-white">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-[#18181B] border-[#27272A] text-white">
                                  <SelectItem value="__root__">{t("common.noCategory")}</SelectItem>
                                  {categories.map((category) => (
                                    <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          <Button type="submit" disabled={creating || !chName.trim()} className="w-full bg-[#6366F1] hover:bg-[#4F46E5]">
                            {creating ? t("server.creating") : t("common.create")}
                          </Button>
                        </form>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </ContextMenuTrigger>
              {capabilities.canManageChannels && (
                <ContextMenuContent className="w-52 border-[#27272A] bg-[#18181B] text-white">
                  <ContextMenuItem onClick={() => openCreateDialog("category", null)}>{t("serverSettings.createCategory")}</ContextMenuItem>
                  <ContextMenuItem onClick={() => openCreateDialog("text", null)}>{t("serverSettings.createTextChannel")}</ContextMenuItem>
                  <ContextMenuItem onClick={() => openCreateDialog("voice", null)}>{t("serverSettings.createVoiceChannel")}</ContextMenuItem>
                </ContextMenuContent>
              )}
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
            <div className="border-t border-[#27272A] p-3 bg-[#0A0A0A]" data-testid="voice-controls">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full bg-[#22C55E] ${voiceActivity.localSpeaking ? "voice-active" : ""}`} />
                <span className="text-xs text-[#22C55E] font-medium">
                  {voiceActivity.localSpeaking ? t("channel.speaking") : t("channel.voiceConnected")}
                </span>
              </div>
              <p className="text-xs text-[#71717A] mb-2 truncate">{voiceChannel.name}</p>
              <div className="flex gap-2">
                <button
                  onClick={toggleMute}
                  data-testid="voice-mute-toggle"
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    isMuted ? "bg-[#EF4444]/20 text-[#EF4444]" : "bg-[#27272A] text-[#A1A1AA] hover:text-white"
                  }`}
                >
                  {isMuted ? <MicrophoneSlash size={14} /> : <Microphone size={14} />}
                  {isMuted ? t("channel.muted") : t("channel.mute")}
                </button>
                <button
                  onClick={toggleDeafen}
                  data-testid="voice-deafen-toggle"
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    isDeafened ? "bg-[#EF4444]/20 text-[#EF4444]" : "bg-[#27272A] text-[#A1A1AA] hover:text-white"
                  }`}
                >
                  {isDeafened ? <SpeakerSlash size={14} /> : <SpeakerHigh size={14} />}
                  {isDeafened ? t("channel.deafened") : t("channel.deafen")}
                </button>
                <button
                  onClick={toggleCamera}
                  data-testid="voice-camera-toggle"
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    cameraEnabled ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#27272A] text-[#A1A1AA] hover:text-white"
                  }`}
                >
                  <VideoCamera size={14} />
                  {cameraEnabled ? t("channel.cameraOn") : t("channel.camera")}
                </button>
                <button
                  onClick={toggleScreenShare}
                  data-testid="voice-screen-share-toggle"
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    screenShareEnabled ? "bg-[#22C55E]/20 text-[#22C55E]" : "bg-[#27272A] text-[#A1A1AA] hover:text-white"
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

          <div className="flex items-center gap-3 px-3 py-2 border-t border-[#27272A] bg-[#0A0A0A] shrink-0" data-testid="user-bar">
            <div className="relative">
              <div className="w-9 h-9 rounded-full bg-[#6366F1] flex items-center justify-center text-white text-sm font-bold">
                {user?.display_name?.[0]?.toUpperCase() || "?"}
              </div>
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0A0A0A] bg-[#22C55E]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{user?.display_name}</p>
              <p className="text-[10px] text-[#71717A] truncate">@{user?.username}</p>
            </div>
            <button
              className="rounded p-2 text-[#71717A] transition-colors hover:bg-[#27272A] hover:text-white"
              onClick={() => setUserSettingsOpen(true)}
              data-testid="user-settings-button"
            >
              <GearSix size={16} weight="bold" />
            </button>
            <button
              className="rounded p-2 text-[#71717A] transition-colors hover:bg-[#27272A] hover:text-[#EF4444]"
              onClick={onLogout}
              data-testid="channel-sidebar-logout"
            >
              <SignOut size={16} weight="bold" />
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
        <DialogContent className="max-w-lg border-[#27272A] bg-[#18181B] text-white">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Manrope" }}>{t("channel.shareScreen")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("channel.shareQuality")}</Label>
              <Select value={screenShareQuality} onValueChange={setScreenShareQuality}>
                <SelectTrigger className="bg-[#121212] border-[#27272A] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#18181B] border-[#27272A] text-white">
                  <SelectItem value="480p30">480p / 30 FPS</SelectItem>
                  <SelectItem value="720p30">720p / 30 FPS</SelectItem>
                  <SelectItem value="1080p60">1080p / 60 FPS</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("channel.shareSurface")}</Label>
              <Select value={screenShareSurface} onValueChange={setScreenShareSurface}>
                <SelectTrigger className="bg-[#121212] border-[#27272A] text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#18181B] border-[#27272A] text-white">
                  <SelectItem value="monitor">{t("channel.shareEntireScreen")}</SelectItem>
                  <SelectItem value="window">{t("channel.shareWindow")}</SelectItem>
                  <SelectItem value="browser">{t("channel.shareTab")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-[#27272A] bg-[#121212] px-4 py-3">
              <div>
                <p className="text-sm font-medium text-white">{t("channel.shareSystemAudio")}</p>
                <p className="text-xs text-[#71717A]">{t("channel.shareSystemAudioHelp")}</p>
              </div>
              <Switch checked={screenShareAudio} onCheckedChange={setScreenShareAudio} />
            </div>

            <div className="rounded-lg border border-[#27272A] bg-[#121212] px-4 py-3 text-xs text-[#71717A]">
              {t("channel.shareScreenPickerHint")}
            </div>

            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setScreenShareDialogOpen(false)}
                className="border-[#27272A] bg-transparent text-white hover:bg-[#121212]"
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                onClick={() => void startScreenShare()}
                className="bg-[#6366F1] hover:bg-[#4F46E5]"
              >
                {t("channel.startSharing")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <VoiceMediaStage
        open={stageState.open}
        onClose={() => setStageState({ open: false, participantId: null, participantName: "", source: null })}
        voiceEngineRef={voiceEngineRef}
        participantId={stageState.participantId}
        participantName={stageState.participantName}
        source={stageState.source}
      />
    </>
  );
}
