/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { consumePreferredServer } from "@/lib/inviteLinks";
import { getPersistedWorkspaceState, setPersistedWorkspaceState } from "@/lib/chatPersistence";
import { useDirectMessagesState } from "./hooks/useDirectMessagesState";
import { useMainLayoutSocket } from "./hooks/useMainLayoutSocket";
import { useNotificationBootstrap } from "./hooks/useNotificationBootstrap";
import { useServerWorkspaceState } from "./hooks/useServerWorkspaceState";
import { useMainLayoutEventHandler } from "./useMainLayoutEventHandler";

/**
 * MainLayout page orchestrator. It composes the workspace domain hooks and
 * exposes already prepared props for the shell/views, keeping the page entry
 * point stable and easy to test in isolation.
 */
export function useMainLayoutController({
  auth,
  runtimeConfig: config,
  e2ee,
  navigate,
  t,
}) {
  const {
    user,
    token,
    logout,
    setUser,
    clearAuthState,
  } = auth;
  const {
    fetchDmRecipients,
    inspectRecipientTrust,
    isDesktopCapable,
    ready: e2eeReady,
  } = e2ee;
  const [view, setView] = useState("server");
  const [showChannels, setShowChannels] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [unreadMap, setUnreadMap] = useState({});
  const [serverUnreadMap, setServerUnreadMap] = useState({});
  const [dmUnread, setDmUnread] = useState(0);
  const voiceRef = useRef(null);
  const audioCtxRef = useRef(null);
  const userStatusRef = useRef(user?.status);
  const isDesktop = Boolean(config?.isDesktop);

  const serverWorkspace = useServerWorkspaceState({
    userId: user?.id,
    navigate,
    t,
  });
  const directMessages = useDirectMessagesState({
    userId: user?.id,
    view,
    e2eeReady,
    fetchDmRecipients,
    inspectRecipientTrust,
  });

  useEffect(() => {
    userStatusRef.current = user?.status;
  }, [user?.status]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }
    const persistedState = getPersistedWorkspaceState(user.id);
    if (persistedState.view === "dm") {
      setView("dm");
    }
  }, [user?.id]);

  const refreshUnread = useCallback(async () => {
    try {
      const response = await api.get("/unread");
      setUnreadMap(response.data.channels || {});
      setServerUnreadMap(response.data.servers || {});
      setDmUnread(response.data.dm_total || 0);
    } catch {
      // Keep the last unread snapshot on transient failures.
    }
  }, []);

  const notificationPreferencesRef = useNotificationBootstrap({
    isDesktop,
    token,
  });

  const activateServerWorkspace = useCallback(() => {
    setView("server");
  }, []);

  const activateDmWorkspace = useCallback(() => {
    setView("dm");
    setShowChannels(false);
    setShowMembers(false);
  }, []);

  const loadServers = useCallback(async () => {
    const persistedState = getPersistedWorkspaceState(user?.id);
    const result = await serverWorkspace.actions.loadServers({
      preferredServerId: consumePreferredServer(),
      persistedState,
    });

    if (!result.activeServer) {
      setUnreadMap({});
      setServerUnreadMap({});
      return result;
    }

    if (persistedState.view === "dm") {
      activateDmWorkspace();
      void directMessages.actions.loadDmConversations();
      void directMessages.actions.loadGroupDMs();
    } else {
      activateServerWorkspace();
    }

    return result;
  }, [activateDmWorkspace, activateServerWorkspace, directMessages.actions, serverWorkspace.actions, user?.id]);

  const selectServer = useCallback(async (server, options = {}) => {
    if (!server) {
      return;
    }
    activateServerWorkspace();
    try {
      await serverWorkspace.actions.selectServer(server, options);
    } catch {
      toast.error(formatAppError(t, null, { fallbackKey: "chat.loadServerFailed" }));
    }
  }, [activateServerWorkspace, serverWorkspace.actions, t]);

  const selectChannel = useCallback(async (channel) => {
    await serverWorkspace.actions.selectChannel(channel);
  }, [serverWorkspace.actions]);

  const switchToDm = useCallback(() => {
    activateDmWorkspace();
    void directMessages.actions.loadDmConversations();
    void directMessages.actions.loadGroupDMs();
  }, [activateDmWorkspace, directMessages.actions]);

  const startDmWithUser = useCallback(async (dmUser) => {
    activateDmWorkspace();
    await directMessages.actions.selectDmUser(dmUser);
  }, [activateDmWorkspace, directMessages.actions]);

  const handleRemovedFromServer = useCallback(async (_serverId, reasonLabel) => {
    void _serverId;
    if (voiceRef.current) {
      await voiceRef.current.disconnect();
      voiceRef.current = null;
    }

    serverWorkspace.actions.resetWorkspace();

    if (reasonLabel) {
      toast.error(reasonLabel);
    }

    await loadServers();
  }, [loadServers, serverWorkspace.actions]);

  const handleSessionRevoked = useCallback(async () => {
    toast.error(formatAppError(t, { detail: { code: "session_revoked" } }));
    await clearAuthState();
    navigate("/login", { replace: true });
  }, [clearAuthState, navigate, t]);

  const handleWsEvent = useMainLayoutEventHandler({
    t,
    navigate,
    userId: user?.id,
    config,
    setUser,
    refreshUnread,
    notificationPreferencesRef,
    userStatusRef,
    audioCtxRef,
    voiceRef,
    setTypingUsers,
    serverWorkspace,
    directMessages,
    loadServers,
    handleRemovedFromServer,
  });

  const { wsConnected, sendJson } = useMainLayoutSocket({
    token,
    wsBase: config?.wsBase,
    isDesktop,
    currentServerRef: serverWorkspace.refs.currentServerRef,
    currentDmUserRef: directMessages.refs.currentDmUserRef,
    onRefreshCurrentServer: (serverId) => serverWorkspace.actions.loadServerSnapshot(serverId),
    onRefreshDmConversations: directMessages.actions.loadDmConversations,
    onEvent: handleWsEvent,
    onSessionRevoked: handleSessionRevoked,
  });

  useEffect(() => {
    if (!user?.id) {
      return;
    }
    setPersistedWorkspaceState(user.id, {
      view,
      serverId: serverWorkspace.state.currentServer?.id || null,
      channelId: view === "server" ? serverWorkspace.state.currentChannel?.id || null : null,
      dmUserId: view === "dm" ? directMessages.state.currentDmUser?.id || null : null,
    });
  }, [
    directMessages.state.currentDmUser?.id,
    serverWorkspace.state.currentChannel?.id,
    serverWorkspace.state.currentServer?.id,
    user?.id,
    view,
  ]);

  useEffect(() => {
    void loadServers();
    const unreadInterval = window.setInterval(refreshUnread, 5 * 60 * 1000);
    void refreshUnread();
    return () => window.clearInterval(unreadInterval);
  }, [loadServers, refreshUnread]);

  const sendTyping = useCallback(() => {
    if (serverWorkspace.refs.currentChannelRef.current) {
      sendJson({
        type: "typing",
        channel_id: serverWorkspace.refs.currentChannelRef.current.id,
      });
    }
  }, [sendJson, serverWorkspace.refs.currentChannelRef]);

  const openServerSettingsFromRail = useCallback(async (server) => {
    activateServerWorkspace();
    setShowChannels(false);
    await serverWorkspace.actions.openServerSettingsFromRail(server);
  }, [activateServerWorkspace, serverWorkspace.actions]);

  const serverSidebarProps = useMemo(() => ({
    servers: serverWorkspace.state.servers,
    currentServer: serverWorkspace.state.currentServer,
    onSelectServer: (server) => {
      void selectServer(server);
      setShowChannels(false);
    },
    onRefreshServers: loadServers,
    view,
    onSwitchToDm: switchToDm,
    user,
    onLogout: logout,
    dmUnread,
    serverUnreadMap,
    onManageServer: openServerSettingsFromRail,
    onDeleteServer: serverWorkspace.actions.deleteServerFromRail,
  }), [dmUnread, loadServers, logout, openServerSettingsFromRail, selectServer, serverUnreadMap, serverWorkspace.actions.deleteServerFromRail, serverWorkspace.state.currentServer, serverWorkspace.state.servers, switchToDm, user, view]);

  const serverWorkspaceProps = useMemo(() => ({
    currentServer: serverWorkspace.state.currentServer,
    currentChannel: serverWorkspace.state.currentChannel,
    showChannels,
    showMembers,
    setShowChannels,
    setShowMembers,
    channelSidebarProps: {
      server: serverWorkspace.state.currentServer,
      channels: serverWorkspace.state.channels,
      currentChannel: serverWorkspace.state.currentChannel,
      onSelectChannel: (channel) => {
        void selectChannel(channel);
        setShowChannels(false);
      },
      onRefreshChannels: serverWorkspace.actions.refreshChannels,
      user,
      members: serverWorkspace.state.members,
      roles: serverWorkspace.state.roles,
      viewerContext: serverWorkspace.state.viewerContext,
      unreadMap,
      voiceEngineRef: voiceRef,
      onLogout: logout,
      onUserUpdated: setUser,
      onRefreshServers: loadServers,
      serverSettingsRequest: serverWorkspace.state.serverSettingsRequest,
    },
    chatAreaProps: {
      channel: serverWorkspace.state.currentChannel,
      messages: serverWorkspace.state.messages,
      setMessages: serverWorkspace.mutators.setMessages,
      user,
      server: serverWorkspace.state.currentServer,
      serverId: serverWorkspace.state.currentServer?.id,
      members: serverWorkspace.state.members,
      roles: serverWorkspace.state.roles,
      viewerContext: serverWorkspace.state.viewerContext,
      onSendTyping: sendTyping,
      typingUsers: typingUsers[serverWorkspace.state.currentChannel?.id] || {},
      onChannelRead: refreshUnread,
      hasOlderMessages: serverWorkspace.state.channelHasOlderMessages,
      onLoadOlderMessages: serverWorkspace.actions.loadOlderChannelMessages,
      loadingOlderMessages: serverWorkspace.state.loadingOlderChannelMessages,
    },
    memberSidebarProps: {
      members: serverWorkspace.state.members,
      roles: serverWorkspace.state.roles,
      serverId: serverWorkspace.state.currentServer?.id,
      server: serverWorkspace.state.currentServer,
      user,
      viewerContext: serverWorkspace.state.viewerContext,
      onStartDM: (dmUser) => {
        switchToDm();
        void startDmWithUser(dmUser);
        setShowMembers(false);
      },
      onRefreshMembers: serverWorkspace.actions.refreshMembers,
    },
  }), [loadServers, logout, refreshUnread, selectChannel, sendTyping, serverWorkspace.actions, serverWorkspace.mutators.setMessages, serverWorkspace.state.channelHasOlderMessages, serverWorkspace.state.channels, serverWorkspace.state.currentChannel, serverWorkspace.state.currentServer, serverWorkspace.state.loadingOlderChannelMessages, serverWorkspace.state.members, serverWorkspace.state.messages, serverWorkspace.state.roles, serverWorkspace.state.serverSettingsRequest, serverWorkspace.state.viewerContext, setUser, showChannels, showMembers, startDmWithUser, switchToDm, typingUsers, unreadMap, user]);

  const dmSortTitle = useMemo(() => {
    if (directMessages.state.dmSortMode === "recent") {
      return "Sortierung: Neueste zuerst";
    }
    if (directMessages.state.dmSortMode === "unread") {
      return "Sortierung: Ungelesene zuerst";
    }
    return "Sortierung: A-Z";
  }, [directMessages.state.dmSortMode]);

  const directMessagesWorkspaceProps = useMemo(() => ({
    t,
    config,
    e2eeReady,
    isDesktopCapable,
    sidebar: {
      dmConversations: directMessages.state.dmConversations,
      dmSortMode: directMessages.state.dmSortMode,
      sortTitle: dmSortTitle,
      dmSearchOpen: directMessages.state.dmSearchOpen,
      dmSearchQuery: directMessages.state.dmSearchQuery,
      dmSearchResults: directMessages.state.dmSearchResults,
      dmSearchLoading: directMessages.state.dmSearchLoading,
      dmTab: directMessages.state.dmTab,
      groupDMs: directMessages.state.groupDMs,
      onCycleSortMode: directMessages.actions.cycleSortMode,
      onToggleSearch: directMessages.actions.toggleSearch,
      onSelectTab: directMessages.actions.setDmTab,
      onChangeSearchQuery: directMessages.actions.setDmSearchQuery,
      onSelectDmUser: startDmWithUser,
      onSelectGroupDm: directMessages.actions.selectGroupDm,
      onStartRelayDm: directMessages.actions.startRelayDm,
      onGroupsChanged: directMessages.actions.loadGroupDMs,
    },
    activePane: {
      currentGroupDM: directMessages.state.currentGroupDM,
      relayDmFriend: directMessages.state.relayDmFriend,
      currentDmUser: directMessages.state.currentDmUser,
      dmTrustNotice: directMessages.state.dmTrustNotice,
      dmHasOlderMessages: directMessages.state.dmHasOlderMessages,
      loadingOlderDmMessages: directMessages.state.loadingOlderDmMessages,
      dmMessages: directMessages.state.dmMessages,
      onLoadOlderDmMessages: directMessages.actions.loadOlderDmMessages,
      onDmSent: directMessages.actions.appendDmMessage,
    },
  }), [config, directMessages.actions, directMessages.state.currentDmUser, directMessages.state.currentGroupDM, directMessages.state.dmConversations, directMessages.state.dmHasOlderMessages, directMessages.state.dmMessages, directMessages.state.dmSearchLoading, directMessages.state.dmSearchOpen, directMessages.state.dmSearchQuery, directMessages.state.dmSearchResults, directMessages.state.dmSortMode, directMessages.state.dmTab, directMessages.state.dmTrustNotice, directMessages.state.groupDMs, directMessages.state.loadingOlderDmMessages, directMessages.state.relayDmFriend, dmSortTitle, e2eeReady, isDesktopCapable, startDmWithUser, t]);

  return {
    shell: {
      wsConnected,
      view,
      loadingLabel: t("app.loading"),
      serverSidebarProps,
    },
    serverWorkspace: serverWorkspaceProps,
    directMessagesWorkspace: directMessagesWorkspaceProps,
    actions: {
      selectServer,
      switchToDm,
      startDmWithUser,
    },
  };
}
