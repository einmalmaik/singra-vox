/*
 * Singra Vox – Overlay Settings Tab
 *
 * Konfiguriert das In-Game Voice Overlay (nur Desktop).
 * Standard: deaktiviert. Muss explizit aktiviert werden.
 *
 * Einstellungen:
 *   - Aktiviert/Deaktiviert
 *   - Position (Ecke des Bildschirms)
 *   - Nur bei erkanntem Spiel anzeigen (gameOnly)
 *   - Opacity (Deckkraft)
 *   - Nutzernamen anzeigen (Privacy)
 *   - Sprechindikator
 *   - Hotkey zum Umschalten
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GameController, Eye, EyeSlash } from "@phosphor-icons/react";
import { useRuntime } from "@/contexts/RuntimeContext";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

const OVERLAY_STORAGE_KEY = "singravox.overlay.settings";

const DEFAULT_SETTINGS = {
  enabled: false,
  position: "bottom-left",
  opacity: 0.85,
  gameOnly: true,
  toggleHotkey: "Ctrl+Shift+O",
  showNames: true,
  showSpeakingIndicator: true,
};

const POSITIONS = [
  { id: "top-left",     label: "Oben links" },
  { id: "top-right",    label: "Oben rechts" },
  { id: "bottom-left",  label: "Unten links" },
  { id: "bottom-right", label: "Unten rechts" },
];

function loadOverlaySettings() {
  try {
    const raw = localStorage.getItem(OVERLAY_STORAGE_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveOverlaySettings(settings) {
  localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify(settings));
  return settings;
}

export default function OverlaySettingsTab() {
  const { config } = useRuntime();
  const isDesktop = Boolean(config?.isDesktop);
  const [settings, setSettings] = useState(loadOverlaySettings);

  const update = (patch) => {
    setSettings((prev) => {
      const next = saveOverlaySettings({ ...prev, ...patch });
      // Tauri IPC: Overlay-Einstellungen an Rust senden
      if (isDesktop && window.__TAURI__?.core?.invoke) {
        window.__TAURI__.core.invoke("update_overlay_settings", { settings: next }).catch(() => {});
      }
      return next;
    });
  };

  // Initiales Sync mit Rust bei Desktop-Startup
  useEffect(() => {
    if (isDesktop && window.__TAURI__?.core?.invoke) {
      window.__TAURI__.core.invoke("update_overlay_settings", { settings }).catch(() => {});
    }
  }, [isDesktop]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6" data-testid="overlay-settings-panel">
      {/* Status-Banner */}
      <section className="workspace-card p-5">
        <div className="flex items-start gap-3">
          <GameController size={20} className={settings.enabled ? "text-cyan-300" : "text-zinc-500"} />
          <div className="flex-1">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>
                  In-Game Voice Overlay
                </h3>
                <p className="mt-1 text-sm text-zinc-400">
                  Zeigt über Spielen an wer gerade spricht. Nur Desktop.
                </p>
              </div>
              <Switch
                checked={settings.enabled}
                onCheckedChange={(checked) => update({ enabled: checked })}
                disabled={!isDesktop}
                data-testid="overlay-enabled-toggle"
              />
            </div>

            {!isDesktop && (
              <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-300">
                Das Voice Overlay ist nur in der Desktop-App verfügbar.
                Lade die Desktop-Version herunter um dieses Feature zu nutzen.
              </div>
            )}

            {isDesktop && !settings.enabled && (
              <div className="mt-3 rounded-xl border border-white/8 bg-zinc-950/60 px-4 py-2.5 text-xs text-zinc-500">
                Das Overlay ist deaktiviert. Aktiviere es um zu sehen wer in deinem
                Voice-Channel spricht während du im Spiel bist.
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Einstellungen (nur wenn aktiviert) */}
      {settings.enabled && (
        <>
          {/* Position */}
          <section className="workspace-card p-5">
            <h4 className="text-sm font-bold text-white mb-3">Position</h4>
            <div className="grid grid-cols-2 gap-2">
              {POSITIONS.map((pos) => (
                <button
                  key={pos.id}
                  onClick={() => update({ position: pos.id })}
                  className={`rounded-xl border px-4 py-3 text-sm transition-all ${
                    settings.position === pos.id
                      ? "border-cyan-400/40 bg-cyan-500/10 text-white"
                      : "border-white/8 bg-zinc-950/60 text-zinc-400 hover:border-white/15 hover:text-zinc-300"
                  }`}
                  data-testid={`overlay-pos-${pos.id}`}
                >
                  {pos.label}
                </button>
              ))}
            </div>
          </section>

          {/* Darstellung */}
          <section className="workspace-card p-5 space-y-4">
            <h4 className="text-sm font-bold text-white">Darstellung</h4>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
                  Deckkraft
                </Label>
                <span className="text-xs text-zinc-400">{Math.round(settings.opacity * 100)}%</span>
              </div>
              <Slider
                value={[Math.round(settings.opacity * 100)]}
                min={20} max={100} step={5}
                onValueChange={([v]) => update({ opacity: v / 100 })}
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-white/8 bg-zinc-950/60 px-4 py-3">
              <div className="flex items-center gap-2">
                {settings.showNames ? <Eye size={16} className="text-zinc-400" /> : <EyeSlash size={16} className="text-zinc-400" />}
                <div>
                  <p className="text-sm text-white">Nutzernamen anzeigen</p>
                  <p className="text-xs text-zinc-500">Deaktivieren für mehr Privatsphäre</p>
                </div>
              </div>
              <Switch
                checked={settings.showNames}
                onCheckedChange={(checked) => update({ showNames: checked })}
                data-testid="overlay-show-names-toggle"
              />
            </div>

            <div className="flex items-center justify-between rounded-xl border border-white/8 bg-zinc-950/60 px-4 py-3">
              <div>
                <p className="text-sm text-white">Sprechindikator</p>
                <p className="text-xs text-zinc-500">Pulsierende Animation wenn jemand spricht</p>
              </div>
              <Switch
                checked={settings.showSpeakingIndicator}
                onCheckedChange={(checked) => update({ showSpeakingIndicator: checked })}
              />
            </div>
          </section>

          {/* Verhalten */}
          <section className="workspace-card p-5 space-y-4">
            <h4 className="text-sm font-bold text-white">Verhalten</h4>

            <div className="flex items-center justify-between rounded-xl border border-white/8 bg-zinc-950/60 px-4 py-3" data-testid="overlay-game-only-toggle">
              <div>
                <p className="text-sm text-white">Nur bei erkanntem Spiel</p>
                <p className="text-xs text-zinc-500">
                  Overlay wird nur angezeigt wenn ein Vollbild-Spiel erkannt wird
                </p>
              </div>
              <Switch
                checked={settings.gameOnly}
                onCheckedChange={(checked) => update({ gameOnly: checked })}
              />
            </div>

            <div className="rounded-xl border border-white/8 bg-zinc-950/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white">Toggle-Hotkey</p>
                  <p className="text-xs text-zinc-500">Ein/Aus während des Spielens</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs font-mono text-zinc-300">
                  {settings.toggleHotkey}
                </div>
              </div>
            </div>
          </section>

          {/* Datenschutz-Hinweis */}
          <section className="workspace-card border-emerald-500/15 bg-emerald-500/[0.03] p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                <Eye size={14} className="text-emerald-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white">Datenschutz</h4>
                <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                  Das Overlay zeigt nur lokale Voice-Daten an. Es werden keine
                  Bildschirminhalte erfasst oder übertragen. Die Spiel-Erkennung
                  prüft lediglich ob ein Vollbild-Fenster aktiv ist (Fenster-Titel
                  wird nicht gespeichert oder übermittelt).
                </p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
