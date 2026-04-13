/*
 * Singra Vox – Friends Panel
 *
 * Zeigt die Freundesliste, offene Anfragen und ermöglicht das
 * Hinzufügen von Freunden über Singra-ID (SVID).
 *
 * Features:
 *   - Freundesliste mit Online-Status und Instanz-Info
 *   - Eingehende/Ausgehende Anfragen mit Annehmen/Ablehnen
 *   - Nutzer per SVID-Username suchen und hinzufügen
 *   - Cross-Instance DM starten (über den ID-Server)
 *
 * Props:
 *   - onStartRelayDm: Callback wenn ein Cross-Instance DM gestartet wird
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  ChatCircleDots,
  MagnifyingGlass,
  ShieldCheck,
  Trash,
  UserPlus,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Tabs innerhalb des Friends-Panels
const TABS = [
  { id: "friends",  label: "Freunde" },
  { id: "requests", label: "Anfragen" },
  { id: "add",      label: "Hinzufügen" },
];

export default function FriendsPanel({ onStartRelayDm }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("friends");
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState({ incoming: [], outgoing: [] });
  const [loading, setLoading] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [hasSvid, setHasSvid] = useState(true); // Optimistisch annehmen

  // Freundesliste laden
  const loadFriends = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/id/friends");
      setFriends(res.data || []);
      setHasSvid(true);
    } catch (err) {
      if (err?.response?.status === 403) {
        setHasSvid(false);
      }
      setFriends([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Anfragen laden
  const loadRequests = useCallback(async () => {
    try {
      const res = await api.get("/id/friends/requests");
      setRequests(res.data || { incoming: [], outgoing: [] });
    } catch {
      setRequests({ incoming: [], outgoing: [] });
    }
  }, []);

  useEffect(() => {
    void loadFriends();
    void loadRequests();
  }, [loadFriends, loadRequests]);

  // Freundschaftsanfrage senden
  const sendFriendRequest = async () => {
    if (!addUsername.trim()) return;
    setAddLoading(true);
    try {
      await api.post("/id/friends/request", {
        recipient_username: addUsername.trim(),
      });
      toast.success(`Freundschaftsanfrage an @${addUsername.trim()} gesendet`);
      setAddUsername("");
      void loadRequests();
    } catch (err) {
      const msg = err?.response?.data?.detail || "Anfrage fehlgeschlagen";
      toast.error(msg);
    } finally {
      setAddLoading(false);
    }
  };

  // Anfrage annehmen
  const acceptRequest = async (id) => {
    try {
      await api.post(`/id/friends/${id}/accept`);
      toast.success("Freundschaftsanfrage angenommen");
      void loadFriends();
      void loadRequests();
    } catch (err) {
      toast.error(formatAppError(t, err, { fallbackKey: "friends.acceptFailed" }));
    }
  };

  // Anfrage ablehnen
  const declineRequest = async (id) => {
    try {
      await api.post(`/id/friends/${id}/decline`);
      toast.success("Anfrage abgelehnt");
      void loadRequests();
    } catch (err) {
      toast.error(formatAppError(t, err, { fallbackKey: "friends.declineFailed" }));
    }
  };

  // Freund entfernen
  const removeFriend = async (id) => {
    if (!window.confirm("Freundschaft wirklich beenden?")) return;
    try {
      await api.delete(`/id/friends/${id}`);
      toast.success("Freund entfernt");
      void loadFriends();
    } catch (err) {
      toast.error(formatAppError(t, err, { fallbackKey: "friends.removeFailed" }));
    }
  };

  // Kein SVID-Account
  if (!hasSvid) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8 text-center" data-testid="friends-no-svid">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-800/60">
          <ShieldCheck size={24} className="text-zinc-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-zinc-300">Singra-ID erforderlich</p>
          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
            Um Freunde hinzuzufügen und instanzübergreifend zu chatten,
            benötigst du einen Singra-ID Account.
          </p>
        </div>
        <Button
          onClick={() => navigate("/setup-svid")}
          className="rounded-xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300 text-sm"
          data-testid="friends-register-svid-btn"
        >
          <UserPlus size={14} className="mr-2" />
          Singra-ID einrichten
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="friends-panel">
      {/* Tab-Navigation */}
      <div className="flex gap-1 border-b border-white/8 px-3 py-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-cyan-500/12 text-cyan-300"
                : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
            }`}
            data-testid={`friends-tab-${tab.id}`}
          >
            {tab.label}
            {tab.id === "requests" && (requests.incoming?.length || 0) > 0 && (
              <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                {requests.incoming.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab-Inhalt */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* Freundesliste */}
        {activeTab === "friends" && (
          <div className="space-y-1" data-testid="friends-list">
            {loading && <p className="text-xs text-zinc-600 py-4 text-center">Lade Freunde...</p>}
            {!loading && friends.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                <UsersThree size={24} className="text-zinc-600" />
                <p className="text-xs text-zinc-500">
                  Noch keine Freunde.{" "}
                  <button onClick={() => setActiveTab("add")} className="text-cyan-400 hover:underline">
                    Jetzt hinzufügen
                  </button>
                </p>
              </div>
            )}
            {friends.map((f) => {
              const profile = f.friend_profile || {};
              return (
                <div
                  key={f.id}
                  className="flex items-center gap-3 rounded-xl border border-white/6 bg-zinc-950/40 px-3 py-2.5 transition-colors hover:border-white/10"
                  data-testid={`friend-${f.id}`}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-bold text-zinc-300">
                    {profile.avatar_url ? (
                      <img src={profile.avatar_url} alt="" className="h-full w-full rounded-full object-cover" />
                    ) : (
                      (profile.display_name || profile.username || "?")?.[0]?.toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">
                      {profile.display_name || profile.username}
                    </p>
                    <p className="truncate text-xs text-zinc-500">
                      @{profile.username}
                      {profile.instance_url && (
                        <span className="ml-1 text-zinc-600">
                          ({new URL(profile.instance_url).hostname})
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button
                      onClick={() => onStartRelayDm?.(f)}
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-cyan-400"
                      title="Nachricht senden"
                      data-testid={`friend-dm-${f.id}`}
                    >
                      <ChatCircleDots size={16} />
                    </button>
                    <button
                      onClick={() => removeFriend(f.id)}
                      className="rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-white/5 hover:text-red-400"
                      title="Freund entfernen"
                    >
                      <Trash size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Anfragen */}
        {activeTab === "requests" && (
          <div className="space-y-4" data-testid="friends-requests">
            {/* Eingehend */}
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
                Eingehend ({(requests.incoming || []).length})
              </p>
              {(requests.incoming || []).length === 0 ? (
                <p className="text-xs text-zinc-600 py-2">Keine offenen Anfragen</p>
              ) : (
                <div className="space-y-1">
                  {(requests.incoming || []).map((r) => {
                    const profile = r.requester_profile || {};
                    return (
                      <div key={r.id} className="flex items-center gap-3 rounded-xl border border-white/6 bg-zinc-950/40 px-3 py-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">
                          {(profile.display_name || "?")?.[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">{profile.display_name || profile.username}</p>
                          <p className="truncate text-xs text-zinc-500">@{profile.username}</p>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" onClick={() => acceptRequest(r.id)} className="h-7 rounded-lg bg-cyan-400 px-3 text-xs text-zinc-950 hover:bg-cyan-300">
                            Annehmen
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => declineRequest(r.id)} className="h-7 rounded-lg border-white/10 bg-transparent text-xs text-zinc-400 hover:bg-white/5">
                            Ablehnen
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Ausgehend */}
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
                Ausgehend ({(requests.outgoing || []).length})
              </p>
              {(requests.outgoing || []).length === 0 ? (
                <p className="text-xs text-zinc-600 py-2">Keine ausstehenden Anfragen</p>
              ) : (
                <div className="space-y-1">
                  {(requests.outgoing || []).map((r) => {
                    const profile = r.recipient_profile || {};
                    return (
                      <div key={r.id} className="flex items-center gap-3 rounded-xl border border-white/6 bg-zinc-950/40 px-3 py-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-xs font-bold text-zinc-300">
                          {(profile.display_name || "?")?.[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">{profile.display_name || profile.username}</p>
                          <p className="truncate text-xs text-zinc-500">@{profile.username}</p>
                        </div>
                        <span className="text-xs text-zinc-600">Ausstehend</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Freund hinzufügen */}
        {activeTab === "add" && (
          <div className="space-y-4" data-testid="friends-add">
            <div className="rounded-xl border border-white/8 bg-zinc-950/50 p-4">
              <h4 className="text-sm font-semibold text-white">Freund per Singra-ID hinzufügen</h4>
              <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
                Gib den Singra-ID Benutzernamen ein. Nutzer auf verschiedenen
                Instanzen können sich als Freunde hinzufügen, solange beide
                denselben ID-Server nutzen.
              </p>
              <div className="mt-3 flex gap-2">
                <div className="relative flex-1">
                  <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                  <Input
                    value={addUsername}
                    onChange={(e) => setAddUsername(e.target.value)}
                    placeholder="username"
                    className="bg-zinc-950/70 border-white/10 text-white pl-9"
                    onKeyDown={(e) => { if (e.key === "Enter") void sendFriendRequest(); }}
                    data-testid="friends-add-input"
                  />
                </div>
                <Button
                  onClick={sendFriendRequest}
                  disabled={addLoading || !addUsername.trim()}
                  className="rounded-xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300"
                  data-testid="friends-add-btn"
                >
                  <UserPlus size={14} className="mr-1.5" />
                  {addLoading ? "Sende..." : "Anfrage"}
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-white/8 bg-zinc-950/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <ShieldCheck size={16} className="text-emerald-400" />
                <h4 className="text-sm font-semibold text-white">Datenschutz</h4>
              </div>
              <ul className="space-y-1 text-xs text-zinc-400 leading-relaxed">
                <li>Nachrichten zwischen Freunden sind Ende-zu-Ende verschlüsselt</li>
                <li>Der ID-Server speichert nur verschlüsselte Daten</li>
                <li>Nur akzeptierte Freunde können dir Nachrichten senden</li>
                <li>Du kannst Freundschaften jederzeit beenden</li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
