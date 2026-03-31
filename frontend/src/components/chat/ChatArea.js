import { useState, useRef, useEffect } from "react";
import {
  Hash, PaperPlaneRight, Paperclip, ChatText, Pencil, Trash, PushPin, PushPinSlash, X
} from "@phosphor-icons/react";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";
import SearchDialog from "@/components/modals/SearchDialog";
import ThreadPanel from "@/components/chat/ThreadPanel";
import PinnedMessagesPanel from "@/components/chat/PinnedMessagesPanel";
import NotificationPanel from "@/components/chat/NotificationPanel";
import { useRuntime } from "@/contexts/RuntimeContext";

const REACTIONS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F525}", "\u{1F440}", "\u{2705}", "\u{1F602}", "\u{1F914}"];

function renderMessageParts(content = "") {
  return content.split(/(@\w+)/g).map((part, index) => (
    part.startsWith("@")
      ? <span key={`${part}-${index}`} className="text-[#6366F1] font-medium bg-[#6366F1]/10 rounded px-0.5">{part}</span>
      : <span key={`${part}-${index}`}>{part}</span>
  ));
}

export default function ChatArea({ channel, messages, setMessages, user, serverId, onSendTyping, typingUsers }) {
  const { config } = useRuntime();
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [threadMsgId, setThreadMsgId] = useState(null);
  const [showReactions, setShowReactions] = useState(null);
  const [showPins, setShowPins] = useState(false);
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const typingTimeout = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Mark channel as read when viewing
  useEffect(() => {
    if (channel?.id) {
      api.post(`/channels/${channel.id}/read`).catch(() => {});
    }
  }, [channel?.id, messages.length]);

  const handleSend = async (e) => {
    e.preventDefault();
    if ((!content.trim() && pendingAttachments.length === 0) || !channel || sending) return;
    setSending(true);
    try {
      const res = await api.post(`/channels/${channel.id}/messages`, {
        content: content.trim(),
        attachments: pendingAttachments,
      });
      setMessages(prev => {
        if (prev.find(m => m.id === res.data.id)) return prev;
        return [...prev, res.data];
      });
      setContent("");
      setPendingAttachments([]);
    } catch (err) {
      toast.error("Failed to send message");
    } finally {
      setSending(false);
    }
  };

  const handleTyping = () => {
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    onSendTyping();
    typingTimeout.current = setTimeout(() => {}, 3000);
  };

  const handleEdit = async (msgId) => {
    if (!editContent.trim()) return;
    try {
      const res = await api.put(`/messages/${msgId}`, { content: editContent.trim() });
      setMessages(prev => prev.map(m => m.id === msgId ? res.data : m));
      setEditingId(null);
    } catch {
      toast.error("Failed to edit");
    }
  };

  const handleDelete = async (msgId) => {
    try {
      await api.delete(`/messages/${msgId}`);
      setMessages(prev => prev.filter(m => m.id !== msgId));
    } catch {
      toast.error("Failed to delete");
    }
  };

  const handleReaction = async (msgId, emoji) => {
    try {
      const res = await api.post(`/messages/${msgId}/reactions/${encodeURIComponent(emoji)}`);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions: res.data.reactions } : m));
    } catch {}
    setShowReactions(null);
  };

  const handlePin = async (msgId) => {
    try {
      await api.post(`/messages/${msgId}/pin`);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_pinned: true } : m));
      toast.success("Message pinned");
    } catch { toast.error("Failed to pin"); }
  };

  const handleUnpin = async (msgId) => {
    try {
      await api.delete(`/messages/${msgId}/pin`);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, is_pinned: false } : m));
    } catch {}
  };

  const saveTopic = async () => {
    try {
      await api.put(`/channels/${channel.id}/topic`, { topic: topicDraft });
      toast.success("Topic updated");
      setEditingTopic(false);
    } catch { toast.error("Failed to update topic"); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10 MB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(',')[1];
      try {
        const uploadRes = await api.post('/upload', {
          data: base64, name: file.name, type: file.type
        });
        setPendingAttachments(prev => [
          ...prev,
          { id: uploadRes.data.id, name: file.name, type: file.type, url: uploadRes.data.url },
        ]);
      } catch {
        toast.error("Upload failed");
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const typingNames = Object.values(typingUsers);
  const removePendingAttachment = (attachmentId) => {
    setPendingAttachments(prev => prev.filter((attachment) => attachment.id !== attachmentId));
  };

  if (!channel) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#18181B] text-[#71717A]" data-testid="no-channel-selected">
        <p>Select a channel to start chatting</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-w-0 min-h-0" data-testid="chat-area">
      <div className="flex-1 flex flex-col bg-[#18181B] min-w-0">
        {/* Header */}
        <div className="h-12 flex items-center justify-between px-4 border-b border-[#27272A] shrink-0" data-testid="chat-header">
          <div className="flex items-center min-w-0 flex-1">
            <Hash size={20} weight="bold" className="text-[#71717A] mr-2 shrink-0" />
            <h3 className="text-sm font-bold text-white shrink-0" style={{ fontFamily: 'Manrope' }}>{channel.name}</h3>
            {editingTopic ? (
              <div className="flex items-center gap-1 ml-3 border-l border-[#27272A] pl-3 flex-1 min-w-0">
                <input value={topicDraft} onChange={e => setTopicDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveTopic(); if (e.key === 'Escape') setEditingTopic(false); }}
                  className="flex-1 bg-[#27272A] rounded px-2 py-0.5 text-xs text-white outline-none" autoFocus data-testid="topic-edit-input" />
                <button onClick={saveTopic} className="text-[#6366F1] text-xs font-medium">Save</button>
                <button onClick={() => setEditingTopic(false)} className="text-[#71717A] text-xs">Cancel</button>
              </div>
            ) : channel.topic ? (
              <button onClick={() => { setTopicDraft(channel.topic); setEditingTopic(true); }}
                className="ml-3 text-xs text-[#71717A] truncate border-l border-[#27272A] pl-3 hidden md:inline hover:text-[#A1A1AA] transition-colors"
                data-testid="topic-display">
                {channel.topic}
              </button>
            ) : (
              <button onClick={() => { setTopicDraft(""); setEditingTopic(true); }}
                className="ml-3 text-xs text-[#52525B] border-l border-[#27272A] pl-3 hidden md:inline hover:text-[#71717A] transition-colors">
                Set a topic...
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => setShowPins(!showPins)} data-testid="pins-button"
                    className={`p-1.5 rounded hover:bg-[#27272A] transition-colors ${showPins ? 'text-[#F59E0B]' : 'text-[#71717A] hover:text-white'}`}>
                    <PushPin size={16} weight={showPins ? "fill" : "bold"} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>Pinned Messages</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <NotificationPanel />
            <SearchDialog serverId={serverId} />
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-2" data-testid="messages-list">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-[#71717A]">
              <Hash size={48} weight="bold" className="mb-4 opacity-30" />
              <p className="text-lg font-bold" style={{ fontFamily: 'Manrope' }}>Welcome to #{channel.name}</p>
              <p className="text-sm">This is the start of the channel.</p>
            </div>
          )}

          {messages.map((msg, i) => {
            const prevMsg = messages[i - 1];
            const sameAuthor = prevMsg?.author_id === msg.author_id;
            const timeDiff = prevMsg ? (new Date(msg.created_at) - new Date(prevMsg.created_at)) / 60000 : 999;
            const compact = sameAuthor && timeDiff < 5;

            return (
              <div
                key={msg.id}
                className={`message-item group relative flex gap-3 py-0.5 px-2 rounded-md ${compact ? 'mt-0' : 'mt-3'}`}
                data-testid={`message-${msg.id}`}
              >
                {!compact ? (
                  <div className="w-10 h-10 rounded-full bg-[#27272A] flex items-center justify-center text-sm font-bold shrink-0 mt-0.5">
                    {msg.author?.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                ) : (
                  <div className="w-10 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  {!compact && (
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-sm font-semibold" style={{ color: msg.author?.role === 'admin' ? '#E74C3C' : '#FFFFFF' }}>
                        {msg.author?.display_name || msg.author?.username || 'Unknown'}
                      </span>
                      <span className="text-[10px] text-[#52525B]">
                        {new Date(msg.created_at).toLocaleString()}
                      </span>
                      {msg.edited_at && <span className="text-[10px] text-[#52525B]">(edited)</span>}
                    </div>
                  )}

                  {editingId === msg.id ? (
                    <div className="flex gap-2">
                      <input
                        value={editContent} onChange={e => setEditContent(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleEdit(msg.id); if (e.key === 'Escape') setEditingId(null); }}
                        className="flex-1 bg-[#27272A] rounded px-2 py-1 text-sm text-white outline-none"
                        data-testid="edit-message-input" autoFocus
                      />
                      <button onClick={() => handleEdit(msg.id)} className="text-[#6366F1] text-xs font-medium">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-[#71717A] text-xs">Cancel</button>
                    </div>
                  ) : (
                    <>
                      {msg.is_pinned && (
                        <div className="flex items-center gap-1 text-[10px] text-[#F59E0B] mb-0.5">
                          <PushPin size={10} weight="fill" /> Pinned
                        </div>
                      )}
                      {msg.content ? (
                        <p className="text-sm text-[#E4E4E7] break-words whitespace-pre-wrap">
                          {renderMessageParts(msg.content)}
                        </p>
                      ) : null}

                  {/* Attachments */}
                  {msg.attachments?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {msg.attachments.map((att, j) => (
                        <div key={j}>
                          {att.type?.startsWith('image/') ? (
                            <img src={att.url ? `${config?.assetBase || ""}${att.url}` : att.data} alt={att.name}
                              className="max-w-md max-h-80 rounded-md border border-[#27272A]" />
                          ) : (
                            <a href={att.url ? `${config?.assetBase || ""}${att.url}` : '#'}
                              className="flex items-center gap-2 bg-[#27272A] rounded px-3 py-2 text-xs text-[#A1A1AA] hover:text-white transition-colors inline-block"
                              target="_blank" rel="noopener noreferrer">
                              <Paperclip size={14} /> {att.name}
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Reactions */}
                  {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {Object.entries(msg.reactions).map(([emoji, users]) => (
                        <button
                          key={emoji} onClick={() => handleReaction(msg.id, emoji)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                            users.includes(user?.id)
                              ? 'bg-[#6366F1]/20 border-[#6366F1]/40 text-[#6366F1]'
                              : 'bg-[#27272A] border-[#27272A] text-[#A1A1AA] hover:border-[#6366F1]/40'
                          }`}
                        >
                          <span>{emoji}</span><span>{users.length}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Thread indicator */}
                  {(msg.thread_count > 0) && (
                    <button onClick={() => setThreadMsgId(msg.id)} data-testid={`thread-btn-${msg.id}`}
                      className="flex items-center gap-1.5 mt-1.5 text-[#6366F1] text-xs font-medium hover:text-[#4F46E5] transition-colors">
                      <ChatText size={14} weight="bold" />
                      {msg.thread_count} {msg.thread_count === 1 ? 'reply' : 'replies'}
                    </button>
                  )}
                    </>
                  )}
                </div>

                {/* Hover actions */}
                <div className="absolute right-2 -top-3 hidden group-hover:flex bg-[#121212] border border-[#27272A] rounded-md overflow-hidden shadow-lg z-10">
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button onClick={() => setShowReactions(showReactions === msg.id ? null : msg.id)}
                          className="px-1.5 py-1 hover:bg-[#27272A] transition-colors text-[#A1A1AA] hover:text-white">
                          <span className="text-xs">+</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>React</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button onClick={() => setThreadMsgId(msg.id)} data-testid={`open-thread-${msg.id}`}
                          className="px-1.5 py-1 hover:bg-[#27272A] transition-colors text-[#A1A1AA] hover:text-white">
                          <ChatText size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>Reply in Thread</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {msg.author_id === user?.id && (
                    <>
                      <button onClick={() => { setEditingId(msg.id); setEditContent(msg.content); }}
                        className="px-1.5 py-1 hover:bg-[#27272A] transition-colors" data-testid={`edit-msg-${msg.id}`}>
                        <Pencil size={14} className="text-[#A1A1AA]" />
                      </button>
                      <button onClick={() => handleDelete(msg.id)}
                        className="px-1.5 py-1 hover:bg-[#EF4444]/20 transition-colors" data-testid={`delete-msg-${msg.id}`}>
                        <Trash size={14} className="text-[#EF4444]" />
                      </button>
                    </>
                  )}
                  <button onClick={() => msg.is_pinned ? handleUnpin(msg.id) : handlePin(msg.id)}
                    data-testid={`pin-msg-${msg.id}`}
                    className={`px-1.5 py-1 hover:bg-[#27272A] transition-colors ${msg.is_pinned ? 'text-[#F59E0B]' : 'text-[#A1A1AA]'}`}>
                    {msg.is_pinned ? <PushPinSlash size={14} /> : <PushPin size={14} />}
                  </button>
                </div>

                {/* Emoji picker popover */}
                {showReactions === msg.id && (
                  <div className="absolute right-2 top-6 bg-[#121212] border border-[#27272A] rounded-lg p-2 flex gap-1 flex-wrap w-48 z-20 shadow-xl">
                    {REACTIONS.map(r => (
                      <button key={r} onClick={() => handleReaction(msg.id, r)}
                        className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#27272A] text-base transition-colors">
                        {r}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Typing */}
        {typingNames.length > 0 && (
          <div className="px-4 py-1 text-xs text-[#71717A]" data-testid="typing-indicator">
            <span className="typing-dot inline-block w-1 h-1 bg-[#71717A] rounded-full mr-0.5" />
            <span className="typing-dot inline-block w-1 h-1 bg-[#71717A] rounded-full mr-0.5" />
            <span className="typing-dot inline-block w-1 h-1 bg-[#71717A] rounded-full mr-2" />
            {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing...
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSend} className="p-4 pt-2" data-testid="message-form">
          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {pendingAttachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center gap-2 rounded-md border border-[#27272A] bg-[#121212] px-3 py-2 text-xs text-[#E4E4E7]">
                  <Paperclip size={14} className="text-[#71717A]" />
                  <span className="max-w-[240px] truncate">{attachment.name}</span>
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(attachment.id)}
                    className="text-[#71717A] transition-colors hover:text-white"
                    data-testid={`remove-attachment-${attachment.id}`}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 bg-[#27272A] rounded-lg border border-[#27272A]/50 px-3 py-2.5">
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*,.pdf,.txt,.zip,.doc,.docx" />
            <button type="button" onClick={() => fileInputRef.current?.click()} data-testid="file-upload-button"
              className="text-[#71717A] hover:text-white transition-colors shrink-0">
              <Paperclip size={18} />
            </button>
            <input
              value={content}
              onChange={e => { setContent(e.target.value); handleTyping(); }}
              placeholder={`Message #${channel.name}`}
              data-testid="message-input"
              className="flex-1 bg-transparent text-sm text-white placeholder:text-[#52525B] outline-none"
            />
            <button type="submit" disabled={(!content.trim() && pendingAttachments.length === 0) || sending} data-testid="send-message-button"
              className="text-[#6366F1] hover:text-[#4F46E5] disabled:text-[#52525B] transition-colors shrink-0">
              <PaperPlaneRight size={20} weight="fill" />
            </button>
          </div>
        </form>
      </div>

      {/* Pinned messages panel */}
      {showPins && (
        <PinnedMessagesPanel channelId={channel.id} onClose={() => setShowPins(false)} />
      )}

      {/* Thread panel */}
      {threadMsgId && (
        <ThreadPanel
          messageId={threadMsgId}
          channelId={channel.id}
          onClose={() => setThreadMsgId(null)}
          user={user}
        />
      )}
    </div>
  );
}
