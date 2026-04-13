/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Paperclip, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useE2EE } from "@/contexts/E2EEContext";
import api from "@/lib/api";

/**
 * Page-local DM composer. It intentionally stays within the MainLayout module
 * because its E2EE and attachment flow is specific to the DM workspace view.
 */
export default function DirectMessageComposer({ userId, onSent, e2eeReady }) {
  const { t } = useTranslation();
  const { fetchDmRecipients, encryptForRecipients, uploadEncryptedAttachment } = useE2EE();
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const fileInputRef = useRef(null);

  const send = async (event) => {
    event.preventDefault();
    if ((!content.trim() && pendingAttachments.length === 0) || sending) {
      return;
    }

    setSending(true);
    try {
      let payload = { content: content.trim(), is_encrypted: false };
      if (e2eeReady) {
        const recipients = await fetchDmRecipients(userId);
        const attachmentRefs = [];
        const attachmentManifests = [];
        for (const attachment of pendingAttachments) {
          if (!attachment.localFile) {
            continue;
          }
          const uploaded = await uploadEncryptedAttachment({
            file: attachment.localFile,
            scopeKind: "dm",
            scopeId: userId,
            recipientsResponse: recipients,
          });
          attachmentRefs.push(uploaded.serverAttachment);
          attachmentManifests.push(uploaded.manifest);
        }
        const encrypted = await encryptForRecipients({
          text: content.trim(),
          attachments: attachmentManifests,
        }, recipients);
        payload = {
          content: "[Encrypted message]",
          attachments: attachmentRefs,
          encrypted_content: encrypted.ciphertext,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          sender_device_id: encrypted.sender_device_id,
          protocol_version: encrypted.protocol_version,
          is_encrypted: true,
          is_e2ee: true,
          key_envelopes: encrypted.key_envelopes,
        };
      }
      const response = await api.post(`/dm/${userId}`, payload);
      onSent(response.data);
      setContent("");
      setPendingAttachments([]);
    } catch {
      toast.error(t("dm.sendFailed"));
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large (max 10 MB).");
      event.target.value = "";
      return;
    }
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
  };

  return (
    <form onSubmit={send} className="p-4 border-t border-[#27272A]">
      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingAttachments.map((attachment) => (
            <div key={attachment.id} className="flex items-center gap-2 rounded-md border border-[#27272A] bg-[#121212] px-3 py-2 text-xs text-[#E4E4E7]">
              <Paperclip size={14} className="text-[#71717A]" />
              <span className="max-w-[240px] truncate">{attachment.name}</span>
              <button
                type="button"
                onClick={() => setPendingAttachments((previous) => previous.filter((entry) => entry.id !== attachment.id))}
                className="text-[#71717A] transition-colors hover:text-white"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileUpload}
          className="hidden"
          accept="image/*,.pdf,.txt,.zip,.doc,.docx"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!e2eeReady}
          className="rounded-lg border border-[#27272A]/50 bg-[#27272A] px-3 py-2.5 text-[#A1A1AA] transition-colors hover:text-white disabled:text-[#52525B]"
        >
          <Paperclip size={18} />
        </button>
        <input
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder={e2eeReady ? t("dm.encryptedMessage") : t("e2ee.dmVerifyDevice")}
          disabled={!e2eeReady}
          data-testid="dm-message-input"
          className="flex-1 bg-[#27272A] border border-[#27272A]/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-[#52525B] outline-none focus:border-[#6366F1]/50 disabled:text-[#71717A]"
        />
        <button
          type="submit"
          disabled={!e2eeReady || (!content.trim() && pendingAttachments.length === 0) || sending}
          data-testid="dm-send-button"
          className="bg-[#6366F1] hover:bg-[#4F46E5] text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {t("common.send")}
        </button>
      </div>
      {e2eeReady && (
        <p className="text-[10px] text-[#6366F1] mt-1 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" /> {t("dm.e2eeEncrypted")}
        </p>
      )}
    </form>
  );
}
