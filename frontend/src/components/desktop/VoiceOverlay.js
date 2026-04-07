/*
 * Singra Vox – Voice Overlay (Desktop)
 *
 * Transparentes, always-on-top Overlay-Fenster das über Spielen
 * angezeigt wird. Zeigt aktive Sprecher im Voice-Channel.
 *
 * Architektur:
 *   - Rendert auf einer separaten Tauri WebviewWindow Route (/overlay)
 *   - Empfängt Sprech-Updates über Tauri IPC Events
 *   - Pollt Vollbild-Erkennung alle 2 Sekunden
 *   - Overlay-Einstellungen aus localStorage
 *
 * Performance:
 *   - Minimaler DOM (max 10 Sprecher-Elemente)
 *   - CSS-only Animationen (kein JS-Rendering-Loop)
 *   - Kein React-Context (eigenständige Route)
 *   - requestAnimationFrame für Level-Meter
 */
import { useEffect, useRef, useState } from "react";
import { Microphone, MicrophoneSlash, ShieldCheck, SpeakerSlash } from "@phosphor-icons/react";

const OVERLAY_STORAGE_KEY = "singravox.overlay.settings";

// Standard-Einstellungen (muss mit OverlaySettingsTab übereinstimmen)
const DEFAULT_SETTINGS = {
  enabled: true, // Im Overlay-Fenster immer "aktiv" (das Fenster existiert ja)
  position: "bottom-left",
  opacity: 0.85,
  gameOnly: true,
  showNames: true,
  showSpeakingIndicator: true,
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(OVERLAY_STORAGE_KEY) || "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// Position-Klassen für Tailwind
const POSITION_CLASSES = {
  "top-left":     "top-4 left-4",
  "top-right":    "top-4 right-4",
  "bottom-left":  "bottom-4 left-4",
  "bottom-right": "bottom-4 right-4",
};

export default function VoiceOverlay() {
  const [speakers, setSpeakers] = useState([]);
  const [e2eeActive, setE2eeActive] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [isFullscreenGame, setIsFullscreenGame] = useState(false);
  const animationRef = useRef(null);

  // Tauri IPC Events lauschen
  useEffect(() => {
    let unlisten1 = null;
    let unlisten2 = null;

    const setup = async () => {
      if (!window.__TAURI__?.event?.listen) return;

      // Sprech-Updates vom Hauptfenster
      unlisten1 = await window.__TAURI__.event.listen(
        "overlay-speakers-update",
        (event) => {
          const data = event.payload;
          if (data?.speakers) setSpeakers(data.speakers);
          if (typeof data?.e2ee_active === "boolean") setE2eeActive(data.e2ee_active);
        },
      );

      // Einstellungs-Updates
      unlisten2 = await window.__TAURI__.event.listen(
        "overlay-settings-update",
        (event) => {
          if (event.payload) setSettings(event.payload);
        },
      );
    };

    void setup();
    return () => {
      if (typeof unlisten1 === "function") unlisten1();
      if (typeof unlisten2 === "function") unlisten2();
    };
  }, []);

  // Fullscreen Game Detection Polling (alle 2 Sekunden)
  useEffect(() => {
    if (!settings.gameOnly) {
      setIsFullscreenGame(true); // Kein Game-Only = immer anzeigen
      return;
    }

    const poll = async () => {
      if (!window.__TAURI__?.core?.invoke) {
        setIsFullscreenGame(false);
        return;
      }
      try {
        const result = await window.__TAURI__.core.invoke("is_fullscreen_game_active");
        setIsFullscreenGame(result?.is_fullscreen || false);
      } catch {
        setIsFullscreenGame(false);
      }
    };

    void poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [settings.gameOnly]);

  // Nicht anzeigen wenn kein Spiel erkannt und gameOnly aktiv
  if (settings.gameOnly && !isFullscreenGame) {
    return null;
  }

  // Nur aktive Sprecher (max 10 für Performance)
  const activeSpeakers = speakers.slice(0, 10);

  return (
    <div
      className={`fixed ${POSITION_CLASSES[settings.position] || POSITION_CLASSES["bottom-left"]} z-[9999] select-none pointer-events-none`}
      style={{
        opacity: settings.opacity,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
      data-testid="voice-overlay"
    >
      <div className="space-y-1 w-[260px]">
        {/* E2EE Status Badge */}
        {e2eeActive && (
          <div className="flex items-center gap-1.5 rounded-lg bg-black/60 backdrop-blur-sm px-2.5 py-1 w-fit mb-1">
            <ShieldCheck size={10} weight="fill" className="text-emerald-400" />
            <span className="text-[9px] font-medium text-emerald-300 uppercase tracking-wider">E2EE</span>
          </div>
        )}

        {/* Sprecher-Liste */}
        {activeSpeakers.map((speaker) => (
          <div
            key={speaker.user_id}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-all duration-200 ${
              speaker.is_speaking
                ? "bg-black/70 backdrop-blur-sm ring-1 ring-emerald-500/50"
                : "bg-black/40 backdrop-blur-sm"
            }`}
            data-testid={`overlay-speaker-${speaker.user_id}`}
          >
            {/* Avatar */}
            <div
              className={`relative h-7 w-7 shrink-0 overflow-hidden rounded-full ${
                speaker.is_speaking ? "ring-2 ring-emerald-500" : ""
              }`}
              style={{
                animation: speaker.is_speaking && settings.showSpeakingIndicator
                  ? "overlay-pulse 1.5s ease-in-out infinite"
                  : "none",
              }}
            >
              {speaker.avatar_url ? (
                <img src={speaker.avatar_url} alt="" className="h-full w-full object-cover" />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center text-[10px] font-bold text-white"
                  style={{ backgroundColor: speaker.role_color || "#3f3f46" }}
                >
                  {speaker.display_name?.[0]?.toUpperCase() || "?"}
                </div>
              )}
            </div>

            {/* Name + Status */}
            {settings.showNames && (
              <span
                className={`truncate text-xs font-medium ${
                  speaker.is_speaking ? "text-white" : "text-zinc-400"
                }`}
                style={{ color: speaker.is_speaking ? (speaker.role_color || "#fff") : undefined }}
              >
                {speaker.display_name}
              </span>
            )}

            {/* Mute/Deafen Icons */}
            <div className="ml-auto flex shrink-0 gap-1">
              {speaker.is_muted && (
                <MicrophoneSlash size={12} className="text-red-400" />
              )}
              {speaker.is_deafened && (
                <SpeakerSlash size={12} className="text-red-400" />
              )}
              {!speaker.is_muted && !speaker.is_deafened && speaker.is_speaking && (
                <Microphone size={12} className="text-emerald-400" />
              )}
            </div>
          </div>
        ))}

        {/* Leerer State */}
        {activeSpeakers.length === 0 && (
          <div className="rounded-lg bg-black/40 backdrop-blur-sm px-2.5 py-1.5">
            <span className="text-[10px] text-zinc-500">Kein Voice-Channel aktiv</span>
          </div>
        )}
      </div>

      {/* CSS Animation für Sprechindikator */}
      <style>{`
        @keyframes overlay-pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); }
          50% { box-shadow: 0 0 0 4px rgba(16, 185, 129, 0); }
        }
      `}</style>
    </div>
  );
}
