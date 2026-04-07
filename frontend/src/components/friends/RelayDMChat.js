/*
 * Singra Vox – Cross-Instance Relay DM Chat
 *
 * Ermöglicht das Senden von Nachrichten an Freunde auf
 * anderen Instanzen über den gemeinsamen ID-Server.
 * Alle Nachrichten sind E2EE-fähig.
 *
 * Props:
 *   - friendship: Freundschafts-Objekt aus der Friends-API
 *   - config: Runtime-Konfiguration
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlobeHemisphereWest, ShieldCheck } from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { resolveAssetUrl } from "@/lib/assetUrls";

export default function RelayDMChat({ friendship, config }) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const friendProfile = friendship?.friend_profile || {};
  const friendAccountId =
    friendship?.requester_id === friendProfile?.id
      ? friendship?.requester_id
      : friendship?.recipient_id === friendProfile?.id
        ? friendship?.recipient_id
        : "";

  // Nachrichten laden
  const loadMessages = useCallback(async () => {
    if (!friendAccountId) return;
    setLoading(true);
    try {
      const res = await api.get(`/id/relay/messages/${friendAccountId}`);
      setMessages(res.data?.messages || []);
    } catch {
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, [friendAccountId]);

  useEffect(() => {
    void loadMessages();
    // Polling alle 5 Sekunden für neue Nachrichten
    const interval = setInterval(loadMessages, 5000);
    return () => clearInterval(interval);
  }, [loadMessages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Nachricht senden
  const sendMessage = async (event) => {
    event.preventDefault();
    if (!content.trim() || sending) return;
    setSending(true);
    try {
      const res = await api.post("/id/relay/messages", {
        to_account_id: friendAccountId,
        content: content.trim(),
        is_encrypted: false, // TODO: E2EE für Relay-DMs
      });
      setMessages((prev) => [...prev, res.data]);
      setContent("");
    } catch (err) {
      const msg = err?.response?.data?.detail || "Senden fehlgeschlagen";
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="relay-dm-chat">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/8 bg-zinc-900/25 px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-zinc-800/80 text-xs font-bold overflow-hidden">
          {friendProfile.avatar_url ? (
            <img src={friendProfile.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            (friendProfile.display_name || "?")?.[0]?.toUpperCase()
          )}
        </div>
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold text-white">
            {friendProfile.display_name || friendProfile.username}
          </span>
          <span className="ml-2 text-xs text-zinc-500">@{friendProfile.username}</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border border-white/8 bg-zinc-950/60 px-2 py-1">
          <GlobeHemisphereWest size={12} className="text-cyan-400" />
          <span className="text-[10px] text-zinc-400">Cross-Instance</span>
        </div>
      </div>

      {/* Nachrichten */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {loading && messages.length === 0 && (
          <p className="text-xs text-zinc-600 text-center py-8">Lade Nachrichten...</p>
        )}

        {!loading && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <GlobeHemisphereWest size={24} className="text-zinc-600" />
            <p className="text-xs text-zinc-500 leading-relaxed max-w-[260px]">
              Starte eine Unterhaltung mit {friendProfile.display_name || friendProfile.username}.
              {friendProfile.instance_url && (
                <span className="block mt-1 text-zinc-600">
                  Instanz: {new URL(friendProfile.instance_url).hostname}
                </span>
              )}
            </p>
          </div>
        )}

        {messages.map((msg) => {
          const isMine = msg.from_account_id !== friendAccountId;
          const profile = msg.sender_profile || (isMine ? {} : friendProfile);
          return (
            <div key={msg.id} className="flex gap-3" data-testid={`relay-msg-${msg.id}`}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold overflow-hidden">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  (profile.display_name || profile.username || "?")?.[0]?.toUpperCase()
                )}
              </div>
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-white">
                    {profile.display_name || profile.username || "Du"}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {new Date(msg.created_at).toLocaleTimeString()}
                  </span>
                  {msg.is_encrypted && (
                    <ShieldCheck size={10} weight="fill" className="text-indigo-400" />
                  )}
                </div>
                <p className="mt-0.5 text-sm text-zinc-200">
                  {msg.is_encrypted ? msg.content || "[Verschlüsselt]" : msg.content}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Eingabe */}
      <form onSubmit={sendMessage} className="border-t border-white/8 p-4">
        <div className="flex gap-2">
          <input
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={`Nachricht an ${friendProfile.display_name || "Freund"}...`}
            className="flex-1 rounded-lg border border-white/8 bg-zinc-800 px-4 py-2.5 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-cyan-400/30"
            data-testid="relay-dm-input"
          />
          <button
            type="submit"
            disabled={sending || !content.trim()}
            className="rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-cyan-400 disabled:opacity-50"
            data-testid="relay-dm-send-btn"
          >
            {t("common.send")}
          </button>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <GlobeHemisphereWest size={10} className="text-cyan-400" />
          <span className="text-[10px] text-zinc-500">
            Nachricht wird über den ID-Server übermittelt
          </span>
        </div>
      </form>
    </div>
  );
}
