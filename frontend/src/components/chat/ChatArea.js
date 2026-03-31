import { useState, useRef, useEffect, useMemo } from "react";
import {
  Hash, PaperPlaneRight, Paperclip, ChatText, Pencil, Trash, PushPin, PushPinSlash, X, At
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
import MessageReferencePreview from "@/components/chat/MessageReferencePreview";
import { useRuntime } from "@/contexts/RuntimeContext";
import { buildWorkspaceCapabilities } from "@/lib/workspacePermissions";
import {
  applyMentionSuggestion,
  buildMentionPayload,
  buildMentionSuggestions,
  findActiveMention,
  normalizeSelectedMentions,
  renderMessageContent,
} from "@/lib/messageMentions";

const REACTIONS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F525}", "\u{1F440}", "\u{2705}", "\u{1F602}", "\u{1F914}"];
const MESSAGE_HIGHLIGHT_DURATION = 2200;

function mergeMessageIntoTimeline(previousMessages, nextMessage) {
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

export default function ChatArea({
  channel,
  messages,
  setMessages,
  user,
  server,
  serverId,
  members = [],
  roles = [],
  onSendTyping,
  typingUsers,
  onChannelRead,
}) {
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
  const [highlightedMessageId, setHighlightedMessageId] = useState(null);
  const [replyTargets, setReplyTargets] = useState({});
  const [selectedMentions, setSelectedMentions] = useState([]);
  const [activeMention, setActiveMention] = useState(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const composerInputRef = useRef(null);
  const typingTimeout = useRef(null);
  const messageRefs = useRef({});
  const fetchedReplyIds = useRef(new Set());
  const pendingJumpMessageId = useRef(null);
  const highlightTimeout = useRef(null);
  const suppressAutoScroll = useRef(false);
  const workspacePermissions = useMemo(
    () => buildWorkspaceCapabilities({ user, server, members, roles }).permissions,
    [members, roles, server, user],
  );
  const mentionSuggestions = useMemo(
    () => buildMentionSuggestions({
      query: activeMention?.query || "",
      members,
      roles,
      permissions: workspacePermissions,
    }),
    [activeMention?.query, members, roles, workspacePermissions],
  );

  useEffect(() => {
    if (suppressAutoScroll.current) {
      suppressAutoScroll.current = false;
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => () => {
    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current);
    }
    if (highlightTimeout.current) {
      clearTimeout(highlightTimeout.current);
    }
  }, []);

  useEffect(() => {
    setSelectedMentions([]);
    setActiveMention(null);
    setActiveMentionIndex(0);
  }, [channel?.id]);

  useEffect(() => {
    if (!pendingJumpMessageId.current) {
      return;
    }

    const targetId = pendingJumpMessageId.current;
    if (!focusMessage(targetId)) {
      return;
    }

    pendingJumpMessageId.current = null;
  }, [messages]);

  useEffect(() => {
    const missingReplyIds = [...new Set(
      messages
        .map((message) => message.reply_to_id)
        .filter(Boolean)
        .filter((replyId) => (
          !messages.some((message) => message.id === replyId)
          && !Object.prototype.hasOwnProperty.call(replyTargets, replyId)
          && !fetchedReplyIds.current.has(replyId)
        )),
    )];

    if (missingReplyIds.length === 0) {
      return;
    }

    let cancelled = false;
    missingReplyIds.forEach((replyId) => fetchedReplyIds.current.add(replyId));

    (async () => {
      const results = await Promise.allSettled(
        missingReplyIds.map((replyId) => api.get(`/messages/${replyId}`)),
      );

      if (cancelled) {
        return;
      }

      setReplyTargets((previous) => {
        const nextTargets = { ...previous };
        missingReplyIds.forEach((replyId, index) => {
          const result = results[index];
          nextTargets[replyId] = result.status === "fulfilled" ? result.value.data : null;
        });
        return nextTargets;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [messages, replyTargets]);

  // Mark channel as read when viewing
  useEffect(() => {
    if (channel?.id) {
      api.post(`/channels/${channel.id}/read`)
        .then(() => onChannelRead?.())
        .catch(() => {});
    }
  }, [channel?.id, messages.length, onChannelRead]);

  const handleSend = async (e) => {
    e.preventDefault();
    if ((!content.trim() && pendingAttachments.length === 0) || !channel || sending) return;
    setSending(true);
    try {
      const mentionPayload = buildMentionPayload(selectedMentions, content);
      const res = await api.post(`/channels/${channel.id}/messages`, {
        content: content.trim(),
        attachments: pendingAttachments,
        ...mentionPayload,
      });
      setMessages(prev => {
        if (prev.find(m => m.id === res.data.id)) return prev;
        return [...prev, res.data];
      });
      setContent("");
      setPendingAttachments([]);
      setSelectedMentions([]);
      setActiveMention(null);
      setActiveMentionIndex(0);
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

  const updateActiveMention = (nextContent, cursorPosition = nextContent.length) => {
    const nextMention = findActiveMention(nextContent, cursorPosition);
    if (!nextMention) {
      setActiveMention(null);
      setActiveMentionIndex(0);
      return;
    }

    setActiveMention(nextMention);
    setActiveMentionIndex(0);
  };

  const typingNames = Object.values(typingUsers);
  const removePendingAttachment = (attachmentId) => {
    setPendingAttachments(prev => prev.filter((attachment) => attachment.id !== attachmentId));
  };

  const focusMessage = (messageId) => {
    const targetNode = messageRefs.current[messageId];
    if (!targetNode) {
      return false;
    }

    targetNode.scrollIntoView({ behavior: "smooth", block: "center" });

    if (highlightTimeout.current) {
      clearTimeout(highlightTimeout.current);
    }
    setHighlightedMessageId(messageId);
    highlightTimeout.current = setTimeout(() => {
      setHighlightedMessageId((current) => (current === messageId ? null : current));
    }, MESSAGE_HIGHLIGHT_DURATION);

    return true;
  };

  const pinRefreshKey = messages
    .filter((message) => message.is_pinned)
    .map((message) => message.id)
    .sort()
    .join(":");

  const getReplyTarget = (message) => {
    if (!message?.reply_to_id) {
      return null;
    }

    return messages.find((entry) => entry.id === message.reply_to_id) || replyTargets[message.reply_to_id] || null;
  };

  const revealMessage = async (messageId) => {
    if (!messageId) {
      return;
    }

    if (focusMessage(messageId)) {
      return;
    }

    try {
      suppressAutoScroll.current = true;
      pendingJumpMessageId.current = messageId;
      const response = await api.get(`/messages/${messageId}`);
      setMessages((previous) => mergeMessageIntoTimeline(previous, response.data));
    } catch {
      pendingJumpMessageId.current = null;
      suppressAutoScroll.current = false;
      toast.error("Original message not available");
    }
  };

  const insertMention = (suggestion) => {
    if (!activeMention) {
      return;
    }

    const { nextContent, nextCursorPosition } = applyMentionSuggestion(content, activeMention, suggestion);
    setContent(nextContent);
    setSelectedMentions((previous) => normalizeSelectedMentions([
      ...previous.filter((entry) => entry.key !== suggestion.key),
      suggestion,
    ], nextContent));
    setActiveMention(null);
    setActiveMentionIndex(0);

    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      composerInputRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
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
            const replyTarget = getReplyTarget(msg);
            const isHighlighted = highlightedMessageId === msg.id;

            return (
              <div
                key={msg.id}
                ref={(node) => {
                  if (node) {
                    messageRefs.current[msg.id] = node;
                  } else {
                    delete messageRefs.current[msg.id];
                  }
                }}
                className={`message-item group relative flex gap-3 rounded-md px-2 py-1 transition-[background-color,box-shadow,border-color] ${
                  compact ? 'mt-0' : 'mt-3'
                } ${
                  isHighlighted
                    ? 'bg-[#221A10] shadow-[0_0_0_1px_rgba(245,158,11,0.35),0_0_32px_rgba(245,158,11,0.12)]'
                    : ''
                }`}
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
                      {msg.reply_to_id && (
                        <div className="mb-2 max-w-[540px]">
                          <MessageReferencePreview
                            message={replyTarget}
                            placeholder="Original message unavailable"
                            onClick={replyTarget?.id ? () => revealMessage(replyTarget.id) : undefined}
                          />
                        </div>
                      )}
                      {msg.is_pinned && (
                        <div className="flex items-center gap-1 text-[10px] text-[#F59E0B] mb-0.5">
                          <PushPin size={10} weight="fill" /> Pinned
                        </div>
                      )}
                      {msg.content ? (
                        <p className="text-sm text-[#E4E4E7] break-words whitespace-pre-wrap">
                          {renderMessageContent(msg.content, msg)}
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
              ref={composerInputRef}
              value={content}
              onChange={(e) => {
                const nextContent = e.target.value;
                setContent(nextContent);
                setSelectedMentions((previous) => normalizeSelectedMentions(previous, nextContent));
                updateActiveMention(nextContent, e.target.selectionStart ?? nextContent.length);
                handleTyping();
              }}
              onClick={(e) => updateActiveMention(content, e.currentTarget.selectionStart ?? content.length)}
              onBlur={() => {
                window.setTimeout(() => {
                  setActiveMention(null);
                  setActiveMentionIndex(0);
                }, 120);
              }}
              onKeyDown={(e) => {
                if (!activeMention || mentionSuggestions.length === 0) {
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveMentionIndex((previous) => (previous + 1) % mentionSuggestions.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveMentionIndex((previous) => (previous - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  e.preventDefault();
                  insertMention(mentionSuggestions[activeMentionIndex] || mentionSuggestions[0]);
                  return;
                }
                if (e.key === "Escape") {
                  setActiveMention(null);
                  setActiveMentionIndex(0);
                }
              }}
              placeholder={`Message #${channel.name}`}
              data-testid="message-input"
              className="flex-1 bg-transparent text-sm text-white placeholder:text-[#52525B] outline-none"
            />
            <button type="submit" disabled={(!content.trim() && pendingAttachments.length === 0) || sending} data-testid="send-message-button"
              className="text-[#6366F1] hover:text-[#4F46E5] disabled:text-[#52525B] transition-colors shrink-0">
              <PaperPlaneRight size={20} weight="fill" />
            </button>
          </div>
          {activeMention && mentionSuggestions.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-lg border border-[#27272A] bg-[#121212] shadow-xl">
              {mentionSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.key}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertMention(suggestion)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                    index === activeMentionIndex ? "bg-[#1C1D22]" : "hover:bg-[#18191D]"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-white">
                      <At size={13} className="text-[#818CF8]" />
                      <span className="truncate">@{suggestion.label}</span>
                    </div>
                    <div className="truncate text-[11px] text-[#71717A]">{suggestion.description}</div>
                  </div>
                  {suggestion.type === "role" && (
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: suggestion.color }} />
                  )}
                </button>
              ))}
            </div>
          )}
        </form>
      </div>

      {/* Pinned messages panel */}
      {showPins && (
        <PinnedMessagesPanel
          channelId={channel.id}
          onClose={() => setShowPins(false)}
          onJumpToMessage={async (messageId) => {
            setShowPins(false);
            await revealMessage(messageId);
          }}
          refreshKey={pinRefreshKey}
        />
      )}

      {/* Thread panel */}
      {threadMsgId && (
        <ThreadPanel
          messageId={threadMsgId}
          channelId={channel.id}
          onClose={() => setThreadMsgId(null)}
          user={user}
          onReplySent={(replyMessage, parentMessageId) => {
            setMessages((previous) => {
              const timelineWithReply = mergeMessageIntoTimeline(previous, replyMessage);
              return timelineWithReply.map((message) => (
                message.id === parentMessageId
                  ? { ...message, thread_count: Math.max(1, (message.thread_count || 0) + 1) }
                  : message
              ));
            });
          }}
        />
      )}
    </div>
  );
}
