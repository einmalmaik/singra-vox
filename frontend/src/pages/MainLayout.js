import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import api from "@/lib/api";
import { toast } from "sonner";
import ServerSidebar from "@/components/chat/ServerSidebar";
import ChannelSidebar from "@/components/chat/ChannelSidebar";
import ChatArea from "@/components/chat/ChatArea";
import MemberSidebar from "@/components/chat/MemberSidebar";
import { ShieldCheck, List, UsersThree, X } from "@phosphor-icons/react";
import { VoiceEngine } from "@/lib/voiceEngine";

export default function MainLayout() {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const voiceRef = useRef(null);

  const [servers, setServers] = useState([]);
  const [currentServer, setCurrentServer] = useState(null);
  const [channels, setChannels] = useState([]);
  const [currentChannel, setCurrentChannel] = useState(null);
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [roles, setRoles] = useState([]);

  // Mobile responsive
  const [showChannels, setShowChannels] = useState(false);
  const [showMembers, setShowMembers] = useState(false);

  const [view, setView] = useState("server");
  const [dmConversations, setDmConversations] = useState([]);
  const [currentDmUser, setCurrentDmUser] = useState(null);
  const [dmMessages, setDmMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState({});
  const [unreadMap, setUnreadMap] = useState({});
  const [dmUnread, setDmUnread] = useState(0);
  const [groupDms, setGroupDms] = useState([]);

  // State refs for WebSocket callback
  const currentChannelRef = useRef(currentChannel);
  const currentDmUserRef = useRef(currentDmUser);
  const currentServerRef = useRef(currentServer);
  useEffect(() => { currentChannelRef.current = currentChannel; }, [currentChannel]);
  useEffect(() => { currentDmUserRef.current = currentDmUser; }, [currentDmUser]);
  useEffect(() => { currentServerRef.current = currentServer; }, [currentServer]);

  // Load servers on mount + init E2EE keys + start unread polling
  useEffect(() => {
    loadServers();
    initE2EEKeys();
    const unreadInterval = setInterval(fetchUnread, 15000);
    fetchUnread();
    return () => clearInterval(unreadInterval);
  }, []);

  const initE2EEKeys = async () => {
    try {
      const { generateKeyPair, storeKeyPair, loadKeyPair } = await import("@/lib/crypto");
      let kp = loadKeyPair();
      if (!kp) {
        kp = await generateKeyPair();
        storeKeyPair(kp);
        await api.post("/keys/bundle", {
          identity_key: JSON.stringify(kp.publicKey),
          signed_pre_key: JSON.stringify(kp.publicKey),
          one_time_pre_keys: []
        });
      }
    } catch (e) {
      console.warn("E2EE key init:", e);
    }
  };

  const fetchUnread = async () => {
    try {
      const res = await api.get("/unread");
      setUnreadMap(res.data.channels || {});
      setDmUnread(res.data.dm_total || 0);
    } catch {}
  };

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
    loadGroupDms();
  };

  const loadGroupDms = async () => {
    try {
      const res = await api.get("/groups");
      setGroupDms(res.data);
    } catch {}
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
      // WebRTC voice signaling
      case "voice_offer":
      case "voice_answer":
      case "voice_ice":
        voiceRef.current?.handleSignal(data);
        break;
      default:
        break;
    }
  }, []);

  const sendSignal = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
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
        onSelectServer={(s) => { selectServer(s); setShowChannels(false); }}
        onRefreshServers={loadServers}
        view={view}
        onSwitchToDm={switchToDm}
        user={user}
        onLogout={logout}
        dmUnread={dmUnread}
      />

      {view === "server" && currentServer ? (
        <>
          {/* Mobile backdrop */}
          {showChannels && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setShowChannels(false)} />}
          {showMembers && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setShowMembers(false)} />}

          {/* Channel sidebar: always on desktop, toggle on mobile */}
          <div className={`${showChannels ? 'fixed left-[72px] top-0 bottom-0 z-50' : 'hidden'} md:relative md:block`}>
            <ChannelSidebar
              server={currentServer}
              channels={channels}
              currentChannel={currentChannel}
              onSelectChannel={(ch) => { selectChannel(ch); setShowChannels(false); }}
              onRefreshChannels={refreshChannels}
              user={user}
              members={members}
              roles={roles}
              onRefreshMembers={refreshMembers}
              unreadMap={unreadMap}
              voiceEngineRef={voiceRef}
              sendSignal={sendSignal}
            />
          </div>

          <div className="flex-1 flex flex-col min-w-0">
            {/* Mobile toolbar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#27272A] md:hidden shrink-0" data-testid="mobile-toolbar">
              <button onClick={() => setShowChannels(true)} data-testid="toggle-channels-mobile"
                className="p-1.5 rounded-md bg-[#27272A] text-[#A1A1AA]"><List size={18} /></button>
              <span className="text-sm font-bold text-white flex-1 truncate" style={{ fontFamily: 'Manrope' }}>
                {currentChannel ? `# ${currentChannel.name}` : currentServer?.name}
              </span>
              <button onClick={() => setShowMembers(true)} data-testid="toggle-members-mobile"
                className="p-1.5 rounded-md bg-[#27272A] text-[#A1A1AA]"><UsersThree size={18} /></button>
            </div>
            <ChatArea
              channel={currentChannel}
              messages={messages}
              setMessages={setMessages}
              user={user}
              serverId={currentServer?.id}
              onSendTyping={sendTyping}
              typingUsers={typingUsers[currentChannel?.id] || {}}
            />
          </div>

          {/* Member sidebar: always on desktop, toggle on mobile */}
          <div className={`${showMembers ? 'fixed right-0 top-0 bottom-0 z-50' : 'hidden'} md:relative md:block`}>
            <MemberSidebar
              members={members}
              roles={roles}
              serverId={currentServer?.id}
              user={user}
              onStartDM={(dmUser) => {
                switchToDm();
                selectDmUser(dmUser);
                setShowMembers(false);
              }}
              onRefreshMembers={refreshMembers}
            />
          </div>
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
                      <p className="text-sm text-[#E4E4E7] mt-0.5">
                        {msg.is_encrypted ? (
                          <span className="flex items-center gap-1">
                            <ShieldCheck size={12} weight="fill" className="text-[#6366F1]" />
                            <DecryptedContent msg={msg} currentUserId={user?.id} />
                          </span>
                        ) : msg.content}
                      </p>
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
  const [e2eeReady, setE2eeReady] = useState(false);
  const sharedKeyRef = useRef(null);

  useEffect(() => {
    initE2EE();
  }, [userId]);

  const initE2EE = async () => {
    try {
      const { loadKeyPair, deriveSharedKey } = await import("@/lib/crypto");
      const kp = loadKeyPair();
      if (!kp) { setE2eeReady(false); return; }
      const res = await api.get(`/keys/${userId}/bundle`);
      if (res.data.identity_key) {
        const recipientKey = JSON.parse(res.data.identity_key);
        const shared = await deriveSharedKey(kp.privateKey, recipientKey);
        sharedKeyRef.current = shared;
        setE2eeReady(true);
      }
    } catch {
      setE2eeReady(false);
    }
  };

  const send = async (e) => {
    e.preventDefault();
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
          is_encrypted: true
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
          value={content} onChange={e => setContent(e.target.value)}
          placeholder={e2eeReady ? "Encrypted message..." : "Send a message..."} data-testid="dm-message-input"
          className="flex-1 bg-[#27272A] border border-[#27272A]/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-[#52525B] outline-none focus:border-[#6366F1]/50"
        />
        <button
          type="submit" disabled={!content.trim() || sending} data-testid="dm-send-button"
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

  useEffect(() => {
    if (msg.is_encrypted && msg.encrypted_content && msg.nonce) {
      decrypt();
    }
  }, [msg.id]);

  const decrypt = async () => {
    try {
      const { loadKeyPair, deriveSharedKey, decryptMessage } = await import("@/lib/crypto");
      const kp = loadKeyPair();
      if (!kp) { setText("[Cannot decrypt - no keys]"); return; }
      const otherId = msg.sender_id === currentUserId ? msg.receiver_id : msg.sender_id;
      const res = await api.get(`/keys/${otherId}/bundle`);
      if (res.data.identity_key) {
        const otherPub = JSON.parse(res.data.identity_key);
        const shared = await deriveSharedKey(kp.privateKey, otherPub);
        const plain = await decryptMessage(shared, msg.encrypted_content, msg.nonce);
        setText(plain);
      } else {
        setText("[Cannot decrypt]");
      }
    } catch {
      setText("[Encrypted message]");
    }
  };

  if (!msg.is_encrypted) return msg.content;
  return <span className="italic text-[#A1A1AA]">{text || "Decrypting..."}</span>;
}
