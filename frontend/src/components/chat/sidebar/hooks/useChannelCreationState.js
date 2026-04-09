/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { ROOT_PARENT_ID } from "../channelSidebarUtils";

export function useChannelCreationState({
  serverId,
  categories,
  onRefreshChannels,
  t,
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelType, setChannelType] = useState("text");
  const [parentId, setParentId] = useState(ROOT_PARENT_ID);
  const [creating, setCreating] = useState(false);

  const openCreateDialog = useCallback((type = "text", nextParentId = null) => {
    setChannelType(type);
    setParentId(nextParentId || ROOT_PARENT_ID);
    setChannelName("");
    setShowCreate(true);
  }, []);

  const openCreateDialogFromButton = useCallback(() => {
    setShowCreate(true);
  }, []);

  const createChannel = useCallback(async (event) => {
    event.preventDefault();
    if (!channelName.trim()) {
      return;
    }

    setCreating(true);
    try {
      await api.post(`/servers/${serverId}/channels`, {
        name: channelName.trim(),
        type: channelType,
        parent_id: channelType === "category"
          ? null
          : (parentId === ROOT_PARENT_ID ? null : parentId),
      });
      toast.success(
        channelType === "category"
          ? t("serverSettings.categoryCreated")
          : t("serverSettings.channelCreated"),
      );
      setShowCreate(false);
      setChannelName("");
      onRefreshChannels?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelCreateFailed" }));
    } finally {
      setCreating(false);
    }
  }, [channelName, channelType, onRefreshChannels, parentId, serverId, t]);

  return {
    categories,
    createButtonLabel: channelType === "category"
      ? t("channel.addCategory")
      : t("channel.addChannel"),
    createDialogProps: {
      open: showCreate,
      onOpenChange: setShowCreate,
      channelName,
      channelType,
      parentId,
      categories,
      creating,
      onChannelNameChange: setChannelName,
      onChannelTypeChange: setChannelType,
      onParentIdChange: setParentId,
      onSubmit: createChannel,
      t,
    },
    openCreateDialog,
    openCreateDialogFromButton,
  };
}
