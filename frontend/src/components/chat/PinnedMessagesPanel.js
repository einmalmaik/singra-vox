/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Paperclip, PushPin, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import MessageReferencePreview from "@/components/chat/MessageReferencePreview";
import { useE2EE } from "@/contexts/E2EEContext";
import E2EEStatus from "@/components/security/E2EEStatus";

export default function PinnedMessagesPanel({ channel, channelId, onClose, onJumpToMessage, refreshKey }) {
  const { t } = useTranslation();
  const {
    ready: e2eeReady,
    isDesktopCapable,
    decryptMessage,
    downloadAndDecryptAttachment,
  } = useE2EE();
  const [pins, setPins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [decryptedPins, setDecryptedPins] = useState({});
  const isE2EEChannel = Boolean(channel?.is_private);
  const canReadE2EEPins = !isE2EEChannel || e2eeReady;

  const loadPins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/channels/${channelId}/pins`);
      setPins(res.data);
      setDecryptedPins({});
    } catch {
      setPins([]);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    if (channelId) {
      loadPins();
    }
  }, [channelId, loadPins, refreshKey]);

  useEffect(() => {
    if (!isE2EEChannel || !canReadE2EEPins) {
      return;
    }

    let cancelled = false;
    const encryptedPins = pins.filter((pin) => pin.is_e2ee && !decryptedPins[pin.id]);
    if (!encryptedPins.length) {
      return;
    }

    (async () => {
      const resolvedPins = await Promise.all(
        encryptedPins.map(async (pin) => ({
          id: pin.id,
          payload: await decryptMessage(pin),
        })),
      );

      if (cancelled) {
        return;
      }

      setDecryptedPins((previous) => {
        const next = { ...previous };
        resolvedPins.forEach((entry) => {
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
  }, [canReadE2EEPins, decryptMessage, decryptedPins, isE2EEChannel, pins]);

  const unpin = async (msgId) => {
    try {
      await api.delete(`/messages/${msgId}/pin`);
      setPins(prev => prev.filter(p => p.id !== msgId));
    } catch {}
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

  return (
    <div className="w-[320px] bg-[#121212] border-l border-[#27272A] flex flex-col shrink-0" data-testid="pinned-panel">
      <div className="h-12 flex items-center justify-between px-4 border-b border-[#27272A] shrink-0">
        <div className="flex items-center gap-2">
          <PushPin size={16} weight="fill" className="text-[#F59E0B]" />
          <h3 className="text-sm font-bold text-white" style={{ fontFamily: 'Manrope' }}>
            {t("pinned.title")}
          </h3>
          <span className="text-[10px] text-[#71717A] bg-[#27272A] rounded-full px-1.5">{pins.length}</span>
        </div>
        <button onClick={onClose} className="text-[#71717A] hover:text-white transition-colors" data-testid="close-pins">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-5 h-5 border-2 border-[#6366F1] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !canReadE2EEPins ? (
          <E2EEStatus
            variant="guard"
            scope="pins"
            ready={e2eeReady}
            isDesktopCapable={isDesktopCapable}
          />
        ) : pins.length === 0 ? (
            <div className="text-center py-8">
              <PushPin size={32} className="text-[#27272A] mx-auto mb-2" />
            <p className="text-sm text-[#71717A]">{t("pinned.empty")}</p>
            <p className="text-xs text-[#52525B] mt-1">{t("pinned.emptyHelp")}</p>
          </div>
        ) : (
          pins.map(pin => (
            (() => {
              const decryptedPayload = pin.is_e2ee ? decryptedPins[pin.id] : null;
              const decryptedAttachments = decryptedPayload?.attachments || [];
              const hasDecryptedText = typeof decryptedPayload?.text === "string" && decryptedPayload.text.length > 0;
              const hasDecryptedAttachments = decryptedAttachments.length > 0;
              const displayContent = pin.is_e2ee
                ? (hasDecryptedText ? decryptedPayload.text : (hasDecryptedAttachments ? "" : "Encrypted message"))
                : pin.content;
              const displayAttachments = pin.is_e2ee
                ? decryptedAttachments
                : (pin.attachments || []);
              return (
            <div key={pin.id} className="bg-[#18181B] border border-[#27272A] rounded-lg p-3 group" data-testid={`pin-${pin.id}`}>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-[#27272A] flex items-center justify-center text-[10px] font-bold">
                    {pin.author?.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <span className="text-xs font-semibold">{pin.author?.display_name}</span>
                </div>
                <button onClick={() => unpin(pin.id)} data-testid={`unpin-${pin.id}`}
                  className="hidden group-hover:block text-[#71717A] hover:text-[#EF4444] transition-colors">
                  <X size={12} />
                </button>
              </div>
              <div className="space-y-2">
                {pin.is_e2ee && (
                  <E2EEStatus variant="badge" />
                )}
                {displayContent ? (
                  <p className="text-sm text-[#E4E4E7] break-words whitespace-pre-wrap">
                    {displayContent}
                  </p>
                ) : null}
                {displayAttachments.length > 0 && (
                  <div className="space-y-1">
                    {displayAttachments.map((attachment, index) => (
                      <button
                        key={`${pin.id}-attachment-${index}`}
                        type="button"
                        onClick={() => {
                          if (pin.is_e2ee) {
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
                )}
                {pin.reply_to_id && (
                  <MessageReferencePreview
                    message={null}
                    placeholder={t("pinned.replyReference")}
                    className="bg-[#111214]"
                  />
                )}
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[9px] text-[#52525B]">{new Date(pin.pinned_at || pin.created_at).toLocaleString()}</p>
                  {typeof onJumpToMessage === "function" && (
                    <button
                      type="button"
                      onClick={() => onJumpToMessage(pin.id)}
                      className="rounded-md border border-[#3F3F46] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#D4D4D8] transition-colors hover:border-[#6366F1] hover:text-white"
                    >
                      {t("pinned.jump")}
                    </button>
                  )}
                </div>
              </div>
            </div>
              );
            })()
          ))
        )}
      </div>
    </div>
  );
}
