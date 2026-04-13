/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useEffect, useMemo, useState } from "react";
import { useRuntime } from "@/contexts/RuntimeContext";
import { useE2EE } from "@/contexts/E2EEContext";
import { getScreenShareCapabilities } from "@/lib/screenShareCapabilities";
import { useChannelCreationState } from "./hooks/useChannelCreationState";
import { useChannelTreeState } from "./hooks/useChannelTreeState";
import { useMediaStageState } from "./hooks/useMediaStageState";
import { useScreenShareDialogState } from "./hooks/useScreenShareDialogState";
import { useVoiceChannelState } from "./hooks/useVoiceChannelState";

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
  const useNativeScreenShare = Boolean(
    isDesktop && screenShareCapabilities.supportsNativeCapture,
  );
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);

  const voiceState = useVoiceChannelState({
    serverId: server?.id,
    channels,
    user,
    config,
    isDesktop,
    e2eeReady,
    voiceEngineRef,
    onRefreshChannels,
    t,
  });
  const mediaStageState = useMediaStageState({
    videoTrackRefs: voiceState.videoTrackRefs,
    members,
    user,
    t,
  });
  const channelTreeState = useChannelTreeState({
    server,
    channels,
    currentChannel,
    onSelectChannel,
    onRefreshChannels,
    user,
    viewerContext,
    unreadMap,
    localVoicePreferences: voiceState.localVoicePreferences,
    isDeafened: voiceState.isDeafened,
    voiceActivity: voiceState.voiceActivity,
    mediaParticipants: voiceState.mediaParticipants,
    cameraEnabled: voiceState.cameraEnabled,
    screenShareEnabled: voiceState.screenShareEnabled,
    updateLocalPreferences: voiceState.updateLocalPreferences,
    joinVoice: voiceState.joinVoice,
    openMediaStage: mediaStageState.openMediaStage,
    openCreateDialog: () => {},
    openCreateDialogFromButton: () => {},
    onOpenServerSettings: () => setServerSettingsOpen(true),
    t,
  });
  const channelCreationState = useChannelCreationState({
    serverId: server?.id,
    categories: channelTreeState.categories,
    onRefreshChannels,
    t,
  });
  const screenShareState = useScreenShareDialogState({
    isDesktop,
    useNativeScreenShare,
    screenShareCapabilities,
    voiceChannel: voiceState.voiceChannel,
    voiceEngineRef,
    screenShareEnabled: voiceState.screenShareEnabled,
    screenShareMeta: voiceState.screenShareMeta,
    t,
  });

  const channelTreeProps = useMemo(() => ({
    ...channelTreeState.treeProps,
    onOpenCreateDialog: channelCreationState.openCreateDialog,
    onOpenCreateDialogButton: channelCreationState.openCreateDialogFromButton,
    createButtonLabel: channelCreationState.createButtonLabel,
  }), [channelCreationState.createButtonLabel, channelCreationState.openCreateDialog, channelCreationState.openCreateDialogFromButton, channelTreeState.treeProps]);

  useEffect(() => {
    if (serverSettingsRequest?.serverId && serverSettingsRequest.serverId === server?.id) {
      setServerSettingsOpen(true);
    }
  }, [server?.id, serverSettingsRequest]);

  return {
    layout: {
      header: {
        serverName: server?.name,
        canManageChannels: Boolean(channelTreeProps.capabilities?.canManageChannels),
        canOpenServerSettings: Boolean(channelTreeProps.capabilities?.canOpenServerSettings),
        onOpenCreateDialog: channelCreationState.openCreateDialog,
        onOpenServerSettings: () => setServerSettingsOpen(true),
        t,
      },
    },
    channelTree: channelTreeProps,
    voiceDock: {
      voiceChannel: voiceState.voiceChannel,
      voiceActivity: voiceState.voiceActivity,
      liveMediaEntries: mediaStageState.liveMediaEntries,
      cameraEnabled: voiceState.cameraEnabled,
      screenShareEnabled: voiceState.screenShareEnabled,
      onToggleCamera: () => void voiceState.toggleCamera(),
      onToggleScreenShare: () => void screenShareState.toggleScreenShareFromDock(),
      onLeaveVoice: () => void voiceState.leaveVoice(),
      onOpenMediaStage: mediaStageState.openMediaStage,
      t,
    },
    dialogs: {
      createChannel: channelCreationState.createDialogProps,
      screenShare: screenShareState.dialogProps,
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
        pttDebug: voiceState.pttDebug,
      },
      mediaStage: {
        ...mediaStageState.stageDialogProps,
        voiceEngineRef,
      },
    },
    userBar: {
      user,
      onUserUpdated,
      isMuted: voiceState.isMuted,
      isDeafened: voiceState.isDeafened,
      onToggleMute: () => void voiceState.toggleMute(),
      onToggleDeafen: () => void voiceState.toggleDeafen(),
      onOpenSettings: () => setUserSettingsOpen(true),
      t,
    },
  };
}
