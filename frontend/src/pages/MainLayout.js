import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { List, Paperclip, ShieldCheck, UsersThree, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/contexts/RuntimeContext";
import { useE2EE } from "@/contexts/E2EEContext";
import api from "@/lib/api";
import {
  getCachedChannelMessages,
  getCachedDmMessages,
  getPersistedWorkspaceState,
  setCachedChannelMessages,
  setCachedDmMessages,
  setPersistedWorkspaceState,
} from "@/lib/chatPersistence";
import { formatAppError } from "@/lib/appErrors";
import { resolveAssetUrl } from "@/lib/assetUrls";
import { consumePreferredServer } from "@/lib/inviteLinks";
import {
  fetchMessageHistoryPage,
  fetchMessageHistoryWindow,
  mergeTimelineMessages,
} from "@/lib/messageHistory";
import {
  getNotificationPreferences,
  requestNotificationPermission,
  subscribeToPush,
} from "@/lib/pushNotifications";
import { pushNotification } from "@/lib/notificationsStore";
import ServerSidebar from "@/components/chat/ServerSidebar";
import ChannelSidebar from "@/components/chat/ChannelSidebar";
import ChatArea from "@/components/chat/ChatArea";
import MemberSidebar from "@/components/chat/MemberSidebar";
import E2EEStatus from "@/components/security/E2EEStatus";

function upsertById(list, item) {
  const existingIndex = list.findIndex((entry) => entry.id === item.id);
  if (existingIndex === -1) {
    return [...list, item];
  }

  const next = [...list];
  next[existingIndex] = { ...next[existingIndex], ...item };
  return next;
}

function upsertMember(list, member) {
  const existingIndex = list.findIndex((entry) => entry.user_id === member.user_id);
  if (existingIndex === -1) {
    return [...list, member];
  }

  const next = [...list];
  next[existingIndex] = {
    ...next[existingIndex],
    ...member,
    user: {
      ...(next[existingIndex].user || {}),
      ...(member.user || {}),
    },
  };
  return next;
}

function removeMember(list, userId) {
  return list.filter((member) => member.user_id !== userId);
}

function removeVoiceUser(channels, userId, channelId = null) {
  return channels.map((channel) => {
    if (channel.type !== "voice") return channel;
    if (channelId && channel.id !== channelId) return channel;
    return {
      ...channel,
      voice_states: (channel.voice_states || []).filter((state) => state.user_id !== userId),
    };
  });
}

function upsertVoiceState(channels, channelId, nextState) {
  return channels.map((channel) => {
    if (channel.type !== "voice") {
      return {
        ...channel,
        voice_states: removeVoiceUser([channel], nextState.user_id)[0]?.voice_states || channel.voice_states,
      };
    }

    if (channel.id === channelId) {
      const existingStates = (channel.voice_states || []).filter((state) => state.user_id !== nextState.user_id);
      return {
        ...channel,
        voice_states: [...existingStates, nextState],
      };
    }

    return {
      ...channel,
      voice_states: (channel.voice_states || []).filter((state) => state.user_id !== nextState.user_id),
    };
  });
}

function mergeMessages(previousMessages, nextMessage) {
  if (!nextMessage) {
    return previousMessages;
  }

  const mergedMessages = previousMessages.some((message) => message.id === nextMessage.id)
    ? previousMessages.map((message) => (message.id === nextMessage.id ? { ...message, ...nextMessage } : message))
    : [...previousMessages, nextMessage];

  return mergedMessages.slice().sort((left, right) => (
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  ));
}

export default function MainLayout() {
  const { t } = useTranslation();
  const { user, token, logout, setUser, clearAuthState } = useAuth();
  const { config } = useRuntime();
  const {
    fetchDmRecipients,
    inspectRecipientTrust,
    isDesktopCapable,
    ready: e2eeReady,
  } = useE2EE();
  const navigate = useNavigate();
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const heartbeatTimer = useRef(null);
  const sessionInvalidatedRef = useRef(false);
  const voiceRef = useRef(null);
  const currentServerRef = useRef(null);
  const currentChannelRef = useRef(null);
  const currentDmUserRef = useRef(null);
  const latestChannelLoadRef = useRef(0);
  const notificationPreferencesRef = useRef({
    web_push_enabled: true,
    desktop_push_enabled: true,
  });

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
  const [showChannels, setShowChannels] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [view, setView] = useState("server");
  const [dmConversations, setDmConversations] = useState([]);
  const [currentDmUser, setCurrentDmUser] = useState(null);
  const [dmMessages, setDmMessages] = useState([]);
  const [dmHistoryCursor, setDmHistoryCursor] = useState(null);
  const [dmHasOlderMessages, setDmHasOlderMessages] = useState(false);
  const [loadingOlderDmMessages, setLoadingOlderDmMessages] = useState(false);
  const [dmTrustNotice, setDmTrustNotice] = useState(false);
  const [typingUsers, setTypingUsers] = useState({});
  const [unreadMap, setUnreadMap] = useState({});
  const [serverUnreadMap, setServerUnreadMap] = useState({});
  const [dmUnread, setDmUnread] = useState(0);

  useEffect(() => {
    currentServerRef.current = currentServer;
  }, [currentServer]);

  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  useEffect(() => {
    currentDmUserRef.current = currentDmUser;
  }, [currentDmUser]);

  useEffect(() => {
    let cancelled = false;

    if (!currentDmUser?.id || !e2eeReady) {
      setDmTrustNotice(false);
      return undefined;
    }

    (async () => {
      try {
        const recipients = await fetchDmRecipients(currentDmUser.id);
        const result = await inspectRecipientTrust({
          scopeKind: "dm",
          scopeId: currentDmUser.id,
          recipientsResponse: recipients,
        });
        if (!cancelled) {
          setDmTrustNotice(Boolean(result.changed));
        }
      } catch {
        if (!cancelled) {
          setDmTrustNotice(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentDmUser?.id, e2eeReady, fetchDmRecipients, inspectRecipientTrust]);

  useEffect(() => {
    sessionInvalidatedRef.current = false;
  }, [token]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }
    const persistedState = getPersistedWorkspaceState(user.id);
    if (persistedState.view === "dm") {
      setView("dm");
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) {
      return;
    }
    setPersistedWorkspaceState(user.id, {
      view,
      serverId: currentServer?.id || null,
      channelId: view === "server" ? currentChannel?.id || null : null,
      dmUserId: view === "dm" ? currentDmUser?.id || null : null,
    });
  }, [currentChannel?.id, currentDmUser?.id, currentServer?.id, user?.id, view]);

  useEffect(() => {
    if (!user?.id || currentChannel?.type !== "text") {
      return;
    }
    setCachedChannelMessages(user.id, currentChannel.id, messages);
  }, [currentChannel?.id, currentChannel?.type, messages, user?.id]);

  useEffect(() => {
    if (!user?.id || !currentDmUser?.id) {
      return;
    }
    setCachedDmMessages(user.id, currentDmUser.id, dmMessages);
  }, [currentDmUser?.id, dmMessages, user?.id]);

  const refreshUnread = useCallback(async () => {
    try {
      const res = await api.get("/unread");
      setUnreadMap(res.data.channels || {});
      setServerUnreadMap(res.data.servers || {});
      setDmUnread(res.data.dm_total || 0);
    } catch {
      // Keep the last unread snapshot on transient failures.
    }
  }, []);

  const loadDmConversations = useCallback(async () => {
    try {
      const res = await api.get("/dm/conversations");
      setDmConversations(res.data);
    } catch {
      setDmConversations([]);
    }
  }, []);

  const loadChannelMessages = useCallback(async (channelId) => {
    if (!channelId) {
      latestChannelLoadRef.current += 1;
      setMessages([]);
      setChannelHistoryCursor(null);
      setChannelHasOlderMessages(false);
      return;
    }

    // Quick channel switches can leave older requests resolving after the user
    // already moved elsewhere. The request token keeps stale responses from
    // blanking or replacing the current timeline.
    const requestId = latestChannelLoadRef.current + 1;
    latestChannelLoadRef.current = requestId;
    const cachedMessages = getCachedChannelMessages(user?.id, channelId);
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
  }, [user?.id]);

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
    const [channelRes, memberRes, roleRes, viewerContextRes] = await Promise.all([
      api.get(`/servers/${serverId}/channels`),
      api.get(`/servers/${serverId}/members`),
      api.get(`/servers/${serverId}/roles`),
      api.get(`/servers/${serverId}/viewer-context`),
    ]);

    setChannels(channelRes.data);
    setMembers(memberRes.data);
    setRoles(roleRes.data);
    setViewerContext(viewerContextRes.data || null);

    const nextChannel = (
      currentChannelRef.current && channelRes.data.some((channel) => channel.id === currentChannelRef.current.id)
        ? channelRes.data.find((channel) => channel.id === currentChannelRef.current.id) || currentChannelRef.current
        : preferredChannelId && channelRes.data.some((channel) => channel.id === preferredChannelId)
          ? channelRes.data.find((channel) => channel.id === preferredChannelId) || null
          : channelRes.data.find((channel) => channel.type === "text") || null
    );

    currentChannelRef.current = nextChannel;
    setCurrentChannel(nextChannel);

    if (nextChannel?.type === "text") {
      await loadChannelMessages(nextChannel.id);
      return;
    }

    latestChannelLoadRef.current += 1;
    setMessages([]);
    setChannelHistoryCursor(null);
    setChannelHasOlderMessages(false);
  }, [loadChannelMessages]);

  const selectChannel = useCallback(async (channel) => {
    currentChannelRef.current = channel;
    setCurrentChannel(channel);
    if (!channel || channel.type !== "text") {
      latestChannelLoadRef.current += 1;
      setMessages([]);
      setChannelHistoryCursor(null);
      setChannelHasOlderMessages(false);
      return;
    }
    await loadChannelMessages(channel.id);
  }, [loadChannelMessages]);

  const selectServer = useCallback(async (server, options = {}) => {
    if (!server) return;
    setCurrentServer(server);
    setView("server");

    try {
      await loadServerSnapshot(server.id, options);
    } catch {
      toast.error(formatAppError(t, null, { fallbackKey: "chat.loadServerFailed" }));
    }
  }, [loadServerSnapshot, t]);

  const loadServers = useCallback(async () => {
    try {
      const res = await api.get("/servers");
      const nextServers = res.data || [];
      setServers(nextServers);

      if (nextServers.length === 0) {
        setCurrentServer(null);
        setCurrentChannel(null);
        setChannels([]);
        setMembers([]);
        setRoles([]);
        setViewerContext(null);
        setUnreadMap({});
        setServerUnreadMap({});
        navigate("/onboarding");
        return;
      }

      // Invite accepts can hint which server should open next.
      const preferredServerId = consumePreferredServer();
      const persistedState = getPersistedWorkspaceState(user?.id);
      const activeServer =
        nextServers.find((server) => server.id === preferredServerId)
        || nextServers.find((server) => server.id === currentServerRef.current?.id)
        || nextServers.find((server) => server.id === persistedState.serverId)
        || nextServers[0];
      await selectServer(activeServer, { preferredChannelId: persistedState.channelId });
      if (persistedState.view === "dm") {
        setView("dm");
        void loadDmConversations();
      }
    } catch (error) {
      if (error.response?.status === 401) {
        navigate("/login");
      } else {
        toast.error(formatAppError(t, error, { fallbackKey: "chat.loadServersFailed" }));
      }
    }
  }, [loadDmConversations, navigate, selectServer, t, user?.id]);

  const selectDmUser = useCallback(async (dmUser) => {
    if (!dmUser) {
      return;
    }
    setView("dm");
    setCurrentDmUser(dmUser);
    const cachedMessages = getCachedDmMessages(user?.id, dmUser.id);
    if (cachedMessages.length > 0) {
      setDmMessages(cachedMessages);
    }
    setDmHistoryCursor(null);
    setDmHasOlderMessages(false);
    try {
      const history = await fetchMessageHistoryWindow(`/dm/${dmUser.id}`);
      setDmMessages(mergeTimelineMessages(cachedMessages, history.messages));
      setDmHistoryCursor(history.nextBefore);
      setDmHasOlderMessages(history.hasMoreBefore);
    } catch {
      setDmMessages(cachedMessages);
      setDmHistoryCursor(null);
      setDmHasOlderMessages(false);
    }
  }, [user?.id]);

  const loadOlderDmMessages = useCallback(async () => {
    if (!currentDmUserRef.current?.id || !dmHasOlderMessages || loadingOlderDmMessages) {
      return;
    }

    setLoadingOlderDmMessages(true);
    try {
      const envelope = await fetchMessageHistoryPage(`/dm/${currentDmUserRef.current.id}`, {
        before: dmHistoryCursor,
      });
      setDmMessages((previous) => mergeTimelineMessages(envelope.messages, previous));
      setDmHistoryCursor(envelope.nextBefore);
      setDmHasOlderMessages(envelope.hasMoreBefore);
    } finally {
      setLoadingOlderDmMessages(false);
    }
  }, [dmHasOlderMessages, dmHistoryCursor, loadingOlderDmMessages]);

  const switchToDm = useCallback(() => {
    setView("dm");
    setShowChannels(false);
    setShowMembers(false);
    void loadDmConversations();
  }, [loadDmConversations]);

  const handleRemovedFromServer = useCallback(async (serverId, reasonLabel) => {
    if (voiceRef.current) {
      await voiceRef.current.disconnect();
      voiceRef.current = null;
    }

    setChannels([]);
    setMembers([]);
    setRoles([]);
    setViewerContext(null);
    setMessages([]);
    setCurrentChannel(null);

    if (reasonLabel) {
      toast.error(reasonLabel);
    }

    await loadServers();
  }, [loadServers]);

  const handleWsEvent = useCallback(async (data) => {
    switch (data.type) {
      case "session_revoked":
        sessionInvalidatedRef.current = true;
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
        if (wsRef.current && wsRef.current.readyState < WebSocket.CLOSING) {
          try {
            wsRef.current.close(4001, "session_revoked");
          } catch {
            // Ignore close failures for already-closing sockets.
          }
        }
        toast.error(formatAppError(t, { detail: { code: "session_revoked" } }));
        await clearAuthState();
        navigate("/login", { replace: true });
        break;

      case "new_message":
        if (data.channel_id === currentChannelRef.current?.id) {
          setMessages((previous) => mergeMessages(previous, data.message));
          setTypingUsers((previous) => {
            const channelTyping = { ...(previous[data.channel_id] || {}) };
            delete channelTyping[data.message.author_id];
            return { ...previous, [data.channel_id]: channelTyping };
          });
        } else {
          void refreshUnread();
        }
        break;

      case "message_edit":
        setMessages((previous) => previous.map((message) => message.id === data.message.id ? data.message : message));
        break;

      case "message_delete":
        setMessages((previous) => previous.filter((message) => message.id !== data.message_id));
        break;

      case "typing":
        if (!data.channel_id) {
          break;
        }
        setTypingUsers((previous) => {
          const channelTyping = { ...(previous[data.channel_id] || {}), [data.user_id]: data.username };
          return { ...previous, [data.channel_id]: channelTyping };
        });
        window.setTimeout(() => {
          setTypingUsers((previous) => {
            const channelTyping = { ...(previous[data.channel_id] || {}) };
            delete channelTyping[data.user_id];
            return { ...previous, [data.channel_id]: channelTyping };
          });
        }, 3000);
        break;

      case "dm_message":
        if (data.message.sender_id === currentDmUserRef.current?.id) {
          setDmMessages((previous) => previous.some((message) => message.id === data.message.id) ? previous : [...previous, data.message]);
        }
        void loadDmConversations();
        void refreshUnread();
        break;

      case "server_updated":
        setServers((previous) => upsertById(previous, data.server));
        if (currentServerRef.current?.id === data.server.id) {
          setCurrentServer((previous) => ({ ...(previous || {}), ...data.server }));
        }
        break;

      case "server_deleted":
        setServers((previous) => previous.filter((server) => server.id !== data.server_id));
        if (currentServerRef.current?.id === data.server_id) {
          await handleRemovedFromServer(data.server_id, t("server.deleted"));
        }
        break;

      case "channel_create":
        setChannels((previous) => previous.some((channel) => channel.id === data.channel.id) ? previous : [...previous, data.channel]);
        break;

      case "channel_updated":
        setChannels((previous) => previous.map((channel) => channel.id === data.channel.id ? { ...channel, ...data.channel } : channel));
        if (currentChannelRef.current?.id === data.channel.id) {
          setCurrentChannel((previous) => ({ ...(previous || {}), ...data.channel }));
        }
        break;

      case "channel_delete":
        setChannels((previous) => previous.filter((channel) => channel.id !== data.channel_id));
        if (currentChannelRef.current?.id === data.channel_id) {
          setCurrentChannel(null);
          setMessages([]);
        }
        break;

      case "role_created":
        setRoles((previous) => previous.some((role) => role.id === data.role.id) ? previous : [...previous, data.role]);
        break;

      case "role_updated":
        setRoles((previous) => previous.map((role) => role.id === data.role.id ? { ...role, ...data.role } : role));
        break;

      case "role_deleted":
        setRoles((previous) => previous.filter((role) => role.id !== data.role_id));
        setMembers((previous) => previous.map((member) => ({
          ...member,
          roles: (member.roles || []).filter((roleId) => roleId !== data.role_id),
        })));
        break;

      case "member_joined":
        if (data.member) {
          setMembers((previous) => upsertMember(previous, data.member));
        }
        break;

      case "member_updated":
        if (data.member) {
          setMembers((previous) => upsertMember(previous, data.member));
        }
        break;

      case "presence_update":
        setMembers((previous) => previous.map((member) => (
          member.user_id === data.user_id
            ? { ...member, user: { ...(member.user || {}), ...(data.user || {}) } }
            : member
        )));
        setDmConversations((previous) => previous.map((conversation) => (
          conversation.user?.id === data.user_id
            ? { ...conversation, user: { ...(conversation.user || {}), ...(data.user || {}) } }
            : conversation
        )));
        setMessages((previous) => previous.map((message) => (
          message.author_id === data.user_id
            ? { ...message, author: { ...(message.author || {}), ...(data.user || {}) } }
            : message
        )));
        setDmMessages((previous) => previous.map((message) => (
          message.sender_id === data.user_id
            ? { ...message, sender: { ...(message.sender || {}), ...(data.user || {}) } }
            : message
        )));
        if (currentDmUserRef.current?.id === data.user_id) {
          setCurrentDmUser((previous) => ({ ...(previous || {}), ...(data.user || {}) }));
        }
        if (user?.id === data.user_id) {
          setUser((previous) => ({ ...(previous || {}), ...(data.user || {}) }));
        }
        break;

      case "member_kicked":
      case "member_banned":
        setMembers((previous) => removeMember(previous, data.user_id));
        setChannels((previous) => removeVoiceUser(previous, data.user_id));
        if (data.user_id === user?.id && data.server_id === currentServerRef.current?.id) {
          await handleRemovedFromServer(
            data.server_id,
            data.type === "member_kicked" ? t("server.removedFromServer") : t("server.bannedFromServer"),
          );
        }
        break;

      case "member_left":
        setMembers((previous) => removeMember(previous, data.user_id));
        setChannels((previous) => removeVoiceUser(previous, data.user_id));
        break;

      case "member_unbanned":
        if (data.member) {
          setMembers((previous) => upsertMember(previous, data.member));
        }
        if (data.user_id === user?.id) {
          await loadServers();
        }
        break;

      case "server_left":
        if (data.user_id === user?.id) {
          await handleRemovedFromServer(data.server_id, t("server.left"));
        }
        break;

      case "voice_join":
        setChannels((previous) => upsertVoiceState(previous, data.channel_id, data.state));
        break;

      case "voice_leave":
        setChannels((previous) => removeVoiceUser(previous, data.user_id, data.channel_id));
        break;

      case "voice_state_update":
        setChannels((previous) => previous.map((channel) => {
          if (channel.id !== data.channel_id) return channel;
          return {
            ...channel,
            voice_states: (channel.voice_states || []).map((state) => (
              state.user_id === data.user_id ? { ...state, ...data.state } : state
            )),
          };
        }));
        break;

      case "voice_force_leave":
        if (voiceRef.current) {
          await voiceRef.current.disconnect();
          voiceRef.current = null;
        }
        setChannels((previous) => removeVoiceUser(previous, user?.id, data.channel_id));
        break;

      case "notification":
        pushNotification(data.notification);
        toast(data.notification.title, {
          description: data.notification.body,
          action: data.notification.link ? {
            label: "View",
            onClick: () => navigate(data.notification.link)
          } : undefined
        });
        if (config?.isDesktop && notificationPreferencesRef.current?.desktop_push_enabled !== false) {
          import("@tauri-apps/plugin-notification").then(({ sendNotification }) => {
            sendNotification({ title: data.notification.title, body: data.notification.body });
          }).catch(() => {});
        } else if (
          !config?.isDesktop
          && notificationPreferencesRef.current?.web_push_enabled !== false
          && typeof window !== "undefined"
          && "Notification" in window
          && Notification.permission === "granted"
          && document.visibilityState !== "visible"
        ) {
          const browserNotification = new Notification(data.notification.title, {
            body: data.notification.body,
          });
          browserNotification.onclick = () => {
            window.focus();
            if (data.notification.link) {
              navigate(data.notification.link);
            }
          };
        }
        break;

      default:
        break;
    }
  }, [clearAuthState, config?.isDesktop, handleRemovedFromServer, loadDmConversations, loadServers, navigate, refreshUnread, setUser, t, user?.id]);

  const connectWs = useCallback(() => {
    if (!token || !config?.wsBase || sessionInvalidatedRef.current) return;

    if (wsRef.current) {
      wsRef.current.close();
    }

    const platform = config?.isDesktop ? "desktop" : "web";
    const ws = new WebSocket(`${config.wsBase}/api/ws?token=${token}&platform=${platform}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (heartbeatTimer.current) {
        clearInterval(heartbeatTimer.current);
      }

      heartbeatTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 20000);

      if (currentServerRef.current?.id) {
        void loadServerSnapshot(currentServerRef.current.id);
      }
      if (currentDmUserRef.current?.id) {
        void loadDmConversations();
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "pong") {
          return;
        }
        void handleWsEvent(data);
      } catch {
        // Ignore malformed socket payloads.
      }
    };

    ws.onclose = () => {
      if (heartbeatTimer.current) {
        clearInterval(heartbeatTimer.current);
        heartbeatTimer.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      if (sessionInvalidatedRef.current) {
        return;
      }
      reconnectTimer.current = setTimeout(connectWs, 3000);
    };

    ws.onerror = () => ws.close();
  }, [config?.isDesktop, config?.wsBase, handleWsEvent, loadDmConversations, loadServerSnapshot, token]);

  useEffect(() => {
    void loadServers();
    const unreadInterval = window.setInterval(refreshUnread, 5 * 60 * 1000);
    void refreshUnread();
    return () => window.clearInterval(unreadInterval);
  }, [loadServers, refreshUnread]);

  useEffect(() => {
    if (!token) {
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        // Brief delay – let the workspace fully render before showing the browser permission dialog
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (cancelled) return;

        const nextPreferences = await getNotificationPreferences();
        if (cancelled) return;
        notificationPreferencesRef.current = nextPreferences;

        const notificationsEnabled = config?.isDesktop
          ? nextPreferences.desktop_push_enabled !== false
          : nextPreferences.web_push_enabled !== false;
        if (!notificationsEnabled) {
          return;
        }

        // Skip if already granted – just (re-)register the subscription silently
        const currentPermission = !config?.isDesktop && "Notification" in window
          ? Notification.permission
          : "default";

        if (currentPermission === "denied") {
          // User blocked notifications – show a subtle hint once per session
          toast.info("Benachrichtigungen sind blockiert. Erlaube sie in den Browser-Einstellungen.", {
            duration: 6000,
            id: "push-denied",
          });
          return;
        }

        const granted = currentPermission === "granted"
          ? true
          : await requestNotificationPermission();

        if (!granted || cancelled) {
          return;
        }

        if (currentPermission !== "granted") {
          // First-time grant – let the user know
          toast.success("Benachrichtigungen aktiviert!", { duration: 3000, id: "push-granted" });
        }

        if (!config?.isDesktop) {
          await subscribeToPush();
        }
      } catch {
        // Notification setup should never block the workspace bootstrap.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [config?.isDesktop, token]);

  useEffect(() => {
    if (view !== "dm" || currentDmUser || dmConversations.length === 0 || !user?.id) {
      return;
    }
    const persistedState = getPersistedWorkspaceState(user.id);
    if (!persistedState.dmUserId) {
      return;
    }
    const persistedConversation = dmConversations.find((conversation) => conversation.user?.id === persistedState.dmUserId);
    if (persistedConversation?.user) {
      void selectDmUser(persistedConversation.user);
    }
  }, [currentDmUser, dmConversations, selectDmUser, user?.id, view]);

  useEffect(() => {
    if (!token) return undefined;
    connectWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (heartbeatTimer.current) {
        clearInterval(heartbeatTimer.current);
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, [connectWs, token]);

  const sendTyping = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && currentChannelRef.current) {
      wsRef.current.send(JSON.stringify({ type: "typing", channel_id: currentChannelRef.current.id }));
    }
  }, []);

  const refreshChannels = useCallback(async () => {
    if (!currentServerRef.current) return;
    try {
      const [channelRes, viewerContextRes] = await Promise.all([
        api.get(`/servers/${currentServerRef.current.id}/channels`),
        api.get(`/servers/${currentServerRef.current.id}/viewer-context`),
      ]);
      setChannels(channelRes.data);
      setViewerContext(viewerContextRes.data || null);
    } catch {
      // keep last state
    }
  }, []);

  const refreshMembers = useCallback(async () => {
    if (!currentServerRef.current) return;
    try {
      const [memberRes, viewerContextRes] = await Promise.all([
        api.get(`/servers/${currentServerRef.current.id}/members`),
        api.get(`/servers/${currentServerRef.current.id}/viewer-context`),
      ]);
      setMembers(memberRes.data);
      setViewerContext(viewerContextRes.data || null);
    } catch {
      // keep last state
    }
  }, []);

  const openServerSettingsFromRail = useCallback(async (server) => {
    if (!server) return;
    await selectServer(server);
    setServerSettingsRequest({
      serverId: server.id,
      nonce: Date.now(),
    });
  }, [selectServer]);

  const deleteServerFromRail = useCallback(async (server) => {
    if (!server) return;
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

  return (
    <div className="relative flex h-screen overflow-hidden bg-transparent p-2 gap-2" data-testid="main-layout">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-[30rem] w-[30rem] rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute -right-24 bottom-[-8rem] h-[26rem] w-[26rem] rounded-full bg-zinc-500/12 blur-[120px]" />
      </div>
      <ServerSidebar
        servers={servers}
        currentServer={currentServer}
        onSelectServer={(server) => {
          void selectServer(server);
          setShowChannels(false);
        }}
        onRefreshServers={loadServers}
        view={view}
        onSwitchToDm={switchToDm}
        user={user}
        onLogout={logout}
        dmUnread={dmUnread}
        serverUnreadMap={serverUnreadMap}
        onManageServer={openServerSettingsFromRail}
        onDeleteServer={deleteServerFromRail}
      />

      {view === "server" && currentServer ? (
        <>
          {showChannels && <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden" onClick={() => setShowChannels(false)} />}
          {showMembers && <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden" onClick={() => setShowMembers(false)} />}

          <div className={`${showChannels ? "fixed left-[80px] top-2 bottom-2 z-50 h-[calc(100vh-1rem)]" : "hidden"} md:relative md:block md:h-full`}>
            <ChannelSidebar
              server={currentServer}
              channels={channels}
              currentChannel={currentChannel}
              onSelectChannel={(channel) => {
                void selectChannel(channel);
                setShowChannels(false);
              }}
              onRefreshChannels={refreshChannels}
              user={user}
              members={members}
              roles={roles}
              viewerContext={viewerContext}
              unreadMap={unreadMap}
              voiceEngineRef={voiceRef}
              onLogout={logout}
              onUserUpdated={setUser}
              onRefreshServers={loadServers}
              serverSettingsRequest={serverSettingsRequest}
            />
          </div>

          <div className="workspace-panel flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2 border-b workspace-divider bg-zinc-900/25 md:hidden shrink-0" data-testid="mobile-toolbar">
              <button onClick={() => setShowChannels(true)} data-testid="toggle-channels-mobile" className="workspace-icon-button">
                <List size={18} />
              </button>
              <span className="text-sm font-bold text-white flex-1 truncate" style={{ fontFamily: "Manrope" }}>
                {currentChannel ? `# ${currentChannel.name}` : currentServer?.name}
              </span>
              <button onClick={() => setShowMembers(true)} data-testid="toggle-members-mobile" className="workspace-icon-button">
                <UsersThree size={18} />
              </button>
            </div>
            <ChatArea
              channel={currentChannel}
              messages={messages}
              setMessages={setMessages}
              user={user}
              server={currentServer}
              serverId={currentServer?.id}
              members={members}
              roles={roles}
              viewerContext={viewerContext}
              onSendTyping={sendTyping}
              typingUsers={typingUsers[currentChannel?.id] || {}}
              onChannelRead={refreshUnread}
              hasOlderMessages={channelHasOlderMessages}
              onLoadOlderMessages={loadOlderChannelMessages}
              loadingOlderMessages={loadingOlderChannelMessages}
            />
          </div>

          <div className={`${showMembers ? "fixed right-2 top-2 bottom-2 z-50 h-[calc(100vh-1rem)]" : "hidden"} md:relative md:block md:h-full`}>
            <MemberSidebar
              members={members}
              roles={roles}
              serverId={currentServer?.id}
              server={currentServer}
              user={user}
              viewerContext={viewerContext}
              onStartDM={(dmUser) => {
                switchToDm();
                void selectDmUser(dmUser);
                setShowMembers(false);
              }}
              onRefreshMembers={refreshMembers}
            />
          </div>
        </>
      ) : view === "dm" ? (
        <>
          <div className="workspace-panel w-[280px] flex flex-col overflow-hidden" data-testid="dm-sidebar">
            <div className="h-12 flex items-center px-4 border-b workspace-divider bg-zinc-900/25 shrink-0">
              <h3 className="text-sm font-bold text-white" style={{ fontFamily: "Manrope" }}>{t("server.directMessages")}</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {dmConversations.map((conversation) => (
                <button
                  key={conversation.user.id}
                  onClick={() => void selectDmUser(conversation.user)}
                  data-testid={`dm-conv-${conversation.user.username}`}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                    currentDmUser?.id === conversation.user.id
                      ? "bg-cyan-500/12 text-white workspace-cyan-glow"
                      : "text-[#A1A1AA] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl bg-zinc-800/80 flex items-center justify-center text-sm font-bold shrink-0">
                    {conversation.user.avatar_url ? (
                      <img src={resolveAssetUrl(conversation.user.avatar_url, config?.assetBase)} alt={conversation.user.display_name || conversation.user.username || "avatar"} className="h-full w-full rounded-xl object-cover" />
                    ) : (
                      conversation.user.display_name?.[0]?.toUpperCase() || "?"
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{conversation.user.display_name}</p>
                    <p className="text-xs text-[#71717A] truncate">{conversation.last_message?.content}</p>
                  </div>
                  {conversation.unread_count > 0 && (
                    <span className="bg-cyan-500 text-zinc-950 text-xs rounded-full w-5 h-5 flex items-center justify-center shrink-0 font-bold">
                      {conversation.unread_count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {currentDmUser ? (
            <div className="workspace-panel flex-1 flex flex-col overflow-hidden" data-testid="dm-chat-area">
              <div className="h-12 flex items-center px-4 border-b workspace-divider bg-zinc-900/25 shrink-0">
                <div className="w-8 h-8 rounded-xl bg-zinc-800/80 flex items-center justify-center text-xs font-bold mr-3">
                  {currentDmUser.avatar_url ? (
                    <img src={resolveAssetUrl(currentDmUser.avatar_url, config?.assetBase)} alt={currentDmUser.display_name || currentDmUser.username || "avatar"} className="h-full w-full rounded-xl object-cover" />
                  ) : (
                    currentDmUser.display_name?.[0]?.toUpperCase()
                  )}
                </div>
                <span className="font-semibold text-sm">{currentDmUser.display_name}</span>
                <span className="ml-2 text-xs text-[#71717A]">@{currentDmUser.username}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {!e2eeReady ? (
                  <E2EEStatus
                    variant="guard"
                    scope="dm"
                    ready={e2eeReady}
                    isDesktopCapable={isDesktopCapable}
                    className="workspace-card p-6"
                  />
                ) : (
                  <>
                    {dmTrustNotice && (
                      <E2EEStatus
                        variant="notice"
                        messageKey="e2ee.deviceListChanged"
                        className="mb-4"
                      />
                    )}
                    {dmHasOlderMessages && (
                      <div className="flex justify-center pb-2">
                        <button
                          type="button"
                          onClick={() => void loadOlderDmMessages()}
                          disabled={loadingOlderDmMessages}
                          className="rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {loadingOlderDmMessages ? t("common.loading") : t("chat.loadOlderMessages")}
                        </button>
                      </div>
                    )}
                    {dmMessages.map((message) => (
                      <div key={message.id} className="flex gap-3 fade-in" data-testid={`dm-msg-${message.id}`}>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#27272A] text-xs font-bold">
                      {message.sender?.avatar_url ? (
                        <img src={resolveAssetUrl(message.sender.avatar_url, config?.assetBase)} alt={message.sender?.display_name || message.sender?.username || "avatar"} className="h-full w-full object-cover" />
                      ) : (
                        message.sender?.display_name?.[0]?.toUpperCase() || "?"
                      )}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold">{message.sender?.display_name}</span>
                        <span className="text-[10px] text-[#71717A]">{new Date(message.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-sm text-[#E4E4E7] mt-0.5">
                        {message.is_encrypted || message.is_e2ee ? (
                          <span className="flex items-center gap-1">
                            <ShieldCheck size={12} weight="fill" className="text-[#6366F1]" />
                            <DecryptedContent msg={message} config={config} />
                          </span>
                        ) : message.content}
                      </p>
                    </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
              {isDesktopCapable ? (
                <DmInput
                  userId={currentDmUser.id}
                  e2eeReady={e2eeReady}
                  onSent={(message) => setDmMessages((previous) => [...previous, message])}
                />
              ) : null}
            </div>
          ) : (
            <div className="workspace-panel flex-1 flex items-center justify-center text-[#71717A]">
              {t("dm.selectConversation")}
            </div>
          )}
        </>
      ) : (
        <div className="workspace-panel flex-1 flex items-center justify-center text-[#71717A]">
          {t("app.loading")}
        </div>
      )}
    </div>
  );
}

function DmInput({ userId, onSent, e2eeReady }) {
  const { t } = useTranslation();
  const { fetchDmRecipients, encryptForRecipients, uploadEncryptedAttachment } = useE2EE();
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const fileInputRef = useRef(null);

  const send = async (event) => {
    event.preventDefault();
    if ((!content.trim() && pendingAttachments.length === 0) || sending) return;

    setSending(true);
    try {
      let payload = { content: content.trim(), is_encrypted: false };
      if (e2eeReady) {
        const recipients = await fetchDmRecipients(userId);
        const attachmentRefs = [];
        const attachmentManifests = [];
        for (const attachment of pendingAttachments) {
          if (!attachment.localFile) continue;
          const uploaded = await uploadEncryptedAttachment({
            file: attachment.localFile,
            scopeKind: "dm",
            scopeId: userId,
            recipientsResponse: recipients,
          });
          attachmentRefs.push(uploaded.serverAttachment);
          attachmentManifests.push(uploaded.manifest);
        }
        const encrypted = await encryptForRecipients({
          text: content.trim(),
          attachments: attachmentManifests,
        }, recipients);
        payload = {
          content: "[Encrypted message]",
          attachments: attachmentRefs,
          encrypted_content: encrypted.ciphertext,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          sender_device_id: encrypted.sender_device_id,
          protocol_version: encrypted.protocol_version,
          is_encrypted: true,
          is_e2ee: true,
          key_envelopes: encrypted.key_envelopes,
        };
      }
      const res = await api.post(`/dm/${userId}`, payload);
      onSent(res.data);
      setContent("");
      setPendingAttachments([]);
    } catch {
      toast.error(t("dm.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10 MB).");
      event.target.value = "";
      return;
    }
    setPendingAttachments((previous) => [
      ...previous,
      {
        id: `${file.name}-${file.size}-${Date.now()}`,
        name: file.name,
        type: file.type,
        size_bytes: file.size,
        localFile: file,
      },
    ]);
    event.target.value = "";
  };

  return (
    <form onSubmit={send} className="p-4 border-t border-[#27272A]">
      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingAttachments.map((attachment) => (
            <div key={attachment.id} className="flex items-center gap-2 rounded-md border border-[#27272A] bg-[#121212] px-3 py-2 text-xs text-[#E4E4E7]">
              <Paperclip size={14} className="text-[#71717A]" />
              <span className="max-w-[240px] truncate">{attachment.name}</span>
              <button
                type="button"
                onClick={() => setPendingAttachments((previous) => previous.filter((entry) => entry.id !== attachment.id))}
                className="text-[#71717A] transition-colors hover:text-white"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileUpload}
          className="hidden"
          accept="image/*,.pdf,.txt,.zip,.doc,.docx"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!e2eeReady}
          className="rounded-lg border border-[#27272A]/50 bg-[#27272A] px-3 py-2.5 text-[#A1A1AA] transition-colors hover:text-white disabled:text-[#52525B]"
        >
          <Paperclip size={18} />
        </button>
        <input
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={e2eeReady ? t("dm.encryptedMessage") : t("e2ee.dmVerifyDevice")}
          disabled={!e2eeReady}
          data-testid="dm-message-input"
          className="flex-1 bg-[#27272A] border border-[#27272A]/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-[#52525B] outline-none focus:border-[#6366F1]/50 disabled:text-[#71717A]"
        />
        <button
          type="submit"
          disabled={!e2eeReady || (!content.trim() && pendingAttachments.length === 0) || sending}
          data-testid="dm-send-button"
          className="bg-[#6366F1] hover:bg-[#4F46E5] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {t("common.send")}
        </button>
      </div>
      {e2eeReady && (
        <p className="text-[10px] text-[#6366F1] mt-1 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" /> {t("dm.e2eeEncrypted")}
        </p>
      )}
    </form>
  );
}

function DecryptedContent({ msg, config }) {
  const { t } = useTranslation();
  const { decryptMessage, downloadAndDecryptAttachment, ready: e2eeReady } = useE2EE();
  const [payload, setPayload] = useState(null);
  const [statusText, setStatusText] = useState(null);

  const decrypt = useCallback(async () => {
    try {
      if (!e2eeReady) {
        setStatusText(t("e2ee.dmVerifyDevice"));
        return;
      }
      const decrypted = await decryptMessage(msg);
      setPayload(decrypted);
      setStatusText(decrypted?.text ? null : t("dm.cannotDecrypt"));
    } catch {
      setStatusText(t("dm.encryptedFallback"));
    }
  }, [decryptMessage, e2eeReady, msg, t]);

  useEffect(() => {
    if ((msg.is_encrypted || msg.is_e2ee) && (msg.encrypted_content || msg.ciphertext) && msg.nonce) {
      void decrypt();
    }
  }, [decrypt, msg.ciphertext, msg.encrypted_content, msg.is_e2ee, msg.is_encrypted, msg.nonce]);

  if (!msg.is_encrypted && !msg.is_e2ee) return msg.content;
  const hasText = typeof payload?.text === "string" && payload.text.length > 0;
  const attachments = payload?.attachments || msg.attachments || [];

  const renderAttachments = () => {
    if (!attachments.length) return null;
    return (
      <div className="mt-2 space-y-1">
        {attachments.map((attachment, index) => (
          <button
            key={`${attachment.blob_id || attachment.id || attachment.name || "attachment"}-${index}`}
            type="button"
            onClick={async () => {
              if (msg.is_e2ee) {
                const { url } = await downloadAndDecryptAttachment(attachment);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = attachment.name || "encrypted-attachment";
                anchor.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 5000);
                return;
              }
              if (attachment.url) {
                window.open(`${config?.assetBase || ""}${attachment.url}`, "_blank", "noopener,noreferrer");
              }
            }}
            className="flex items-center gap-2 rounded-md bg-[#111214] px-2.5 py-2 text-xs text-[#D4D4D8] transition-colors hover:bg-[#16181D] hover:text-white"
          >
            <Paperclip size={13} />
            <span className="truncate">{attachment.name}</span>
          </button>
        ))}
      </div>
    );
  };

  return (
    <span className="flex flex-col gap-1">
      {(hasText || (!attachments.length && (statusText || !payload))) && (
        <span className="italic text-[#A1A1AA]">
          {hasText ? payload.text : (statusText || t("dm.decrypting"))}
        </span>
      )}
      {renderAttachments()}
    </span>
  );
}
