/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { getCachedChannelMessages, setCachedChannelMessages } from "@/lib/chatPersistence";
import { fetchMessageHistoryPage, fetchMessageHistoryWindow, mergeTimelineMessages } from "@/lib/messageHistory";

function clearChannelTimelineState(setters, latestChannelLoadRef) {
  latestChannelLoadRef.current += 1;
  setters.setMessages([]);
  setters.setChannelHistoryCursor(null);
  setters.setChannelHasOlderMessages(false);
}

/**
 * Owns the server/channel/member workspace state. It exposes stable actions and
 * refs so higher-level controllers can coordinate routing, sockets and UI state
 * without a monolithic page component.
 */
export function useServerWorkspaceState({ userId, navigate, t }) {
  const currentServerRef = useRef(null);
  const currentChannelRef = useRef(null);
  const latestChannelLoadRef = useRef(0);
  const [servers, setServers] = useState([]);
  const [currentServer, setCurrentServer] = useState(null);
  const [channels, setChannels] = useState([]);
  const [currentChannel, setCurrentChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [channelHistoryCursor, setChannelHistoryCursor] = useState(null);
  const [channelHasOlderMessages, setChannelHasOlderMessages] = useState(false);
  const [loadingOlderChannelMessages, setLoadingOlderChannelMessages] = useState(false);
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [viewerContext, setViewerContext] = useState(null);
  const [serverSettingsRequest, setServerSettingsRequest] = useState(null);

  useEffect(() => {
    currentServerRef.current = currentServer;
  }, [currentServer]);

  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  useEffect(() => {
    if (!userId || currentChannel?.type !== "text") {
      return;
    }
    setCachedChannelMessages(userId, currentChannel.id, messages);
  }, [currentChannel?.id, currentChannel?.type, messages, userId]);

  const clearChannelTimeline = useCallback(() => {
    clearChannelTimelineState({
      setMessages,
      setChannelHistoryCursor,
      setChannelHasOlderMessages,
    }, latestChannelLoadRef);
  }, []);

  const loadChannelMessages = useCallback(async (channelId) => {
    if (!channelId) {
      clearChannelTimeline();
      return;
    }

    // Quick channel switches can leave older requests resolving after the user
    // already moved elsewhere. The request token keeps stale responses from
    // blanking or replacing the current timeline.
    const requestId = latestChannelLoadRef.current + 1;
    latestChannelLoadRef.current = requestId;
    const cachedMessages = getCachedChannelMessages(userId, channelId);
    if (cachedMessages.length > 0) {
      setMessages(cachedMessages);
    }
    setChannelHistoryCursor(null);
    setChannelHasOlderMessages(false);

    try {
      const history = await fetchMessageHistoryWindow(`/channels/${channelId}/messages`);
      if (latestChannelLoadRef.current !== requestId) {
        return;
      }
      setMessages(mergeTimelineMessages(cachedMessages, history.messages));
      setChannelHistoryCursor(history.nextBefore);
      setChannelHasOlderMessages(history.hasMoreBefore);
    } catch {
      if (latestChannelLoadRef.current !== requestId) {
        return;
      }
      setMessages(cachedMessages);
      setChannelHistoryCursor(null);
      setChannelHasOlderMessages(false);
    }
  }, [clearChannelTimeline, userId]);

  const loadOlderChannelMessages = useCallback(async () => {
    if (!currentChannelRef.current?.id || !channelHasOlderMessages || loadingOlderChannelMessages) {
      return;
    }

    setLoadingOlderChannelMessages(true);
    try {
      const envelope = await fetchMessageHistoryPage(`/channels/${currentChannelRef.current.id}/messages`, {
        before: channelHistoryCursor,
      });
      setMessages((previous) => mergeTimelineMessages(envelope.messages, previous));
      setChannelHistoryCursor(envelope.nextBefore);
      setChannelHasOlderMessages(envelope.hasMoreBefore);
    } finally {
      setLoadingOlderChannelMessages(false);
    }
  }, [channelHasOlderMessages, channelHistoryCursor, loadingOlderChannelMessages]);

  const loadServerSnapshot = useCallback(async (serverId, options = {}) => {
    const { preferredChannelId = null } = options;
    const [channelResponse, memberResponse, roleResponse, viewerContextResponse] = await Promise.all([
      api.get(`/servers/${serverId}/channels`),
      api.get(`/servers/${serverId}/members`),
      api.get(`/servers/${serverId}/roles`),
      api.get(`/servers/${serverId}/viewer-context`),
    ]);

    setChannels(channelResponse.data);
    setMembers(memberResponse.data);
    setRoles(roleResponse.data);
    setViewerContext(viewerContextResponse.data || null);

    const nextChannel = (
      currentChannelRef.current && channelResponse.data.some((channel) => channel.id === currentChannelRef.current.id)
        ? channelResponse.data.find((channel) => channel.id === currentChannelRef.current.id) || currentChannelRef.current
        : preferredChannelId && channelResponse.data.some((channel) => channel.id === preferredChannelId)
          ? channelResponse.data.find((channel) => channel.id === preferredChannelId) || null
          : channelResponse.data.find((channel) => channel.type === "text") || null
    );

    currentChannelRef.current = nextChannel;
    setCurrentChannel(nextChannel);

    if (nextChannel?.type === "text") {
      await loadChannelMessages(nextChannel.id);
      return nextChannel;
    }

    clearChannelTimeline();
    return nextChannel;
  }, [clearChannelTimeline, loadChannelMessages]);

  const selectChannel = useCallback(async (channel) => {
    currentChannelRef.current = channel;
    setCurrentChannel(channel);
    if (!channel || channel.type !== "text") {
      clearChannelTimeline();
      return;
    }
    await loadChannelMessages(channel.id);
  }, [clearChannelTimeline, loadChannelMessages]);

  const selectServer = useCallback(async (server, options = {}) => {
    if (!server) {
      return null;
    }
    setCurrentServer(server);
    await loadServerSnapshot(server.id, options);
    return server;
  }, [loadServerSnapshot]);

  const loadServers = useCallback(async ({ preferredServerId = null, persistedState = null } = {}) => {
    try {
      const response = await api.get("/servers");
      const nextServers = response.data || [];
      setServers(nextServers);

      if (nextServers.length === 0) {
        setCurrentServer(null);
        setCurrentChannel(null);
        setChannels([]);
        setMembers([]);
        setRoles([]);
        setViewerContext(null);
        clearChannelTimeline();
        navigate("/onboarding");
        return { servers: [], activeServer: null };
      }

      const activeServer =
        nextServers.find((server) => server.id === preferredServerId)
        || nextServers.find((server) => server.id === currentServerRef.current?.id)
        || nextServers.find((server) => server.id === persistedState?.serverId)
        || nextServers[0];

      await selectServer(activeServer, { preferredChannelId: persistedState?.channelId || null });
      return { servers: nextServers, activeServer };
    } catch (error) {
      if (error.response?.status === 401) {
        navigate("/login");
      } else {
        toast.error(formatAppError(t, error, { fallbackKey: "chat.loadServersFailed" }));
      }
      return { servers: [], activeServer: null, error };
    }
  }, [clearChannelTimeline, navigate, selectServer, t]);

  const refreshChannels = useCallback(async () => {
    if (!currentServerRef.current) {
      return;
    }
    try {
      const [channelResponse, viewerContextResponse] = await Promise.all([
        api.get(`/servers/${currentServerRef.current.id}/channels`),
        api.get(`/servers/${currentServerRef.current.id}/viewer-context`),
      ]);
      setChannels(channelResponse.data);
      setViewerContext(viewerContextResponse.data || null);
    } catch {
      // Keep the last state on transient refresh failures.
    }
  }, []);

  const refreshMembers = useCallback(async () => {
    if (!currentServerRef.current) {
      return;
    }
    try {
      const [memberResponse, viewerContextResponse] = await Promise.all([
        api.get(`/servers/${currentServerRef.current.id}/members`),
        api.get(`/servers/${currentServerRef.current.id}/viewer-context`),
      ]);
      setMembers(memberResponse.data);
      setViewerContext(viewerContextResponse.data || null);
    } catch {
      // Keep the last state on transient refresh failures.
    }
  }, []);

  const openServerSettingsFromRail = useCallback(async (server) => {
    if (!server) {
      return;
    }
    await selectServer(server);
    setServerSettingsRequest({
      serverId: server.id,
      nonce: Date.now(),
    });
  }, [selectServer]);

  const deleteServerFromRail = useCallback(async (server) => {
    if (!server) {
      return;
    }
    const confirmed = window.confirm(t("server.confirmDelete", { name: server.name }));
    if (!confirmed) {
      return;
    }

    try {
      await api.delete(`/servers/${server.id}`);
      toast.success(t("server.deleted"));
      if (currentServerRef.current?.id === server.id) {
        await loadServers();
      } else {
        setServers((previous) => previous.filter((entry) => entry.id !== server.id));
      }
    } catch (error) {
      toast.error(t("server.deleteFailed", {
        error: formatAppError(t, error, { fallbackKey: "errors.unknown" }),
      }));
    }
  }, [loadServers, t]);

  const resetWorkspace = useCallback(() => {
    setCurrentServer(null);
    setChannels([]);
    setMembers([]);
    setRoles([]);
    setViewerContext(null);
    setCurrentChannel(null);
    clearChannelTimeline();
  }, [clearChannelTimeline]);

  return {
    state: {
      servers,
      currentServer,
      channels,
      currentChannel,
      messages,
      channelHasOlderMessages,
      loadingOlderChannelMessages,
      members,
      roles,
      viewerContext,
      serverSettingsRequest,
    },
    refs: {
      currentServerRef,
      currentChannelRef,
    },
    actions: {
      loadServers,
      loadServerSnapshot,
      selectServer,
      selectChannel,
      loadOlderChannelMessages,
      refreshChannels,
      refreshMembers,
      openServerSettingsFromRail,
      deleteServerFromRail,
      clearChannelTimeline,
      resetWorkspace,
    },
    mutators: {
      setServers,
      setCurrentServer,
      setChannels,
      setCurrentChannel,
      setMessages,
      setMembers,
      setRoles,
      setViewerContext,
      setServerSettingsRequest,
    },
  };
}
