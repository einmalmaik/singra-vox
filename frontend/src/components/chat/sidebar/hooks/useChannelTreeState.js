/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback, useMemo, useState } from "react";
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
import { buildServerCapabilities } from "@/lib/serverPermissions";
import {
  buildChannelOrganization,
  computeChannelReorderPayload,
  parseContainerDropId,
  ROOT_CHANNEL_CONTAINER_ID,
} from "@/lib/channelOrganization";
import { buildChannelParticipantEntries } from "../channelSidebarUtils";

export function useChannelTreeState({
  server,
  channels,
  currentChannel,
  onSelectChannel,
  onRefreshChannels,
  user,
  viewerContext,
  unreadMap,
  localVoicePreferences,
  isDeafened,
  voiceActivity,
  mediaParticipants,
  cameraEnabled,
  screenShareEnabled,
  updateLocalPreferences,
  joinVoice,
  openMediaStage,
  openCreateDialog,
  openCreateDialogFromButton,
  onOpenServerSettings,
  t,
}) {
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [activeDragId, setActiveDragId] = useState(null);

  const capabilities = useMemo(
    () => buildServerCapabilities({ user, server, viewerContext }),
    [server, user, viewerContext],
  );
  const channelOrganization = useMemo(
    () => buildChannelOrganization(channels),
    [channels],
  );
  const categories = useMemo(
    () => channelOrganization.topLevelItems.filter((channel) => channel.type === "category"),
    [channelOrganization],
  );
  const mediaByUserId = useMemo(
    () => new Map(mediaParticipants.map((participant) => [participant.userId, participant])),
    [mediaParticipants],
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

  const activeDragChannel = activeDragId ? channelOrganization.byId[activeDragId] : null;
  const isDraggingChannel = Boolean(activeDragChannel);
  const canDropIntoCategory = activeDragChannel?.type && activeDragChannel.type !== "category";

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
    categories,
    treeProps: {
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
      onOpenServerSettings,
      onActivateChannel: handleActivateChannel,
      t,
    },
  };
}
