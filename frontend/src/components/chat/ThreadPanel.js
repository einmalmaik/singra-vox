/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { PaperPlaneRight, Paperclip, X } from "@phosphor-icons/react";
import api from "@/lib/api";
import { toast } from "sonner";
import { formatAppError } from "@/lib/appErrors";
import MessageReferencePreview from "@/components/chat/MessageReferencePreview";
import { useE2EE } from "@/contexts/E2EEContext";
import E2EEStatus from "@/components/security/E2EEStatus";

function EncryptedBadge() {
  return (
    <E2EEStatus variant="badge" className="mt-1" />
  );
}

export default function ThreadPanel({ messageId, channelId, channel, onClose, onReplySent }) {
  const { t } = useTranslation();
  const {
    ready: e2eeReady,
    isDesktopCapable,
    decryptMessage,
    encryptForRecipients,
    fetchChannelRecipients,
    downloadAndDecryptAttachment,
  } = useE2EE();
  const [thread, setThread] = useState(null);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [highlightParent, setHighlightParent] = useState(false);
  const [decryptedParent, setDecryptedParent] = useState(null);
  const [decryptedReplies, setDecryptedReplies] = useState({});
  const endRef = useRef(null);
  const parentRef = useRef(null);
  const parentHighlightTimeout = useRef(null);
  const isE2EEThread = Boolean(channel?.is_private);
  const canUseE2EEThread = !isE2EEThread || e2eeReady;

  const loadThread = useCallback(async () => {
    try {
      const res = await api.get(`/messages/${messageId}/thread`);
      setThread(res.data);
      setDecryptedParent(null);
      setDecryptedReplies({});
    } catch {
      toast.error(t("thread.loadFailed"));
    }
  }, [messageId, t]);

  useEffect(() => {
    if (messageId) {
      void loadThread();
    }
  }, [messageId, loadThread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

  useEffect(() => () => {
    if (parentHighlightTimeout.current) {
      clearTimeout(parentHighlightTimeout.current);
    }
  }, []);

  useEffect(() => {
    if (!thread || !isE2EEThread || !canUseE2EEThread) {
      return;
    }

    let cancelled = false;

    (async () => {
      // Threads reuse the exact stored envelopes from the timeline. Decrypt once
      // per panel load so pins/threads never force a plaintext fallback.
      const parentPayload = thread.parent?.is_e2ee ? await decryptMessage(thread.parent) : null;
      const replyPayloads = await Promise.all(
        (thread.replies || [])
          .filter((reply) => reply.is_e2ee)
          .map(async (reply) => ({
            id: reply.id,
            payload: await decryptMessage(reply),
          })),
      );

      if (cancelled) {
        return;
      }

      setDecryptedParent(parentPayload);
      setDecryptedReplies((previous) => {
        const next = { ...previous };
        replyPayloads.forEach((entry) => {
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
  }, [canUseE2EEThread, decryptMessage, isE2EEThread, thread]);

  const focusParentMessage = () => {
    parentRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (parentHighlightTimeout.current) {
      clearTimeout(parentHighlightTimeout.current);
    }
    setHighlightParent(true);
    parentHighlightTimeout.current = setTimeout(() => {
      setHighlightParent(false);
    }, 1800);
  };

  const sendReply = async (event) => {
    event.preventDefault();
    if (!content.trim() || sending) return;
    setSending(true);
    try {
      let payload = { content: content.trim() };

      if (isE2EEThread) {
        if (!canUseE2EEThread) {
          toast.error(t("e2ee.threadVerifyDevice"));
          setSending(false);
          return;
        }
        const recipients = await fetchChannelRecipients(channelId);
        const encryptedPayload = await encryptForRecipients({
          text: content.trim(),
          attachments: [],
        }, recipients);
        payload = {
          content: "[Encrypted message]",
          attachments: [],
          message_type: "thread_reply",
          ...encryptedPayload,
        };
      }

      const response = await api.post(`/channels/${channelId}/messages/${messageId}/reply`, payload);
      setContent("");
      onReplySent?.(response.data, messageId);
      await loadThread();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "thread.replyFailed" }));
    } finally {
      setSending(false);
    }
  };

  const openEncryptedAttachment = async (attachment) => {
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
  };

  const renderAttachments = (attachments, encrypted) => {
    if (!attachments?.length) {
      return null;
    }

    return (
      <div className="mt-2 space-y-1">
        {attachments.map((attachment, index) => (
          <button
            key={`${attachment.blob_id || attachment.id || attachment.name || "attachment"}-${index}`}
            type="button"
            onClick={() => {
              if (encrypted) {
                void openEncryptedAttachment(attachment);
                return;
              }
              if (attachment.url) {
                window.open(attachment.url, "_blank", "noopener,noreferrer");
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

  if (!thread) {
    return (
      <div className="w-[360px] bg-[#121212] border-l border-[#27272A] flex items-center justify-center" data-testid="thread-panel-loading">
        <div className="w-6 h-6 border-2 border-[#6366F1] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const parentAttachments = thread.parent?.is_e2ee ? (decryptedParent?.attachments || []) : (thread.parent?.attachments || []);
  const parentHasText = typeof decryptedParent?.text === "string" && decryptedParent.text.length > 0;
  const parentText = thread.parent?.is_e2ee
    ? (parentHasText ? decryptedParent.text : (parentAttachments.length > 0 ? "" : "Encrypted message"))
    : thread.parent?.content;

  return (
    <div className="w-[360px] bg-[#121212] border-l border-[#27272A] flex flex-col shrink-0" data-testid="thread-panel">
      <div className="h-12 flex items-center justify-between px-4 border-b border-[#27272A] shrink-0">
        <h3 className="text-sm font-bold text-white" style={{ fontFamily: "Manrope" }}>{t("thread.title")}</h3>
        <button onClick={onClose} data-testid="close-thread" className="text-[#71717A] hover:text-white transition-colors">
          <X size={18} weight="bold" />
        </button>
      </div>

      <div
        ref={parentRef}
        className={`px-4 py-3 border-b border-[#27272A]/50 bg-[#0A0A0A]/50 transition-[background-color,box-shadow] ${
          highlightParent ? "bg-[#221A10] shadow-[0_0_0_1px_rgba(245,158,11,0.32),0_0_22px_rgba(245,158,11,0.1)]" : ""
        }`}
      >
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-sm font-semibold text-white">{thread.parent?.author?.display_name}</span>
          <span className="text-[10px] text-[#52525B]">{new Date(thread.parent?.created_at).toLocaleString()}</span>
        </div>
        {thread.parent?.is_e2ee ? <EncryptedBadge /> : null}
        {!canUseE2EEThread && isE2EEThread ? (
          <E2EEStatus
            variant="guard"
            scope="thread"
            ready={e2eeReady}
            isDesktopCapable={isDesktopCapable}
            className="mt-3"
          />
        ) : (
          <>
            <p className="text-sm text-[#E4E4E7]">{parentText}</p>
            {renderAttachments(parentAttachments, Boolean(thread.parent?.is_e2ee))}
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-3">
        <p className="text-xs text-[#71717A] text-center py-1">
          {t("thread.replyCount", { count: thread.reply_count })}
        </p>
        {thread.replies?.map((reply) => {
          const replyPayload = reply.is_e2ee ? decryptedReplies[reply.id] : null;
          const replyAttachments = reply.is_e2ee ? (replyPayload?.attachments || []) : (reply.attachments || []);
          const replyHasText = typeof replyPayload?.text === "string" && replyPayload.text.length > 0;
          const replyText = reply.is_e2ee
            ? (replyHasText ? replyPayload.text : (replyAttachments.length > 0 ? "" : "Encrypted message"))
            : reply.content;

          return (
            <div key={reply.id} className="flex gap-2.5 fade-in" data-testid={`thread-reply-${reply.id}`}>
              <div className="w-7 h-7 rounded-full bg-[#27272A] flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                {reply.author?.display_name?.[0]?.toUpperCase() || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold text-white">{reply.author?.display_name}</span>
                  <span className="text-[10px] text-[#52525B]">{new Date(reply.created_at).toLocaleTimeString()}</span>
                </div>
                {reply.reply_to_id && (
                  <div className="mt-1.5 mb-1.5 max-w-[250px]">
                    <MessageReferencePreview
                      message={thread.parent}
                      onClick={focusParentMessage}
                      className="bg-[#101114]"
                    />
                  </div>
                )}
                {reply.is_e2ee ? <EncryptedBadge /> : null}
                <p className="text-sm text-[#E4E4E7] mt-0.5 break-words">{replyText}</p>
                {renderAttachments(replyAttachments, Boolean(reply.is_e2ee))}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <form onSubmit={sendReply} className="p-3 border-t border-[#27272A]">
        <div className="flex items-center gap-2 bg-[#27272A] rounded-lg px-3 py-2">
          <input
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={canUseE2EEThread ? t("thread.placeholder") : t("e2ee.threadVerifyDevice")}
            disabled={!canUseE2EEThread}
            data-testid="thread-reply-input"
            className="flex-1 bg-transparent text-sm text-white placeholder:text-[#52525B] outline-none disabled:text-[#71717A]"
          />
          <button
            type="submit"
            disabled={!canUseE2EEThread || !content.trim() || sending}
            data-testid="thread-reply-send"
            className="text-[#6366F1] hover:text-[#4F46E5] disabled:text-[#52525B] transition-colors"
          >
            <PaperPlaneRight size={18} weight="fill" />
          </button>
        </div>
      </form>
    </div>
  );
}
