/*
 * Singra Vox – Overlay Settings Tab
 *
 * Konfiguriert das In-Game Voice Overlay (nur Desktop).
 * Standard: deaktiviert. Muss explizit aktiviert werden.
 *
 * Hotkey: Nutzt dieselbe Shortcut-Capture-Logik wie PTT
 * (pttShortcut.js) für konsistente Tastenkombinationen.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GameController, Eye, EyeSlash, Keyboard } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useRuntime } from "@/contexts/RuntimeContext";
import { capturePttShortcut, describePttShortcut } from "@/lib/pttShortcut";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

const OVERLAY_STORAGE_KEY = "singravox.overlay.settings";

const DEFAULT_SETTINGS = {
  enabled: false,
  position: "bottom-left",
  opacity: 0.85,
  gameOnly: true,
  toggleHotkey: "Ctrl+Shift+o",
  toggleHotkeyLabel: "Strg+Shift+O",
  showNames: true,
  showSpeakingIndicator: true,
};

const POSITIONS = [
  { id: "top-left",     label: "Oben links",  icon: "tl" },
  { id: "top-right",    label: "Oben rechts",  icon: "tr" },
  { id: "bottom-left",  label: "Unten links",  icon: "bl" },
  { id: "bottom-right", label: "Unten rechts", icon: "br" },
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
  const { t, i18n } = useTranslation();
  const { config } = useRuntime();
  const isDesktop = Boolean(config?.isDesktop);
  const [settings, setSettings] = useState(loadOverlaySettings);
  const [hotkeyListening, setHotkeyListening] = useState(false);

  const update = (patch) => {
    setSettings((prev) => {
      const next = saveOverlaySettings({ ...prev, ...patch });
      if (isDesktop && window.__TAURI__?.core?.invoke) {
        window.__TAURI__.core.invoke("update_overlay_settings", { settings: next }).catch(() => {});
      }
      return next;
    });
  };

  // Initiales Sync mit Rust
  useEffect(() => {
    if (isDesktop && window.__TAURI__?.core?.invoke) {
      window.__TAURI__.core.invoke("update_overlay_settings", { settings }).catch(() => {});
    }
  }, [isDesktop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hotkey-Capture: Dieselbe Logik wie PTT (capturePttShortcut)
  useEffect(() => {
    if (!hotkeyListening) return;
    const handler = (event) => {
      const captured = capturePttShortcut(event);
      if (!captured) return;
      event.preventDefault();
      event.stopPropagation();
      update({
        toggleHotkey: captured.accelerator,
        toggleHotkeyLabel: captured.label,
      });
      setHotkeyListening(false);
      toast.success(`Overlay-Hotkey: ${captured.label}`);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [hotkeyListening]); // eslint-disable-line react-hooks/exhaustive-deps

  const hotkeyDisplay = settings.toggleHotkeyLabel
    || describePttShortcut(settings.toggleHotkey, { locale: i18n.language });

  return (
    <div className="space-y-8" data-testid="overlay-settings-panel">
      {/* Hauptschalter */}
      <section className="workspace-card p-6">
        <div className="flex items-start gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${settings.enabled ? "bg-cyan-500/15" : "bg-zinc-800/60"}`}>
            <GameController size={22} className={settings.enabled ? "text-cyan-300" : "text-zinc-500"} />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white" style={{ fontFamily: "Manrope" }}>
                  In-Game Voice Overlay
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">
                  Zeigt ein transparentes Fenster über Spielen an, das die aktiven
                  Sprecher im Voice-Channel darstellt.
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
              <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 px-5 py-3.5 text-sm leading-relaxed text-amber-200">
                Das Voice Overlay ist nur in der Desktop-App verfügbar.
                Lade die Desktop-Version herunter um dieses Feature zu nutzen.
              </div>
            )}

            {isDesktop && !settings.enabled && (
              <div className="mt-4 rounded-2xl border border-white/8 bg-zinc-950/60 px-5 py-3.5 text-sm leading-relaxed text-zinc-500">
                Das Overlay ist deaktiviert. Aktiviere es um zu sehen wer in deinem
                Voice-Channel spricht, während du im Spiel bist.
              </div>
            )}
          </div>
        </div>
      </section>

      {settings.enabled && (
        <>
          {/* Position */}
          <section className="workspace-card p-6">
            <h4 className="text-base font-bold text-white mb-1" style={{ fontFamily: "Manrope" }}>Position</h4>
            <p className="text-sm text-zinc-500 mb-5">Wähle die Ecke des Bildschirms für das Overlay.</p>
            <div className="grid grid-cols-2 gap-3">
              {POSITIONS.map((pos) => (
                <button
                  key={pos.id}
                  onClick={() => update({ position: pos.id })}
                  className={`group relative rounded-2xl border-2 px-5 py-4 text-sm font-medium transition-all ${
                    settings.position === pos.id
                      ? "border-cyan-400/50 bg-cyan-500/10 text-white shadow-[0_0_20px_rgba(34,211,238,0.08)]"
                      : "border-white/8 bg-zinc-950/60 text-zinc-400 hover:border-white/15 hover:text-zinc-200"
                  }`}
                  data-testid={`overlay-pos-${pos.id}`}
                >
                  {/* Mini-Monitor Preview */}
                  <div className="mb-3 mx-auto h-12 w-20 rounded-md border border-white/10 bg-zinc-900/80 relative">
                    <div
                      className={`absolute h-2.5 w-5 rounded-sm transition-colors ${
                        settings.position === pos.id ? "bg-cyan-400/70" : "bg-zinc-700"
                      }`}
                      style={{
                        top: pos.id.startsWith("top") ? "3px" : undefined,
                        bottom: pos.id.startsWith("bottom") ? "3px" : undefined,
                        left: pos.id.endsWith("left") ? "3px" : undefined,
                        right: pos.id.endsWith("right") ? "3px" : undefined,
                      }}
                    />
                  </div>
                  {pos.label}
                </button>
              ))}
            </div>
          </section>

          {/* Hotkey – Dieselbe Capture-Logik wie PTT */}
          <section className="workspace-card p-6">
            <h4 className="text-base font-bold text-white mb-1" style={{ fontFamily: "Manrope" }}>Hotkey</h4>
            <p className="text-sm text-zinc-500 mb-5">
              Tastenkombination zum Ein-/Ausschalten des Overlays während des Spielens.
            </p>
            <div className="rounded-2xl border border-white/10 bg-zinc-950/60 p-5">
              <div className="flex items-center justify-between gap-4 mb-4">
                <div>
                  <p className="text-sm font-medium text-white">Toggle-Hotkey</p>
                  <p className="mt-1 text-xs text-zinc-500">
                    Drücke den Button und dann deine gewünschte Tastenkombination.
                  </p>
                </div>
                <div className="rounded-xl border border-white/12 bg-zinc-900/80 px-4 py-2 text-sm font-mono text-cyan-300 tracking-wide">
                  {hotkeyDisplay || "Nicht gesetzt"}
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => setHotkeyListening(true)}
                className="w-full rounded-2xl border-white/10 bg-zinc-950/60 text-white hover:bg-white/8 h-12"
                data-testid="overlay-hotkey-capture-btn"
              >
                <Keyboard size={16} className="mr-2.5" />
                {hotkeyListening
                  ? "Drücke jetzt eine Taste..."
                  : `Hotkey ändern (aktuell: ${hotkeyDisplay || "Ctrl+Shift+O"})`}
              </Button>
              {hotkeyListening && (
                <p className="mt-3 text-center text-xs text-cyan-400 animate-pulse">
                  Warte auf Tastenkombination...
                </p>
              )}
            </div>
          </section>

          {/* Darstellung */}
          <section className="workspace-card p-6 space-y-5">
            <div>
              <h4 className="text-base font-bold text-white" style={{ fontFamily: "Manrope" }}>Darstellung</h4>
              <p className="mt-1 text-sm text-zinc-500">Wie das Overlay aussehen soll.</p>
            </div>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-zinc-950/60 p-5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
                  Deckkraft
                </Label>
                <span className="text-sm font-mono text-zinc-300">{Math.round(settings.opacity * 100)}%</span>
              </div>
              <Slider
                value={[Math.round(settings.opacity * 100)]}
                min={20} max={100} step={5}
                onValueChange={([v]) => update({ opacity: v / 100 })}
              />
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-zinc-950/60 px-5 py-4">
              <div className="flex items-center gap-3">
                {settings.showNames ? <Eye size={18} className="text-zinc-400" /> : <EyeSlash size={18} className="text-zinc-400" />}
                <div>
                  <p className="text-sm font-medium text-white">Nutzernamen anzeigen</p>
                  <p className="mt-0.5 text-xs text-zinc-500">Deaktivieren für mehr Privatsphäre im Stream</p>
                </div>
              </div>
              <Switch
                checked={settings.showNames}
                onCheckedChange={(checked) => update({ showNames: checked })}
                data-testid="overlay-show-names-toggle"
              />
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-zinc-950/60 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-white">Sprechindikator</p>
                <p className="mt-0.5 text-xs text-zinc-500">Pulsierende Animation wenn jemand spricht</p>
              </div>
              <Switch
                checked={settings.showSpeakingIndicator}
                onCheckedChange={(checked) => update({ showSpeakingIndicator: checked })}
              />
            </div>
          </section>

          {/* Verhalten */}
          <section className="workspace-card p-6 space-y-5">
            <div>
              <h4 className="text-base font-bold text-white" style={{ fontFamily: "Manrope" }}>Verhalten</h4>
              <p className="mt-1 text-sm text-zinc-500">Wann das Overlay erscheinen soll.</p>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-zinc-950/60 px-5 py-4" data-testid="overlay-game-only-toggle">
              <div>
                <p className="text-sm font-medium text-white">Nur bei erkanntem Spiel</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Overlay wird nur angezeigt wenn ein Vollbild-Spiel erkannt wird.
                  Ansonsten ist es immer sichtbar wenn du in einem Voice-Channel bist.
                </p>
              </div>
              <Switch
                checked={settings.gameOnly}
                onCheckedChange={(checked) => update({ gameOnly: checked })}
              />
            </div>
          </section>

          {/* Datenschutz */}
          <section className="workspace-card border-emerald-500/15 bg-emerald-500/[0.03] p-6">
            <div className="flex items-start gap-4">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15">
                <Eye size={16} className="text-emerald-400" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Datenschutz</h4>
                <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
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
