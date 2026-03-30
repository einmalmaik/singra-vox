import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import ServerSidebar from "@/components/chat/ServerSidebar";
import ChannelSidebar from "@/components/chat/ChannelSidebar";
import ChatArea from "@/components/chat/ChatArea";
import MemberSidebar from "@/components/chat/MemberSidebar";
import { toast } from "sonner";

export default function MainLayout() {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);

  const [servers, setServers] = useState([]);
  const [currentServer, setCurrentServer] = useState(null);
  const [channels, setChannels] = useState([]);
  const [currentChannel, setCurrentChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);

  const [view, setView] = useState("server");
  const [dmConversations, setDmConversations] = useState([]);
  const [currentDmUser, setCurrentDmUser] = useState(null);
  const [dmMessages, setDmMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});

  // State refs for WebSocket callback
  const currentChannelRef = useRef(currentChannel);
  const currentDmUserRef = useRef(currentDmUser);
  const currentServerRef = useRef(currentServer);
  useEffect(() => { currentChannelRef.current = currentChannel; }, [currentChannel]);
  useEffect(() => { currentDmUserRef.current = currentDmUser; }, [currentDmUser]);
  useEffect(() => { currentServerRef.current = currentServer; }, [currentServer]);

  // Load servers on mount
  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      const res = await api.get("/servers");
      setServers(res.data);
      if (res.data.length === 0) {
        navigate("/setup");
      } else if (!currentServerRef.current) {
        selectServer(res.data[0]);
      }
    } catch (err) {
      if (err.response?.status === 401) navigate("/login");
    }
  };

  const selectServer = async (server) => {
    setCurrentServer(server);
    setView("server");
    try {
      const [chRes, memRes, roleRes] = await Promise.all([
        api.get(`/servers/${server.id}/channels`),
        api.get(`/servers/${server.id}/members`),
        api.get(`/servers/${server.id}/roles`)
      ]);
      setChannels(chRes.data);
      setMembers(memRes.data);
      setRoles(roleRes.data);
      const textChs = chRes.data.filter(c => c.type === "text");
      if (textChs.length > 0) selectChannel(textChs[0]);
      else setCurrentChannel(null);
    } catch (err) {
      toast.error("Failed to load server");
    }
  };

  const selectChannel = async (channel) => {
    setCurrentChannel(channel);
    if (channel.type === "text") {
      try {
        const res = await api.get(`/channels/${channel.id}/messages`);
        setMessages(res.data);
      } catch {
        setMessages([]);
      }
    }
  };

  const loadDmConversations = async () => {
    try {
      const res = await api.get("/dm/conversations");
      setDmConversations(res.data);
    } catch {
      setDmConversations([]);
    }
  };

  const selectDmUser = async (dmUser) => {
    setCurrentDmUser(dmUser);
    try {
      const res = await api.get(`/dm/${dmUser.id}`);
      setDmMessages(res.data);
    } catch {
      setDmMessages([]);
    }
  };

  const switchToDm = () => {
    setView("dm");
    loadDmConversations();
  };

  // WebSocket
  const connectWs = useCallback(() => {
    if (!token) return;
    const base = process.env.REACT_APP_BACKEND_URL.replace('https://', 'wss://').replace('http://', 'ws://');
    const ws = new WebSocket(`${base}/api/ws?token=${token}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWsEvent(data);
      } catch {}
    };

    ws.onclose = () => {
      reconnectTimer.current = setTimeout(connectWs, 3000);
    };

    ws.onerror = () => ws.close();
  }, [token]);

  useEffect(() => {
    if (token) connectWs();
    return () => {
      if (wsRef.current) wsRef.current.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [token, connectWs]);

  const handleWsEvent = useCallback((data) => {
    switch (data.type) {
      case "new_message":
        if (data.channel_id === currentChannelRef.current?.id) {
          setMessages(prev => [...prev, data.message]);
        }
        break;
      case "message_edit":
        setMessages(prev => prev.map(m => m.id === data.message.id ? data.message : m));
        break;
      case "message_delete":
        setMessages(prev => prev.filter(m => m.id !== data.message_id));
        break;
      case "dm_message":
        if (data.message.sender_id === currentDmUserRef.current?.id) {
          setDmMessages(prev => [...prev, data.message]);
        }
        toast.info(`DM from ${data.message.sender?.display_name || 'someone'}`);
        break;
      case "typing":
        setTypingUsers(prev => {
          const ch = { ...(prev[data.channel_id] || {}), [data.user_id]: data.username };
          return { ...prev, [data.channel_id]: ch };
        });
        setTimeout(() => {
          setTypingUsers(prev => {
            const ch = { ...(prev[data.channel_id] || {}) };
            delete ch[data.user_id];
            return { ...prev, [data.channel_id]: ch };
          });
        }, 3000);
        break;
      case "channel_create":
        setChannels(prev => [...prev, data.channel]);
        break;
      case "channel_delete":
        setChannels(prev => prev.filter(c => c.id !== data.channel_id));
        break;
      case "voice_join":
        setChannels(prev => prev.map(c => {
          if (c.id === data.channel_id) {
            const states = [...(c.voice_states || []), data.state];
            return { ...c, voice_states: states };
          }
          return c;
        }));
        break;
      case "voice_leave":
        setChannels(prev => prev.map(c => {
          if (c.id === data.channel_id) {
            return { ...c, voice_states: (c.voice_states || []).filter(s => s.user_id !== data.user_id) };
          }
          return c;
        }));
        break;
      case "voice_state_update":
        setChannels(prev => prev.map(c => {
          if (c.id === data.channel_id) {
            return { ...c, voice_states: (c.voice_states || []).map(s => s.user_id === data.user_id ? { ...s, ...data.state } : s) };
          }
          return c;
        }));
        break;
      case "member_joined":
        setMembers(prev => [...prev, { user: data.user, roles: [], user_id: data.user.id }]);
        break;
      case "member_kicked":
      case "member_banned":
        setMembers(prev => prev.filter(m => m.user_id !== data.user_id));
        break;
      default:
        break;
    }
  }, []);

  const sendTyping = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN && currentChannel) {
      wsRef.current.send(JSON.stringify({ type: "typing", channel_id: currentChannel.id }));
    }
  }, [currentChannel]);

  const refreshChannels = async () => {
    if (!currentServer) return;
    try {
      const res = await api.get(`/servers/${currentServer.id}/channels`);
      setChannels(res.data);
    } catch {}
  };

  const refreshMembers = async () => {
    if (!currentServer) return;
    try {
      const res = await api.get(`/servers/${currentServer.id}/members`);
      setMembers(res.data);
    } catch {}
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0A0A0A]" data-testid="main-layout">
      <ServerSidebar
        servers={servers}
        currentServer={currentServer}
        onSelectServer={selectServer}
        onRefreshServers={loadServers}
        view={view}
        onSwitchToDm={switchToDm}
        user={user}
        onLogout={logout}
      />

      {view === "server" && currentServer ? (
        <>
          <ChannelSidebar
            server={currentServer}
            channels={channels}
            currentChannel={currentChannel}
            onSelectChannel={selectChannel}
            onRefreshChannels={refreshChannels}
            user={user}
            members={members}
            roles={roles}
            onRefreshMembers={refreshMembers}
          />
          <ChatArea
            channel={currentChannel}
            messages={messages}
            setMessages={setMessages}
            user={user}
            serverId={currentServer?.id}
            onSendTyping={sendTyping}
            typingUsers={typingUsers[currentChannel?.id] || {}}
          />
          <MemberSidebar
            members={members}
            roles={roles}
            serverId={currentServer?.id}
            user={user}
            onStartDM={(dmUser) => {
              switchToDm();
              selectDmUser(dmUser);
            }}
            onRefreshMembers={refreshMembers}
          />
        </>
      ) : view === "dm" ? (
        <>
          <div className="w-[240px] bg-[#121212] border-r border-[#27272A] flex flex-col" data-testid="dm-sidebar">
            <div className="h-12 flex items-center px-4 border-b border-[#27272A] shrink-0">
              <h3 className="text-sm font-bold text-white" style={{ fontFamily: 'Manrope' }}>Direct Messages</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {dmConversations.map(conv => (
                <button
                  key={conv.user.id}
                  onClick={() => selectDmUser(conv.user)}
                  data-testid={`dm-conv-${conv.user.username}`}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                    currentDmUser?.id === conv.user.id ? 'bg-[#27272A] text-white' : 'text-[#A1A1AA] hover:bg-[#27272A]/50 hover:text-white'
                  }`}
                >
                  <div className="w-8 h-8 rounded-full bg-[#27272A] flex items-center justify-center text-sm font-bold shrink-0">
                    {conv.user.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{conv.user.display_name}</p>
                    <p className="text-xs text-[#71717A] truncate">{conv.last_message?.content}</p>
                  </div>
                  {conv.unread_count > 0 && (
                    <span className="bg-[#6366F1] text-white text-xs rounded-full w-5 h-5 flex items-center justify-center shrink-0">
                      {conv.unread_count}
                    </span>
                  )}
                </button>
              ))}
              {dmConversations.length === 0 && (
                <p className="text-[#71717A] text-xs text-center mt-8 px-4">
                  No conversations yet. Start a DM from a member's profile.
                </p>
              )}
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
                {dmMessages.map(msg => (
                  <div key={msg.id} className="flex gap-3 fade-in" data-testid={`dm-msg-${msg.id}`}>
                    <div className="w-8 h-8 rounded-full bg-[#27272A] flex items-center justify-center text-xs font-bold shrink-0">
                      {msg.sender?.display_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold">{msg.sender?.display_name}</span>
                        <span className="text-[10px] text-[#71717A]">{new Date(msg.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-sm text-[#E4E4E7] mt-0.5">{msg.content}</p>
                      {msg.is_encrypted && <span className="text-[10px] text-[#6366F1]">E2EE</span>}
                    </div>
                  </div>
                ))}
              </div>
              <DmInput userId={currentDmUser.id} onSent={(msg) => setDmMessages(prev => [...prev, msg])} />
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

  const send = async (e) => {
    e.preventDefault();
    if (!content.trim() || sending) return;
    setSending(true);
    try {
      const res = await api.post(`/dm/${userId}`, { content: content.trim() });
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
          value={content} onChange={e => setContent(e.target.value)}
          placeholder="Send a message..." data-testid="dm-message-input"
          className="flex-1 bg-[#27272A] border border-[#27272A]/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-[#52525B] outline-none focus:border-[#6366F1]/50"
        />
        <button
          type="submit" disabled={!content.trim() || sending} data-testid="dm-send-button"
          className="bg-[#6366F1] hover:bg-[#4F46E5] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          Send
        </button>
      </div>
    </form>
  );
}
