import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
import { useE2EE } from "@/contexts/E2EEContext";
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
  const { t } = useTranslation();
  const { config } = useRuntime();
  const {
    ready: e2eeReady,
    isDesktopCapable,
    decryptMessage,
    encryptForRecipients,
    fetchChannelRecipients,
    uploadEncryptedAttachment,
    downloadAndDecryptAttachment,
  } = useE2EE();
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
  const [decryptedPayloads, setDecryptedPayloads] = useState({});
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
  const isE2EEChannel = Boolean(channel?.is_private);
  const canUseE2EEChannel = !isE2EEChannel || (isDesktopCapable && e2eeReady);

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
    setDecryptedPayloads({});
  }, [channel?.id]);

  useEffect(() => {
    if (!isE2EEChannel || !e2eeReady) {
      return;
    }
    let cancelled = false;
    const encryptedMessages = messages.filter((message) => message.is_e2ee && !decryptedPayloads[message.id]);
    if (encryptedMessages.length === 0) {
      return;
    }
    (async () => {
      const decrypted = await Promise.all(
        encryptedMessages.map(async (message) => ({
          id: message.id,
          payload: await decryptMessage(message),
        })),
      );
      if (cancelled) return;
      setDecryptedPayloads((previous) => {
        const next = { ...previous };
        decrypted.forEach((entry) => {
          if (entry.payload) {
            next[entry.id] = entry.payload;
          }
        });
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [decryptMessage, decryptedPayloads, e2eeReady, isE2EEChannel, messages]);

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
      let requestBody = {
        content: content.trim(),
        attachments: pendingAttachments,
        ...mentionPayload,
      };
      let optimisticPayload = null;

      if (isE2EEChannel) {
        if (!canUseE2EEChannel) {
          throw new Error("Use a verified desktop device to send encrypted messages here.");
        }
        const recipients = await fetchChannelRecipients(channel.id);
        const attachmentRefs = [];
        const attachmentManifests = [];
        for (const attachment of pendingAttachments) {
          if (!attachment.localFile) continue;
          const uploaded = await uploadEncryptedAttachment({
            file: attachment.localFile,
            scopeKind: "channel",
            scopeId: channel.id,
            recipientsResponse: recipients,
          });
          attachmentRefs.push(uploaded.serverAttachment);
          attachmentManifests.push(uploaded.manifest);
        }
        optimisticPayload = {
          text: content.trim(),
          attachments: attachmentManifests,
        };
        const encryptedPayload = await encryptForRecipients(optimisticPayload, recipients);
        requestBody = {
          content: "[Encrypted message]",
          attachments: attachmentRefs,
          message_type: "text",
          ...mentionPayload,
          ...encryptedPayload,
        };
      }

      const res = await api.post(`/channels/${channel.id}/messages`, requestBody);
      if (optimisticPayload) {
        setDecryptedPayloads((previous) => ({
          ...previous,
          [res.data.id]: optimisticPayload,
        }));
      }
      setMessages(prev => {
        if (prev.find(m => m.id === res.data.id)) return prev;
        return [...prev, res.data];
      });
      setContent("");
      setPendingAttachments([]);
      setSelectedMentions([]);
      setActiveMention(null);
      setActiveMentionIndex(0);
    } catch {
      toast.error(t("chat.sendFailed"));
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
      toast.error(t("chat.editFailed"));
    }
  };

  const handleDelete = async (msgId) => {
    try {
      await api.delete(`/messages/${msgId}`);
      setMessages(prev => prev.filter(m => m.id !== msgId));
    } catch {
      toast.error(t("chat.deleteFailed"));
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
      toast.success(t("chat.messagePinned"));
    } catch { toast.error(t("chat.pinFailed")); }
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
      toast.success(t("chat.topicUpdated"));
      setEditingTopic(false);
    } catch { toast.error(t("chat.topicUpdateFailed")); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error(t("chat.fileTooLarge"));
      return;
    }
    if (isE2EEChannel) {
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
      e.target.value = "";
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
        toast.error(t("chat.uploadFailed"));
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

  const handleEncryptedAttachmentDownload = async (attachment) => {
    try {
      const { url } = await downloadAndDecryptAttachment(attachment);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.name || "encrypted-attachment";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      toast.error("Encrypted attachment could not be opened.");
    }
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
      toast.error(t("chat.originalUnavailable"));
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
      <div className="flex-1 flex items-center justify-center bg-transparent text-[#71717A]" data-testid="no-channel-selected">
        <p>{t("chat.selectChannel")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-w-0 min-h-0" data-testid="chat-area">
      <div className="flex-1 flex flex-col bg-transparent min-w-0 min-h-0">
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-5 border-b workspace-divider shrink-0 bg-zinc-900/25" data-testid="chat-header">
          <div className="flex items-center min-w-0 flex-1">
            <Hash size={20} weight="bold" className="text-cyan-400 mr-2 shrink-0" />
            <h3 className="text-base font-bold text-white shrink-0" style={{ fontFamily: 'Manrope' }}>{channel.name}</h3>
            {editingTopic ? (
              <div className="flex items-center gap-1 ml-3 border-l border-[#27272A] pl-3 flex-1 min-w-0">
                <input value={topicDraft} onChange={e => setTopicDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveTopic(); if (e.key === 'Escape') setEditingTopic(false); }}
                  className="flex-1 rounded-lg border border-white/10 bg-zinc-950/60 px-2 py-1 text-xs text-white outline-none" autoFocus data-testid="topic-edit-input" />
                <button onClick={saveTopic} className="text-cyan-400 text-xs font-medium">{t("common.save")}</button>
                <button onClick={() => setEditingTopic(false)} className="text-[#71717A] text-xs">{t("common.cancel")}</button>
              </div>
            ) : channel.topic ? (
              <button onClick={() => { setTopicDraft(channel.topic); setEditingTopic(true); }}
                className="ml-3 text-xs text-[#71717A] truncate border-l workspace-divider pl-3 hidden md:inline hover:text-[#A1A1AA] transition-colors"
                data-testid="topic-display">
                {channel.topic}
              </button>
            ) : (
              <button onClick={() => { setTopicDraft(""); setEditingTopic(true); }}
                className="ml-3 text-xs text-[#52525B] border-l workspace-divider pl-3 hidden md:inline hover:text-[#71717A] transition-colors">
                {t("chat.setTopic")}
              </button>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button onClick={() => setShowPins(!showPins)} data-testid="pins-button"
                    className={`workspace-icon-button ${showPins ? 'text-[#F59E0B] border-amber-500/20 bg-amber-500/10' : ''}`}>
                    <PushPin size={16} weight={showPins ? "fill" : "bold"} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>{t("chat.pinnedMessages")}</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <NotificationPanel />
            {!isE2EEChannel && <SearchDialog serverId={serverId} />}
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4" data-testid="messages-list">
          {isE2EEChannel && !canUseE2EEChannel && (
            <div className="workspace-card mx-auto mt-8 max-w-xl p-6 text-sm text-[#A1A1AA]">
              {isDesktopCapable
                ? "This private channel is end-to-end encrypted. Verify or restore this desktop device in Settings > Privacy to read the messages."
                : "This private channel is end-to-end encrypted and is only available in the desktop app."}
            </div>
          )}
          {canUseE2EEChannel && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-[#71717A]">
                <Hash size={48} weight="bold" className="mb-4 opacity-30 text-cyan-400" />
              <p className="text-lg font-bold" style={{ fontFamily: 'Manrope' }}>{t("chat.welcomeToChannel", { name: channel.name })}</p>
              <p className="text-sm">{t("chat.startOfChannel")}</p>
            </div>
          )}

          {canUseE2EEChannel && messages.map((msg, i) => {
            const prevMsg = messages[i - 1];
            const sameAuthor = prevMsg?.author_id === msg.author_id;
            const timeDiff = prevMsg ? (new Date(msg.created_at) - new Date(prevMsg.created_at)) / 60000 : 999;
            const compact = sameAuthor && timeDiff < 5;
            const replyTarget = getReplyTarget(msg);
            const isHighlighted = highlightedMessageId === msg.id;
            const decryptedPayload = msg.is_e2ee ? decryptedPayloads[msg.id] : null;
            const decryptedAttachments = decryptedPayload?.attachments || [];
            const hasDecryptedText = typeof decryptedPayload?.text === "string" && decryptedPayload.text.length > 0;
            const hasDecryptedAttachments = decryptedAttachments.length > 0;
            const displayContent = msg.is_e2ee
              ? (hasDecryptedText ? decryptedPayload.text : (hasDecryptedAttachments ? "" : "Encrypted message"))
              : msg.content;
            const displayAttachments = msg.is_e2ee
              ? decryptedAttachments
              : (msg.attachments || []);

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
                className={`message-item group relative flex gap-3 rounded-2xl px-3 py-2 transition-[background-color,box-shadow,border-color] ${
                  compact ? 'mt-0' : 'mt-3'
                } ${
                  isHighlighted
                    ? 'bg-[#221A10] shadow-[0_0_0_1px_rgba(245,158,11,0.35),0_0_32px_rgba(245,158,11,0.12)]'
                    : 'hover:bg-white/[0.03]'
                }`}
                data-testid={`message-${msg.id}`}
              >
                {!compact ? (
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-zinc-800/80 text-sm font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    {msg.author?.avatar_url ? (
                      <img src={msg.author.avatar_url} alt={msg.author?.display_name || msg.author?.username || "avatar"} className="h-full w-full object-cover" />
                    ) : (
                      msg.author?.display_name?.[0]?.toUpperCase() || '?'
                    )}
                  </div>
                ) : (
                  <div className="w-10 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  {!compact && (
                    <div className="flex items-baseline gap-2 mb-0.5">
                      <span className="text-sm font-semibold" style={{ color: msg.author?.role === 'admin' ? '#E74C3C' : '#FFFFFF' }}>
                        {msg.author?.display_name || msg.author?.username || t("common.unknown")}
                      </span>
                      <span className="text-[10px] text-[#52525B]">
                        {new Date(msg.created_at).toLocaleString()}
                      </span>
                      {msg.edited_at && <span className="text-[10px] text-[#52525B]">{t("chat.edited")}</span>}
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
                      <button onClick={() => handleEdit(msg.id)} className="text-[#6366F1] text-xs font-medium">{t("common.save")}</button>
                      <button onClick={() => setEditingId(null)} className="text-[#71717A] text-xs">{t("common.cancel")}</button>
                    </div>
                  ) : (
                    <>
                      {msg.reply_to_id && (
                        <div className="mb-2 max-w-[540px]">
                          <MessageReferencePreview
                            message={replyTarget}
                            placeholder={t("chat.originalUnavailable")}
                            onClick={replyTarget?.id ? () => revealMessage(replyTarget.id) : undefined}
                          />
                        </div>
                      )}
                      {msg.is_pinned && (
                        <div className="flex items-center gap-1 text-[10px] text-[#F59E0B] mb-0.5">
                          <PushPin size={10} weight="fill" /> {t("chat.pinned")}
                        </div>
                      )}
                      {displayContent ? (
                        <p className="text-sm text-[#E4E4E7] break-words whitespace-pre-wrap">
                          {renderMessageContent(displayContent, msg)}
                        </p>
                      ) : null}

                  {/* Attachments */}
                  {displayAttachments?.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {displayAttachments.map((att, j) => (
                        <div key={j}>
                          {!msg.is_e2ee && att.type?.startsWith('image/') ? (
                            <img src={att.url ? `${config?.assetBase || ""}${att.url}` : att.data} alt={att.name}
                              className="max-w-md max-h-80 rounded-2xl border border-white/10 shadow-[0_16px_40px_rgba(0,0,0,0.22)]" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => (msg.is_e2ee ? handleEncryptedAttachmentDownload(att) : window.open(att.url ? `${config?.assetBase || ""}${att.url}` : "#", "_blank", "noopener,noreferrer"))}
                              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/65 px-3 py-2 text-xs text-[#A1A1AA] transition-colors hover:bg-white/5 hover:text-white"
                            >
                              <Paperclip size={14} /> {att.name}
                            </button>
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
                              ? 'bg-cyan-500/14 border-cyan-400/40 text-cyan-300'
                              : 'bg-zinc-900/65 border-white/10 text-[#A1A1AA] hover:border-cyan-400/30'
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
                      className="mt-1.5 flex items-center gap-1.5 text-cyan-300 text-xs font-medium hover:text-cyan-200 transition-colors">
                      <ChatText size={14} weight="bold" />
                      {t("thread.replyCount", { count: msg.thread_count })}
                    </button>
                  )}
                    </>
                  )}
                </div>

                {/* Hover actions */}
                <div className="absolute right-2 -top-3 hidden group-hover:flex bg-zinc-950/90 border border-white/10 rounded-xl overflow-hidden shadow-xl z-10 backdrop-blur-xl">
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button onClick={() => setShowReactions(showReactions === msg.id ? null : msg.id)}
                          className="px-1.5 py-1 hover:bg-[#27272A] transition-colors text-[#A1A1AA] hover:text-white">
                          <span className="text-xs">+</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>{t("chat.react")}</p></TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button onClick={() => setThreadMsgId(msg.id)} data-testid={`open-thread-${msg.id}`}
                          className="px-1.5 py-1 hover:bg-[#27272A] transition-colors text-[#A1A1AA] hover:text-white">
                          <ChatText size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><p>{t("chat.replyInThread")}</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {msg.author_id === user?.id && !msg.is_e2ee && (
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
                  <div className="absolute right-2 top-6 bg-zinc-950/90 border border-white/10 rounded-xl p-2 flex gap-1 flex-wrap w-48 z-20 shadow-xl backdrop-blur-xl">
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
            {t("chat.typing", { names: typingNames.join(", "), count: typingNames.length })}
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
          <div className="workspace-input-shell flex items-center gap-2 px-4 py-3">
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept="image/*,.pdf,.txt,.zip,.doc,.docx" />
            <button type="button" onClick={() => fileInputRef.current?.click()} data-testid="file-upload-button"
              disabled={!canUseE2EEChannel}
              className="workspace-icon-button h-10 w-10 shrink-0 disabled:text-[#3F3F46]">
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
              placeholder={t("chat.messagePlaceholder", { name: channel.name })}
              disabled={!canUseE2EEChannel}
              data-testid="message-input"
              className="flex-1 bg-transparent text-sm text-white placeholder:text-[#52525B] outline-none disabled:text-[#52525B]"
            />
            <button type="submit" disabled={!canUseE2EEChannel || (!content.trim() && pendingAttachments.length === 0) || sending} data-testid="send-message-button"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500 text-zinc-950 transition-colors hover:bg-cyan-400 disabled:bg-zinc-800 disabled:text-[#52525B]">
              <PaperPlaneRight size={20} weight="fill" />
            </button>
          </div>
          {activeMention && mentionSuggestions.length > 0 && (
            <div className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-xl backdrop-blur-xl">
              {mentionSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.key}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertMention(suggestion)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                    index === activeMentionIndex ? "bg-cyan-500/12" : "hover:bg-white/5"
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
          channel={channel}
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
          channel={channel}
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
