import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, List, UsersThree } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/contexts/RuntimeContext";
import api from "@/lib/api";
import { consumePreferredServer } from "@/lib/inviteLinks";
import ServerSidebar from "@/components/chat/ServerSidebar";
import ChannelSidebar from "@/components/chat/ChannelSidebar";
import ChatArea from "@/components/chat/ChatArea";
import MemberSidebar from "@/components/chat/MemberSidebar";

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

export default function MainLayout() {
  const { user, token, logout, setUser } = useAuth();
  const { config } = useRuntime();
  const navigate = useNavigate();
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const voiceRef = useRef(null);
  const currentServerRef = useRef(null);
  const currentChannelRef = useRef(null);
  const currentDmUserRef = useRef(null);

  const [servers, setServers] = useState([]);
  const [currentServer, setCurrentServer] = useState(null);
  const [channels, setChannels] = useState([]);
  const [currentChannel, setCurrentChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [showChannels, setShowChannels] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [view, setView] = useState("server");
  const [dmConversations, setDmConversations] = useState([]);
  const [currentDmUser, setCurrentDmUser] = useState(null);
  const [dmMessages, setDmMessages] = useState([]);
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

  const loadServerSnapshot = useCallback(async (serverId) => {
    const [channelRes, memberRes, roleRes] = await Promise.all([
      api.get(`/servers/${serverId}/channels`),
      api.get(`/servers/${serverId}/members`),
      api.get(`/servers/${serverId}/roles`),
    ]);

    setChannels(channelRes.data);
    setMembers(memberRes.data);
    setRoles(roleRes.data);

    setCurrentChannel((previousChannel) => {
      if (previousChannel && channelRes.data.some((channel) => channel.id === previousChannel.id)) {
        return previousChannel;
      }

      return channelRes.data.find((channel) => channel.type === "text") || null;
    });
  }, []);

  const selectChannel = useCallback(async (channel) => {
    setCurrentChannel(channel);
    if (!channel || channel.type !== "text") {
      setMessages([]);
      return;
    }

    try {
      const res = await api.get(`/channels/${channel.id}/messages`);
      setMessages(res.data);
    } catch {
      setMessages([]);
    }
  }, []);

  const selectServer = useCallback(async (server) => {
    if (!server) return;
    setCurrentServer(server);
    setView("server");

    try {
      await loadServerSnapshot(server.id);
    } catch {
      toast.error("Failed to load server");
    }
  }, [loadServerSnapshot]);

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
        setUnreadMap({});
        setServerUnreadMap({});
        navigate("/onboarding");
        return;
      }

      // Invite accepts can hint which community should open next.
      const preferredServerId = consumePreferredServer();
      const activeServer =
        nextServers.find((server) => server.id === preferredServerId)
        || nextServers.find((server) => server.id === currentServerRef.current?.id)
        || nextServers[0];
      await selectServer(activeServer);
    } catch (error) {
      if (error.response?.status === 401) {
        navigate("/login");
      } else {
        toast.error("Failed to load servers");
      }
    }
  }, [navigate, selectServer]);

  const selectDmUser = useCallback(async (dmUser) => {
    setCurrentDmUser(dmUser);
    try {
      const res = await api.get(`/dm/${dmUser.id}`);
      setDmMessages(res.data);
    } catch {
      setDmMessages([]);
    }
  }, []);

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
    setMessages([]);
    setCurrentChannel(null);

    if (reasonLabel) {
      toast.error(reasonLabel);
    }

    await loadServers();
  }, [loadServers]);

  const handleWsEvent = useCallback(async (data) => {
    switch (data.type) {
      case "new_message":
        if (data.channel_id === currentChannelRef.current?.id) {
          setMessages((previous) => previous.some((message) => message.id === data.message.id) ? previous : [...previous, data.message]);
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
        break;

      case "member_kicked":
      case "member_banned":
        setMembers((previous) => removeMember(previous, data.user_id));
        setChannels((previous) => removeVoiceUser(previous, data.user_id));
        if (data.user_id === user?.id && data.server_id === currentServerRef.current?.id) {
          await handleRemovedFromServer(
            data.server_id,
            data.type === "member_kicked" ? "You were removed from this server" : "You were banned from this server",
          );
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

      case "voice_offer":
      case "voice_answer":
      case "voice_ice":
        voiceRef.current?.handleSignal(data);
        break;

      default:
        break;
    }
  }, [handleRemovedFromServer, loadDmConversations, refreshUnread, user?.id]);

  const connectWs = useCallback(() => {
    if (!token || !config?.wsBase) return;

    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(`${config.wsBase}/api/ws?token=${token}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        void handleWsEvent(data);
      } catch {
        // Ignore malformed socket payloads.
      }
    };

    ws.onclose = () => {
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
      reconnectTimer.current = setTimeout(connectWs, 3000);
    };

    ws.onerror = () => ws.close();
  }, [config?.wsBase, handleWsEvent, token]);

  useEffect(() => {
    void loadServers();
    const unreadInterval = window.setInterval(refreshUnread, 15000);
    void refreshUnread();
    return () => window.clearInterval(unreadInterval);
  }, [loadServers, refreshUnread]);

  useEffect(() => {
    if (!token) return undefined;
    connectWs();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, [connectWs, token]);

  useEffect(() => {
    if (currentChannel?.type === "text") {
      void selectChannel(currentChannel);
    }
  }, [currentChannel, selectChannel]);

  const sendTyping = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && currentChannelRef.current) {
      wsRef.current.send(JSON.stringify({ type: "typing", channel_id: currentChannelRef.current.id }));
    }
  }, []);

  const refreshChannels = useCallback(async () => {
    if (!currentServerRef.current) return;
    try {
      const res = await api.get(`/servers/${currentServerRef.current.id}/channels`);
      setChannels(res.data);
    } catch {
      // keep last state
    }
  }, []);

  const refreshMembers = useCallback(async () => {
    if (!currentServerRef.current) return;
    try {
      const res = await api.get(`/servers/${currentServerRef.current.id}/members`);
      setMembers(res.data);
    } catch {
      // keep last state
    }
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-[#0A0A0A]" data-testid="main-layout">
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
      />

      {view === "server" && currentServer ? (
        <>
          {showChannels && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setShowChannels(false)} />}
          {showMembers && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setShowMembers(false)} />}

          <div className={`${showChannels ? "fixed left-[72px] top-0 bottom-0 z-50 h-full" : "hidden"} md:relative md:block md:h-full`}>
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
              unreadMap={unreadMap}
              voiceEngineRef={voiceRef}
              onLogout={logout}
              onUserUpdated={setUser}
            />
          </div>

          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#27272A] md:hidden shrink-0" data-testid="mobile-toolbar">
              <button onClick={() => setShowChannels(true)} data-testid="toggle-channels-mobile" className="p-1.5 rounded-md bg-[#27272A] text-[#A1A1AA]">
                <List size={18} />
              </button>
              <span className="text-sm font-bold text-white flex-1 truncate" style={{ fontFamily: "Manrope" }}>
                {currentChannel ? `# ${currentChannel.name}` : currentServer?.name}
              </span>
              <button onClick={() => setShowMembers(true)} data-testid="toggle-members-mobile" className="p-1.5 rounded-md bg-[#27272A] text-[#A1A1AA]">
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
              onSendTyping={sendTyping}
              typingUsers={typingUsers[currentChannel?.id] || {}}
              onChannelRead={refreshUnread}
            />
          </div>

          <div className={`${showMembers ? "fixed right-0 top-0 bottom-0 z-50 h-full" : "hidden"} md:relative md:block md:h-full`}>
            <MemberSidebar
              members={members}
              roles={roles}
              serverId={currentServer?.id}
              server={currentServer}
              user={user}
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
          <div className="w-[280px] bg-[#121212] border-r border-[#27272A] flex flex-col" data-testid="dm-sidebar">
            <div className="h-12 flex items-center px-4 border-b border-[#27272A] shrink-0">
              <h3 className="text-sm font-bold text-white" style={{ fontFamily: "Manrope" }}>Direct Messages</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {dmConversations.map((conversation) => (
                <button
                  key={conversation.user.id}
                  onClick={() => void selectDmUser(conversation.user)}
                  data-testid={`dm-conv-${conversation.user.username}`}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                    currentDmUser?.id === conversation.user.id
                      ? "bg-[#27272A] text-white"
                      : "text-[#A1A1AA] hover:bg-[#27272A]/50 hover:text-white"
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-[#27272A] flex items-center justify-center text-sm font-bold shrink-0">
                    {conversation.user.display_name?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{conversation.user.display_name}</p>
                    <p className="text-xs text-[#71717A] truncate">{conversation.last_message?.content}</p>
                  </div>
                  {conversation.unread_count > 0 && (
                    <span className="bg-[#6366F1] text-white text-xs rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                      {conversation.unread_count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {currentDmUser ? (
            <div className="flex-1 flex flex-col bg-[#18181B]" data-testid="dm-chat-area">
              <div className="h-12 flex items-center px-4 border-b border-[#27272A] shrink-0">
                <div className="w-7 h-7 rounded-full bg-[#27272A] flex items-center justify-center text-xs font-bold mr-3">
                  {currentDmUser.display_name?.[0]?.toUpperCase()}
                </div>
                <span className="font-semibold text-sm">{currentDmUser.display_name}</span>
                <span className="ml-2 text-xs text-[#71717A]">@{currentDmUser.username}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {dmMessages.map((message) => (
                  <div key={message.id} className="flex gap-3 fade-in" data-testid={`dm-msg-${message.id}`}>
                    <div className="w-8 h-8 rounded-full bg-[#27272A] flex items-center justify-center text-xs font-bold shrink-0">
                      {message.sender?.display_name?.[0]?.toUpperCase() || "?"}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold">{message.sender?.display_name}</span>
                        <span className="text-[10px] text-[#71717A]">{new Date(message.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-sm text-[#E4E4E7] mt-0.5">
                        {message.is_encrypted ? (
                          <span className="flex items-center gap-1">
                            <ShieldCheck size={12} weight="fill" className="text-[#6366F1]" />
                            <DecryptedContent msg={message} currentUserId={user?.id} />
                          </span>
                        ) : message.content}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <DmInput userId={currentDmUser.id} onSent={(message) => setDmMessages((previous) => [...previous, message])} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-[#18181B] text-[#71717A]">
              Select a conversation
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[#18181B] text-[#71717A]">
          Loading...
        </div>
      )}
    </div>
  );
}

function DmInput({ userId, onSent }) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [e2eeReady, setE2eeReady] = useState(false);
  const sharedKeyRef = useRef(null);

  const initE2EE = useCallback(async () => {
    try {
      const { loadKeyPair, deriveSharedKey } = await import("@/lib/crypto");
      const keyPair = loadKeyPair();
      if (!keyPair) {
        setE2eeReady(false);
        return;
      }
      const res = await api.get(`/keys/${userId}/bundle`);
      if (res.data.identity_key) {
        const recipientKey = JSON.parse(res.data.identity_key);
        sharedKeyRef.current = await deriveSharedKey(keyPair.privateKey, recipientKey);
        setE2eeReady(true);
      } else {
        setE2eeReady(false);
      }
    } catch {
      setE2eeReady(false);
    }
  }, [userId]);

  useEffect(() => {
    void initE2EE();
  }, [initE2EE]);

  const send = async (event) => {
    event.preventDefault();
    if (!content.trim() || sending) return;

    setSending(true);
    try {
      let payload = { content: content.trim(), is_encrypted: false };
      if (e2eeReady && sharedKeyRef.current) {
        const { encryptMessage } = await import("@/lib/crypto");
        const encrypted = await encryptMessage(sharedKeyRef.current, content.trim());
        payload = {
          content: "[E2EE encrypted message]",
          encrypted_content: encrypted.ciphertext,
          nonce: encrypted.nonce,
          is_encrypted: true,
        };
      }
      const res = await api.post(`/dm/${userId}`, payload);
      onSent(res.data);
      setContent("");
    } catch {
      toast.error("Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={send} className="p-4 border-t border-[#27272A]">
      <div className="flex gap-2">
        <input
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={e2eeReady ? "Encrypted message..." : "Send a message..."}
          data-testid="dm-message-input"
          className="flex-1 bg-[#27272A] border border-[#27272A]/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-[#52525B] outline-none focus:border-[#6366F1]/50"
        />
        <button
          type="submit"
          disabled={!content.trim() || sending}
          data-testid="dm-send-button"
          className="bg-[#6366F1] hover:bg-[#4F46E5] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </div>
      {e2eeReady && (
        <p className="text-[10px] text-[#6366F1] mt-1 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" /> End-to-end encrypted
        </p>
      )}
    </form>
  );
}

function DecryptedContent({ msg, currentUserId }) {
  const [text, setText] = useState(null);

  const decrypt = useCallback(async () => {
    try {
      const { loadKeyPair, deriveSharedKey, decryptMessage } = await import("@/lib/crypto");
      const keyPair = loadKeyPair();
      if (!keyPair) {
        setText("[Cannot decrypt - no keys]");
        return;
      }
      const otherId = msg.sender_id === currentUserId ? msg.receiver_id : msg.sender_id;
      const res = await api.get(`/keys/${otherId}/bundle`);
      if (res.data.identity_key) {
        const otherPublicKey = JSON.parse(res.data.identity_key);
        const shared = await deriveSharedKey(keyPair.privateKey, otherPublicKey);
        const plain = await decryptMessage(shared, msg.encrypted_content, msg.nonce);
        setText(plain);
      } else {
        setText("[Cannot decrypt]");
      }
    } catch {
      setText("[Encrypted message]");
    }
  }, [currentUserId, msg]);

  useEffect(() => {
    if (msg.is_encrypted && msg.encrypted_content && msg.nonce) {
      void decrypt();
    }
  }, [decrypt, msg.encrypted_content, msg.is_encrypted, msg.nonce]);

  if (!msg.is_encrypted) return msg.content;
  return <span className="italic text-[#A1A1AA]">{text || "Decrypting..."}</span>;
}
