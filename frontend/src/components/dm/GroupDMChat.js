/*
 * Singra Vox – Group DM Chat
 *
 * Chat-Ansicht für Gruppen-DMs mit E2EE-Support.
 * Zeigt Nachrichtenverlauf, Mitgliederliste und Eingabefeld.
 *
 * Props:
 *   - group: Gruppen-Objekt mit {id, name, members}
 *   - resolveAssetUrl: Asset-URL Resolver
 *   - config: Runtime-Konfiguration
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Paperclip, ShieldCheck, UsersThree, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { useE2EE } from "@/contexts/E2EEContext";
import { resolveAssetUrl } from "@/lib/assetUrls";
import { formatAppError } from "@/lib/appErrors";
import E2EEStatus from "@/components/security/E2EEStatus";

export default function GroupDMChat({ group, config }) {
  const { t } = useTranslation();
  const {
    ready: e2eeReady,
    encryptForRecipients,
    decryptMessage,
    fetchGroupRecipients,
    uploadEncryptedAttachment,
    downloadAndDecryptAttachment,
  } = useE2EE();

  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Nachrichten laden
  const loadMessages = useCallback(async () => {
    if (!group?.id) return;
    try {
      const res = await api.get(`/groups/${group.id}/messages`);
      setMessages(res.data?.messages || res.data || []);
    } catch {
      setMessages([]);
    }
  }, [group?.id]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Nachricht senden
  const sendMessage = async (event) => {
    event.preventDefault();
    if ((!content.trim() && pendingAttachments.length === 0) || sending) return;

    setSending(true);
    try {
      let payload = { content: content.trim(), is_encrypted: false };

      if (e2eeReady) {
        const recipients = await fetchGroupRecipients(group.id);
        const attachmentRefs = [];
        const attachmentManifests = [];

        for (const attachment of pendingAttachments) {
          if (!attachment.localFile) continue;
          const uploaded = await uploadEncryptedAttachment({
            file: attachment.localFile,
            scopeKind: "group",
            scopeId: group.id,
            recipientsResponse: recipients,
          });
          attachmentRefs.push(uploaded.serverAttachment);
          attachmentManifests.push(uploaded.manifest);
        }

        const encrypted = await encryptForRecipients(
          { text: content.trim(), attachments: attachmentManifests },
          recipients,
        );
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

      const res = await api.post(`/groups/${group.id}/messages`, payload);
      setMessages((prev) => [...prev, res.data]);
      setContent("");
      setPendingAttachments([]);
    } catch (err) {
      toast.error(formatAppError(t, err, { fallbackKey: "dm.sendFailed" }));
    } finally {
      setSending(false);
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Datei zu groß (max. 10 MB)");
      event.target.value = "";
      return;
    }
    setPendingAttachments((prev) => [
      ...prev,
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

  const memberNames = (group?.members || [])
    .slice(0, 3)
    .map((m) => m.display_name || m.username)
    .join(", ");
  const groupDisplayName = group?.name || memberNames || "Gruppe";

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="group-dm-chat">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/8 bg-zinc-900/25 px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-zinc-800/80">
          <UsersThree size={16} className="text-zinc-400" />
        </div>
        <span className="font-semibold text-sm text-white">{groupDisplayName}</span>
        <span className="text-xs text-zinc-500">
          {(group?.members || []).length} Mitglieder
        </span>
        <button
          onClick={() => setShowMembers(!showMembers)}
          className={`ml-auto rounded-lg p-1.5 transition-colors ${
            showMembers ? "bg-cyan-500/15 text-cyan-400" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"
          }`}
          data-testid="group-dm-members-toggle"
        >
          <UsersThree size={16} />
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Nachrichten-Bereich */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {!e2eeReady ? (
              <E2EEStatus variant="guard" scope="group" ready={e2eeReady} className="workspace-card p-6" />
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className="flex gap-3 fade-in" data-testid={`group-msg-${msg.id}`}>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-800 text-xs font-bold">
                    {msg.sender?.avatar_url ? (
                      <img
                        src={resolveAssetUrl(msg.sender.avatar_url, config?.assetBase)}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      msg.sender?.display_name?.[0]?.toUpperCase() || "?"
                    )}
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-white">
                        {msg.sender?.display_name || msg.sender?.username || "?"}
                      </span>
                      <span className="text-[10px] text-zinc-500">
                        {new Date(msg.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-zinc-200">
                      {msg.is_encrypted || msg.is_e2ee ? (
                        <span className="flex items-center gap-1">
                          <ShieldCheck size={12} weight="fill" className="text-indigo-400" />
                          <DecryptedGroupContent msg={msg} config={config} />
                        </span>
                      ) : (
                        msg.content
                      )}
                    </p>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Eingabe */}
          {e2eeReady && (
            <form onSubmit={sendMessage} className="border-t border-white/8 p-4">
              {pendingAttachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {pendingAttachments.map((att) => (
                    <div key={att.id} className="flex items-center gap-2 rounded-md border border-white/8 bg-zinc-900 px-3 py-2 text-xs text-zinc-300">
                      <Paperclip size={14} className="text-zinc-500" />
                      <span className="max-w-[200px] truncate">{att.name}</span>
                      <button type="button" onClick={() => setPendingAttachments((p) => p.filter((a) => a.id !== att.id))} className="text-zinc-500 hover:text-white">
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input ref={fileInputRef} type="file" onChange={handleFileUpload} className="hidden" accept="image/*,.pdf,.txt,.zip,.doc,.docx" />
                <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg border border-white/8 bg-zinc-800 px-3 py-2.5 text-zinc-400 transition-colors hover:text-white">
                  <Paperclip size={18} />
                </button>
                <input
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Verschlüsselte Nachricht..."
                  className="flex-1 rounded-lg border border-white/8 bg-zinc-800 px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-cyan-400/30"
                  data-testid="group-dm-message-input"
                />
                <button
                  type="submit"
                  disabled={sending || (!content.trim() && pendingAttachments.length === 0)}
                  className="rounded-lg bg-indigo-500 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
                  data-testid="group-dm-send-btn"
                >
                  {t("common.send")}
                </button>
              </div>
              <p className="mt-1 flex items-center gap-1 text-[10px] text-indigo-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                E2EE verschlüsselt
              </p>
            </form>
          )}
        </div>

        {/* Mitglieder-Panel */}
        {showMembers && (
          <div className="w-56 shrink-0 overflow-y-auto border-l border-white/8 bg-zinc-950/40 p-3">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
              Mitglieder ({(group?.members || []).length})
            </p>
            <div className="space-y-1">
              {(group?.members || []).map((m) => (
                <div key={m.id || m.user_id} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold text-zinc-300">
                    {m.avatar_url ? (
                      <img src={resolveAssetUrl(m.avatar_url, config?.assetBase)} alt="" className="h-full w-full rounded-full object-cover" />
                    ) : (
                      (m.display_name || m.username || "?")?.[0]?.toUpperCase()
                    )}
                  </div>
                  <span className="truncate text-xs text-zinc-300">
                    {m.display_name || m.username}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Entschlüsselt eine Gruppen-DM Nachricht (E2EE).
 * Nutzt den E2EE-Kontext um den Klartext zu ermitteln.
 */
function DecryptedGroupContent({ msg, config }) {
  const { decryptMessage, downloadAndDecryptAttachment, ready: e2eeReady } = useE2EE();
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    if (!e2eeReady || !msg.is_encrypted) return;
    let cancelled = false;
    (async () => {
      try {
        const decrypted = await decryptMessage(msg);
        if (!cancelled) setPayload(decrypted);
      } catch {
        if (!cancelled) setPayload({ text: "[Entschlüsselung fehlgeschlagen]" });
      }
    })();
    return () => { cancelled = true; };
  }, [decryptMessage, e2eeReady, msg]);

  if (!payload) return <span className="text-zinc-500 italic">Entschlüssele...</span>;
  return <span>{payload.text || msg.content}</span>;
}
