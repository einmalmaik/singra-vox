/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Paperclip } from "@phosphor-icons/react";
import { useE2EE } from "@/contexts/E2EEContext";

/**
 * Renders decrypted DM content inside the page-local DM workspace view.
 * This stays local because the decryption and attachment semantics are tightly
 * coupled to the direct-message flow.
 */
export default function DecryptedDirectMessageContent({ msg, config }) {
  const { t } = useTranslation();
  const { decryptMessage, downloadAndDecryptAttachment, ready: e2eeReady } = useE2EE();
  const [payload, setPayload] = useState(null);
  const [statusText, setStatusText] = useState(null);

  const decrypt = useCallback(async () => {
    try {
      if (!e2eeReady) {
        setStatusText(t("e2ee.dmVerifyDevice"));
        return;
      }
      const decrypted = await decryptMessage(msg);
      setPayload(decrypted);
      setStatusText(decrypted?.text ? null : t("dm.cannotDecrypt"));
    } catch {
      setStatusText(t("dm.encryptedFallback"));
    }
  }, [decryptMessage, e2eeReady, msg, t]);

  useEffect(() => {
    if ((msg.is_encrypted || msg.is_e2ee) && (msg.encrypted_content || msg.ciphertext) && msg.nonce) {
      void decrypt();
    }
  }, [decrypt, msg.ciphertext, msg.encrypted_content, msg.is_e2ee, msg.is_encrypted, msg.nonce]);

  if (!msg.is_encrypted && !msg.is_e2ee) {
    return msg.content;
  }

  const hasText = typeof payload?.text === "string" && payload.text.length > 0;
  const attachments = payload?.attachments || msg.attachments || [];

  const renderAttachments = () => {
    if (!attachments.length) {
      return null;
    }
    return (
      <div className="mt-2 space-y-1">
        {attachments.map((attachment, index) => (
          <button
            key={`${attachment.blob_id || attachment.id || attachment.name || "attachment"}-${index}`}
            type="button"
            onClick={async () => {
              if (msg.is_e2ee) {
                const { url } = await downloadAndDecryptAttachment(attachment);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = attachment.name || "encrypted-attachment";
                anchor.click();
                window.setTimeout(() => URL.revokeObjectURL(url), 5000);
                return;
              }
              if (attachment.url) {
                window.open(`${config?.assetBase || ""}${attachment.url}`, "_blank", "noopener,noreferrer");
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

  return (
    <span className="flex flex-col gap-1">
      {(hasText || (!attachments.length && (statusText || !payload))) && (
        <span className="italic text-[#A1A1AA]">
          {hasText ? payload.text : (statusText || t("dm.decrypting"))}
        </span>
      )}
      {renderAttachments()}
    </span>
  );
}
