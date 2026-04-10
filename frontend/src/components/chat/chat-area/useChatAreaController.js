/*
 * Singra Vox - ChatArea controller
 *
 * Owns chat state, side effects, API calls and E2EE orchestration. The view
 * layer receives prepared state and callbacks only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import api from "@/lib/api";
import { useRuntime } from "@/contexts/RuntimeContext";
import { useE2EE } from "@/contexts/E2EEContext";
import { formatAppError } from "@/lib/appErrors";
import { resolveAssetUrl } from "@/lib/assetUrls";
import {
  applyMentionSuggestion,
  buildMentionPayload,
  buildMentionSuggestions,
  findActiveMention,
  normalizeSelectedMentions,
} from "@/lib/messageMentions";
import { buildServerCapabilities } from "@/lib/serverPermissions";
import {
  buildMessageItems,
  getPinRefreshKey,
  getTypingNames,
  mergeMessageIntoTimeline,
  MESSAGE_HIGHLIGHT_DURATION,
} from "@/components/chat/chat-area/chatAreaState";

export default function useChatAreaController({
  channel,
  messages,
  setMessages,
  user,
  server,
  serverId,
  members = [],
  roles = [],
  viewerContext = null,
  onSendTyping,
  typingUsers,
  onChannelRead,
  hasOlderMessages = false,
  onLoadOlderMessages,
  loadingOlderMessages = false,
}) {
  const { t } = useTranslation();
  const { config } = useRuntime();
  const {
    ready: e2eeReady,
    isDesktopCapable,
    decryptMessage,
    encryptForRecipients,
    fetchChannelRecipients,
    inspectRecipientTrust,
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
  const [trustNoticeVisible, setTrustNoticeVisible] = useState(false);
  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const composerInputRef = useRef(null);
  const typingTimeout = useRef(null);
  const messageRefs = useRef({});
  const fetchedReplyIds = useRef(new Set());
  const pendingJumpMessageId = useRef(null);
  const highlightTimeout = useRef(null);
  const suppressAutoScroll = useRef(false);

  const serverPermissions = useMemo(
    () => buildServerCapabilities({
      user,
      server,
      viewerContext,
      channelId: channel?.id,
    }).permissions,
    [channel?.id, server, user, viewerContext],
  );
  const mentionSuggestions = useMemo(
    () => buildMentionSuggestions({
      query: activeMention?.query || "",
      members,
      roles,
      permissions: serverPermissions,
    }),
    [activeMention?.query, members, roles, serverPermissions],
  );
  const isE2EEChannel = Boolean(channel?.is_private);
  const canUseE2EEChannel = !isE2EEChannel || e2eeReady;
  const typingNames = useMemo(() => getTypingNames(typingUsers), [typingUsers]);
  const pinRefreshKey = useMemo(() => getPinRefreshKey(messages), [messages]);
  const messageItems = useMemo(
    () => buildMessageItems({
      messages,
      decryptedPayloads,
      replyTargets,
      highlightedMessageId,
    }),
    [decryptedPayloads, highlightedMessageId, messages, replyTargets],
  );

  function resolveAvatarUrl(url) {
    return resolveAssetUrl(url, config?.assetBase);
  }

  function updateActiveMention(nextContent, cursorPosition = nextContent.length) {
    const nextMention = findActiveMention(nextContent, cursorPosition);
    if (!nextMention) {
      setActiveMention(null);
      setActiveMentionIndex(0);
      return;
    }

    setActiveMention(nextMention);
    setActiveMentionIndex(0);
  }

  function focusMessage(messageId) {
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
  }

  async function revealMessage(messageId) {
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
  }

  function insertMention(suggestion) {
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
  }

  function beginTopicEdit(initialTopic = "") {
    setTopicDraft(initialTopic);
    setEditingTopic(true);
  }

  function cancelTopicEdit() {
    setEditingTopic(false);
  }

  async function saveTopic() {
    try {
      await api.put(`/channels/${channel.id}/topic`, { topic: topicDraft });
      toast.success(t("chat.topicUpdated"));
      setEditingTopic(false);
    } catch {
      toast.error(t("chat.topicUpdateFailed"));
    }
  }

  async function handleSend(event) {
    event.preventDefault();
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
          toast.error(t("e2ee.privateChannelVerifyDevice"));
          setSending(false);
          return;
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

      const response = await api.post(`/channels/${channel.id}/messages`, requestBody);
      if (optimisticPayload) {
        setDecryptedPayloads((previous) => ({
          ...previous,
          [response.data.id]: optimisticPayload,
        }));
      }
      setMessages((previous) => {
        if (previous.find((message) => message.id === response.data.id)) return previous;
        return [...previous, response.data];
      });
      setContent("");
      setPendingAttachments([]);
      setSelectedMentions([]);
      setActiveMention(null);
      setActiveMentionIndex(0);
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "chat.sendFailed" }));
    } finally {
      setSending(false);
    }
  }

  function handleTyping() {
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    onSendTyping?.();
    typingTimeout.current = setTimeout(() => {}, 3000);
  }

  async function handleEdit(messageId) {
    if (!editContent.trim()) return;
    try {
      const response = await api.put(`/messages/${messageId}`, { content: editContent.trim() });
      setMessages((previous) => previous.map((message) => (message.id === messageId ? response.data : message)));
      setEditingId(null);
    } catch {
      toast.error(t("chat.editFailed"));
    }
  }

  async function handleDelete(messageId) {
    try {
      await api.delete(`/messages/${messageId}`);
      setMessages((previous) => previous.filter((message) => message.id !== messageId));
    } catch {
      toast.error(t("chat.deleteFailed"));
    }
  }

  async function handleReaction(messageId, emoji) {
    try {
      const response = await api.post(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`);
      setMessages((previous) => previous.map((message) => (
        message.id === messageId ? { ...message, reactions: response.data.reactions } : message
      )));
    } catch {
      // Ignore reaction toggle errors to keep the existing lightweight UX.
    }
    setShowReactions(null);
  }

  async function handlePin(messageId) {
    try {
      await api.post(`/messages/${messageId}/pin`);
      setMessages((previous) => previous.map((message) => (
        message.id === messageId ? { ...message, is_pinned: true } : message
      )));
      toast.success(t("chat.messagePinned"));
    } catch {
      toast.error(t("chat.pinFailed"));
    }
  }

  async function handleUnpin(messageId) {
    try {
      await api.delete(`/messages/${messageId}/pin`);
      setMessages((previous) => previous.map((message) => (
        message.id === messageId ? { ...message, is_pinned: false } : message
      )));
    } catch {
      // Ignore pin removal errors to preserve the existing UX.
    }
  }

  async function handleFileUpload(event) {
    const file = event.target.files?.[0];
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
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result.split(",")[1];
      try {
        const uploadResponse = await api.post("/upload", {
          data: base64,
          name: file.name,
          type: file.type,
        });
        setPendingAttachments((previous) => [
          ...previous,
          { id: uploadResponse.data.id, name: file.name, type: file.type, url: uploadResponse.data.url },
        ]);
      } catch {
        toast.error(formatAppError(t, null, { fallbackKey: "chat.uploadFailed" }));
      }
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  function removePendingAttachment(attachmentId) {
    setPendingAttachments((previous) => previous.filter((attachment) => attachment.id !== attachmentId));
  }

  async function handleEncryptedAttachmentDownload(attachment) {
    try {
      const { url } = await downloadAndDecryptAttachment(attachment);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.name || "encrypted-attachment";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      toast.error(t("errors.encryptedAttachmentOpenFailed"));
    }
  }

  function handleComposerChange(event) {
    const nextContent = event.target.value;
    setContent(nextContent);
    setSelectedMentions((previous) => normalizeSelectedMentions(previous, nextContent));
    updateActiveMention(nextContent, event.target.selectionStart ?? nextContent.length);
    handleTyping();
  }

  function handleComposerClick(event) {
    updateActiveMention(content, event.currentTarget.selectionStart ?? content.length);
  }

  function handleComposerBlur() {
    window.setTimeout(() => {
      setActiveMention(null);
      setActiveMentionIndex(0);
    }, 120);
  }

  function handleComposerKeyDown(event) {
    if (!activeMention || mentionSuggestions.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveMentionIndex((previous) => (previous + 1) % mentionSuggestions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveMentionIndex((previous) => (previous - 1 + mentionSuggestions.length) % mentionSuggestions.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insertMention(mentionSuggestions[activeMentionIndex] || mentionSuggestions[0]);
      return;
    }
    if (event.key === "Escape") {
      setActiveMention(null);
      setActiveMentionIndex(0);
    }
  }

  function handleReplySent(replyMessage, parentMessageId) {
    setMessages((previous) => {
      const timelineWithReply = mergeMessageIntoTimeline(previous, replyMessage);
      return timelineWithReply.map((message) => (
        message.id === parentMessageId
          ? { ...message, thread_count: Math.max(1, (message.thread_count || 0) + 1) }
          : message
      ));
    });
  }

  useEffect(() => {
    let cancelled = false;

    if (!channel?.id || !isE2EEChannel || !canUseE2EEChannel) {
      setTrustNoticeVisible(false);
      return undefined;
    }

    (async () => {
      try {
        const recipients = await fetchChannelRecipients(channel.id);
        const result = await inspectRecipientTrust({
          scopeKind: "channel",
          scopeId: channel.id,
          recipientsResponse: recipients,
        });
        if (!cancelled) {
          setTrustNoticeVisible(Boolean(result.changed));
        }
      } catch {
        if (!cancelled) {
          setTrustNoticeVisible(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canUseE2EEChannel, channel?.id, fetchChannelRecipients, inspectRecipientTrust, isE2EEChannel]);

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
      return undefined;
    }
    let cancelled = false;
    const encryptedMessages = messages.filter((message) => message.is_e2ee && !decryptedPayloads[message.id]);
    if (encryptedMessages.length === 0) {
      return undefined;
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
      return undefined;
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

  useEffect(() => {
    if (channel?.id) {
      api.post(`/channels/${channel.id}/read`)
        .then(() => onChannelRead?.())
        .catch(() => {});
    }
  }, [channel?.id, messages.length, onChannelRead]);

  return {
    channel,
    header: {
      channel,
      serverId,
      isE2EEChannel,
      editingTopic,
      topicDraft,
      showPins,
      onTopicDraftChange: setTopicDraft,
      onBeginTopicEdit: beginTopicEdit,
      onCancelTopicEdit: cancelTopicEdit,
      onSaveTopic: saveTopic,
      onTogglePins: () => setShowPins((previous) => !previous),
      t,
    },
    timeline: {
      channel,
      isE2EEChannel,
      canUseE2EEChannel,
      isDesktopCapable,
      e2eeReady,
      trustNoticeVisible,
      hasOlderMessages,
      loadingOlderMessages,
      onLoadOlderMessages,
      messages: messageItems,
      typingNames,
      user,
      config,
      messagesEndRef,
      messageRefs,
      showReactions,
      editingId,
      editContent,
      resolveAvatarUrl,
      onSetEditContent: setEditContent,
      onStartEdit: (message) => {
        setEditingId(message.id);
        setEditContent(message.content);
      },
      onCancelEdit: () => setEditingId(null),
      onSaveEdit: handleEdit,
      onDeleteMessage: handleDelete,
      onToggleReactionPicker: (messageId) => setShowReactions((previous) => (previous === messageId ? null : messageId)),
      onReact: handleReaction,
      onOpenThread: setThreadMsgId,
      onTogglePin: (message) => (message.is_pinned ? handleUnpin(message.id) : handlePin(message.id)),
      onRevealMessage: revealMessage,
      onDownloadEncryptedAttachment: handleEncryptedAttachmentDownload,
      t,
    },
    composer: {
      channel,
      canUseE2EEChannel,
      content,
      pendingAttachments,
      sending,
      activeMention,
      activeMentionIndex,
      mentionSuggestions,
      composerInputRef,
      fileInputRef,
      onSubmit: handleSend,
      onFileUpload: handleFileUpload,
      onRemoveAttachment: removePendingAttachment,
      onContentChange: handleComposerChange,
      onInputClick: handleComposerClick,
      onInputBlur: handleComposerBlur,
      onInputKeyDown: handleComposerKeyDown,
      onSelectMention: insertMention,
      t,
    },
    pinsPanel: {
      open: showPins,
      channel,
      refreshKey: pinRefreshKey,
      onClose: () => setShowPins(false),
      onJumpToMessage: async (messageId) => {
        setShowPins(false);
        await revealMessage(messageId);
      },
    },
    threadPanel: {
      open: Boolean(threadMsgId),
      threadMsgId,
      channel,
      onClose: () => setThreadMsgId(null),
      onReplySent: handleReplySent,
    },
  };
}
