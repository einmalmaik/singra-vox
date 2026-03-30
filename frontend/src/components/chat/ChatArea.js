import { useState, useRef, useEffect, useCallback } from "react";
import { Hash, PaperPlaneRight, Smiley, Paperclip, Pencil, Trash } from "@phosphor-icons/react";
import api from "@/lib/api";
import { toast } from "sonner";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";

const REACTIONS = ["thumbsup", "heart", "fire", "eyes", "check"];

export default function ChatArea({ channel, messages, setMessages, user, serverId, onSendTyping, typingUsers }) {
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const messagesEndRef = useRef(null);
  const typingTimeout = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!content.trim() || !channel || sending) return;
    setSending(true);
    try {
      const res = await api.post(`/channels/${channel.id}/messages`, {
        content: content.trim(), attachments: []
      });
      // Message will come via WebSocket, but also add locally as fallback
      setMessages(prev => {
        if (prev.find(m => m.id === res.data.id)) return prev;
        return [...prev, res.data];
      });
      setContent("");
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
      const res = await api.post(`/messages/${msgId}/reactions/${emoji}`);
      setMessages(prev => prev.map(m => m.id === msgId ? { ...m, reactions: res.data.reactions } : m));
    } catch {}
  };

  const typingNames = Object.values(typingUsers);

  if (!channel) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#18181B] text-[#71717A]" data-testid="no-channel-selected">
        <p>Select a channel to start chatting</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#18181B] min-w-0" data-testid="chat-area">
      {/* Header */}
      <div className="h-12 flex items-center px-4 border-b border-[#27272A] shrink-0" data-testid="chat-header">
        <Hash size={20} weight="bold" className="text-[#71717A] mr-2" />
        <h3 className="text-sm font-bold text-white" style={{ fontFamily: 'Manrope' }}>{channel.name}</h3>
        {channel.topic && (
          <span className="ml-3 text-xs text-[#71717A] truncate border-l border-[#27272A] pl-3">{channel.topic}</span>
        )}
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
                      value={editContent}
                      onChange={e => setEditContent(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleEdit(msg.id); if (e.key === 'Escape') setEditingId(null); }}
                      className="flex-1 bg-[#27272A] rounded px-2 py-1 text-sm text-white outline-none"
                      data-testid="edit-message-input"
                      autoFocus
                    />
                    <button onClick={() => handleEdit(msg.id)} className="text-[#6366F1] text-xs">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-[#71717A] text-xs">Cancel</button>
                  </div>
                ) : (
                  <p className="text-sm text-[#E4E4E7] break-words whitespace-pre-wrap">{msg.content}</p>
                )}

                {/* Attachments */}
                {msg.attachments?.map((att, j) => (
                  <div key={j} className="mt-2">
                    {att.type?.startsWith('image/') ? (
                      <img src={att.data} alt={att.name} className="max-w-md max-h-80 rounded-md" />
                    ) : (
                      <div className="bg-[#27272A] rounded px-3 py-2 text-xs text-[#A1A1AA] inline-block">{att.name}</div>
                    )}
                  </div>
                ))}

                {/* Reactions */}
                {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {Object.entries(msg.reactions).map(([emoji, users]) => (
                      <button
                        key={emoji}
                        onClick={() => handleReaction(msg.id, emoji)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                          users.includes(user?.id)
                            ? 'bg-[#6366F1]/20 border-[#6366F1]/40 text-[#6366F1]'
                            : 'bg-[#27272A] border-[#27272A] text-[#A1A1AA] hover:border-[#6366F1]/40'
                        }`}
                        data-testid={`reaction-${emoji}-${msg.id}`}
                      >
                        <span>{emoji}</span>
                        <span>{users.length}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Message actions */}
              <div className="absolute right-2 -top-3 hidden group-hover:flex bg-[#121212] border border-[#27272A] rounded-md overflow-hidden">
                <TooltipProvider delayDuration={100}>
                  {REACTIONS.map(r => (
                    <Tooltip key={r}>
                      <TooltipTrigger asChild>
                        <button onClick={() => handleReaction(msg.id, r)}
                          className="px-1.5 py-1 hover:bg-[#27272A] text-xs transition-colors" data-testid={`react-btn-${r}`}>
                          {r}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>{r}</p></TooltipContent>
                    </Tooltip>
                  ))}
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
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Typing indicator */}
      {typingNames.length > 0 && (
        <div className="px-4 py-1 text-xs text-[#71717A]" data-testid="typing-indicator">
          <span className="typing-dot inline-block w-1 h-1 bg-[#71717A] rounded-full mr-0.5" />
          <span className="typing-dot inline-block w-1 h-1 bg-[#71717A] rounded-full mr-0.5" />
          <span className="typing-dot inline-block w-1 h-1 bg-[#71717A] rounded-full mr-2" />
          {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing...
        </div>
      )}

      {/* Message input */}
      <form onSubmit={handleSend} className="p-4 pt-0" data-testid="message-form">
        <div className="flex items-center gap-2 bg-[#27272A] rounded-lg border border-[#27272A]/50 px-4 py-2.5">
          <input
            value={content}
            onChange={e => { setContent(e.target.value); handleTyping(); }}
            placeholder={`Message #${channel.name}`}
            data-testid="message-input"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-[#52525B] outline-none"
          />
          <button type="submit" disabled={!content.trim() || sending} data-testid="send-message-button"
            className="text-[#6366F1] hover:text-[#4F46E5] disabled:text-[#52525B] transition-colors">
            <PaperPlaneRight size={20} weight="fill" />
          </button>
        </div>
      </form>
    </div>
  );
}
