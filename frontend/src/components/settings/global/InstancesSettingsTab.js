/*
 * Singra Vox – Instance switcher settings tab
 * Save, connect, and manage self-hosted Singra Vox instances.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DesktopTower, Plus, Trash, WifiHigh } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useRuntime } from "@/contexts/RuntimeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getSavedInstances,
  saveInstance,
  removeInstance,
  getInstancePassword,
  getActiveInstanceUrl,
  markInstanceUsed,
  toggleInstanceFavorite,
  sortedInstances,
} from "@/lib/instanceManager";
import { SETTINGS_INPUT_CLASSNAME } from "../settingsConstants";

export default function InstancesSettingsTab() {
  const { t } = useTranslation();
  const { connectToInstance } = useRuntime();

  const [savedInstances, setSavedInstances] = useState(() => getSavedInstances());
  const [newInstanceName, setNewInstanceName] = useState("");
  const [newInstanceUrl, setNewInstanceUrl] = useState("");
  const [newInstanceEmail, setNewInstanceEmail] = useState("");
  const [newInstancePassword, setNewInstancePassword] = useState("");
  const [switchingInstance, setSwitchingInstance] = useState("");

  const handleConnect = async (inst) => {
    setSwitchingInstance(inst.id);
    try {
      await connectToInstance(inst.url);
      setSavedInstances(markInstanceUsed(inst.id));
      const pw = getInstancePassword(inst);
      if (inst.email && pw) {
        try {
          const res = await fetch(`${inst.url}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: inst.email, password: pw }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.access_token) {
              window.localStorage.setItem(
                "singravox.autoloading",
                JSON.stringify({ accessToken: data.access_token, refreshToken: data.refresh_token || "" }),
              );
            }
          }
        } catch { /* Auto-Login fehlgeschlagen */ }
      }
      toast.success(`Verbunden mit ${inst.name}`);
      setTimeout(() => window.location.reload(), 500);
    } catch {
      toast.error("Verbindung fehlgeschlagen");
    } finally {
      setSwitchingInstance("");
    }
  };

  const activeUrl = getActiveInstanceUrl() || window.location.origin;

  return (
    <div className="space-y-6" data-testid="instances-settings-panel">
      {/* Active connection */}
      <section className="workspace-card p-5">
        <div className="flex items-center gap-3 mb-4">
          <WifiHigh size={18} className="text-cyan-400" />
          <div>
            <h3 className="text-base font-bold" style={{ fontFamily: "Manrope" }}>Aktive Verbindung</h3>
            <p className="text-xs text-zinc-500 mt-0.5 truncate">{activeUrl}</p>
          </div>
          <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Verbunden
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl border-white/10 bg-white/[0.03] text-zinc-300 hover:bg-white/8 text-xs"
          onClick={() => {
            const name = activeUrl.replace(/^https?:\/\//, "").split("/")[0];
            setSavedInstances(saveInstance({ name, url: activeUrl }));
            toast.success("Instanz gespeichert");
          }}
          data-testid="save-current-instance-btn"
        >
          <Plus size={13} className="mr-1.5" />
          Zu gespeicherten Instanzen hinzufügen
        </Button>
      </section>

      {/* Saved instances */}
      <section className="workspace-card p-5">
        <h3 className="text-base font-bold mb-1" style={{ fontFamily: "Manrope" }}>Gespeicherte Instanzen</h3>
        <p className="text-xs text-zinc-500 mb-4">Klick auf &ldquo;Verbinden&rdquo; um schnell zu wechseln. Auto-Login wenn E-Mail + Passwort gespeichert.</p>
        {savedInstances.length === 0 && (
          <p className="text-sm text-zinc-600 py-4 text-center">Noch keine Instanzen gespeichert.</p>
        )}
        <div className="space-y-2">
          {sortedInstances(savedInstances).map((inst) => {
            const isActive = inst.url === activeUrl || inst.url === activeUrl.replace(/\/+$/, "");
            return (
              <div
                key={inst.id}
                className="flex items-center gap-3 rounded-xl px-4 py-3"
                style={{
                  background: isActive ? "rgba(34,211,238,0.07)" : inst.isFavorite ? "rgba(251,191,36,0.04)" : "rgba(255,255,255,0.03)",
                  border: isActive ? "1px solid rgba(34,211,238,0.2)" : inst.isFavorite ? "1px solid rgba(251,191,36,0.15)" : "1px solid rgba(255,255,255,0.06)",
                }}
                data-testid={`instance-item-${inst.id}`}
              >
                <button
                  onClick={() => setSavedInstances(toggleInstanceFavorite(inst.id))}
                  className="shrink-0 transition-colors"
                  title={inst.isFavorite ? "Aus Favoriten entfernen" : "Als Favorit markieren"}
                  data-testid={`instance-star-btn-${inst.id}`}
                >
                  <Plus
                    size={14}
                    weight={inst.isFavorite ? "fill" : "regular"}
                    className={inst.isFavorite ? "text-yellow-400" : "text-zinc-600 hover:text-yellow-400"}
                    style={{ transform: "rotate(45deg)" }}
                  />
                </button>
                <DesktopTower size={15} className={isActive ? "text-cyan-400" : "text-zinc-500"} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-white truncate">{inst.name}</p>
                    {!isActive && inst.totalUnread > 0 && (
                      <span
                        className="shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold"
                        style={{
                          background: inst.mentionCount > 0 ? "#EF4444" : "#6366F1",
                          color: "#fff",
                        }}
                        data-testid={`instance-unread-badge-${inst.id}`}
                      >
                        {inst.totalUnread > 99 ? "99+" : inst.totalUnread}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 truncate">{inst.url}</p>
                  {inst.email && <p className="text-xs text-zinc-600 truncate">{inst.email}</p>}
                  {inst.lastUsedAt && (
                    <p className="text-xs text-zinc-700 truncate">
                      Zuletzt: {new Date(inst.lastUsedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </p>
                  )}
                </div>
                {isActive ? (
                  <span className="text-xs text-cyan-400 font-medium shrink-0 px-2">Aktiv</span>
                ) : (
                  <Button
                    size="sm"
                    disabled={switchingInstance === inst.id}
                    className="rounded-xl bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25 text-xs px-3 h-8 shrink-0"
                    onClick={() => handleConnect(inst)}
                    data-testid={`instance-connect-btn-${inst.id}`}
                  >
                    {switchingInstance === inst.id ? "Verbinde…" : "Verbinden"}
                  </Button>
                )}
                <button
                  className="rounded-lg p-1.5 text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                  onClick={() => setSavedInstances(removeInstance(inst.id))}
                  data-testid={`instance-remove-btn-${inst.id}`}
                >
                  <Trash size={14} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Add new instance */}
      <section className="workspace-card p-5">
        <h3 className="text-base font-bold mb-1" style={{ fontFamily: "Manrope" }}>Instanz hinzufügen</h3>
        <p className="text-xs text-zinc-500 mb-4">Trage eine neue Server-URL ein. E-Mail und Passwort sind optional (für Auto-Login).</p>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="workspace-section-label">Name</Label>
              <Input value={newInstanceName} onChange={(e) => setNewInstanceName(e.target.value)} placeholder="Mein Server" className={SETTINGS_INPUT_CLASSNAME} data-testid="new-instance-name-input" />
            </div>
            <div className="space-y-1.5">
              <Label className="workspace-section-label">Server-URL</Label>
              <Input value={newInstanceUrl} onChange={(e) => setNewInstanceUrl(e.target.value)} placeholder="https://singravox.example.com" className={SETTINGS_INPUT_CLASSNAME} data-testid="new-instance-url-input" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="workspace-section-label">E-Mail (Auto-Login, optional)</Label>
              <Input type="email" value={newInstanceEmail} onChange={(e) => setNewInstanceEmail(e.target.value)} placeholder="user@example.com" className={SETTINGS_INPUT_CLASSNAME} data-testid="new-instance-email-input" />
            </div>
            <div className="space-y-1.5">
              <Label className="workspace-section-label">Passwort (optional)</Label>
              <Input type="password" value={newInstancePassword} onChange={(e) => setNewInstancePassword(e.target.value)} placeholder="Lokal gespeichert" className={SETTINGS_INPUT_CLASSNAME} data-testid="new-instance-password-input" />
            </div>
          </div>
          <Button
            disabled={!newInstanceUrl.trim()}
            className="rounded-xl bg-cyan-400 px-5 text-zinc-950 hover:bg-cyan-300 text-sm"
            onClick={() => {
              if (!newInstanceUrl.trim()) return;
              setSavedInstances(saveInstance({
                name: newInstanceName.trim() || newInstanceUrl.trim(),
                url: newInstanceUrl.trim(),
                email: newInstanceEmail.trim(),
                password: newInstancePassword,
              }));
              setNewInstanceName("");
              setNewInstanceUrl("");
              setNewInstanceEmail("");
              setNewInstancePassword("");
              toast.success("Instanz gespeichert");
            }}
            data-testid="add-instance-btn"
          >
            <Plus size={14} className="mr-1.5" />
            Hinzufügen
          </Button>
        </div>
      </section>
    </div>
  );
}
