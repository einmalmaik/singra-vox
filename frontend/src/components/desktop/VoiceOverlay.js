/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * VoiceOverlay – In-Game Voice-Anzeige (Desktop Only).
 *
 * Zeigt aktive Sprecher mit Namen, Mute-Status und E2EE-Indikator.
 * Wird in einem separaten Tauri-Fenster (transparent, always-on-top)
 * gerendert. Empfängt Daten per Tauri IPC Events vom Hauptfenster.
 *
 * Das Overlay ist bewusst minimalistisch gehalten:
 *   - Keine Interaktionselemente (Click-Through für Spiele)
 *   - Kompaktes Design (300x200px max)
 *   - Reduzierte Animationen (Performance in Spielen)
 */
import { useState, useEffect } from "react";
import { isDesktopApp, listenTauri } from "@/lib/desktop";

/** Farbe für sprechende User (pulsierender Ring) */
const SPEAKING_COLOR = "#22D3EE";

export default function VoiceOverlay() {
  const [speakers, setSpeakers] = useState([]);
  const [e2eeActive, setE2eeActive] = useState(false);

  useEffect(() => {
    if (!isDesktopApp()) return undefined;

    let unlisten;
    (async () => {
      unlisten = await listenTauri("overlay-speakers-update", (event) => {
        const { speakers: s, e2ee_active } = event.payload;
        setSpeakers(s || []);
        setE2eeActive(Boolean(e2ee_active));
      });
    })();

    return () => { unlisten?.(); };
  }, []);

  if (!speakers.length) return null;

  return (
    <div className="fixed inset-0 pointer-events-none select-none"
         style={{ background: "transparent", fontFamily: "Manrope, sans-serif" }}>
      {/* E2EE Indikator */}
      {e2eeActive && (
        <div className="absolute top-2 right-2 flex items-center gap-1 bg-emerald-500/20 px-2 py-0.5 rounded-full">
          <svg width="10" height="10" viewBox="0 0 16 16" fill="#10B981">
            <path d="M12 6V4a4 4 0 00-8 0v2H3v8h10V6h-1zm-6-2a2 2 0 014 0v2H6V4z" />
          </svg>
          <span className="text-[9px] text-emerald-400 font-medium">E2EE</span>
        </div>
      )}

      {/* Sprecher-Liste */}
      <div className="absolute bottom-3 left-3 flex flex-col gap-1">
        {speakers.map((speaker) => (
          <div
            key={speaker.user_id}
            className="flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-lg px-2.5 py-1.5 transition-opacity"
            style={{ opacity: speaker.is_speaking ? 1 : 0.5 }}
            data-testid={`overlay-speaker-${speaker.user_id}`}
          >
            {/* Sprech-Indikator */}
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0"
              style={{
                backgroundColor: speaker.is_speaking ? `${SPEAKING_COLOR}20` : "transparent",
                border: `2px solid ${speaker.is_speaking ? SPEAKING_COLOR : "#52525B"}`,
                color: speaker.role_color || "#A1A1AA",
              }}
            >
              {speaker.display_name?.[0]?.toUpperCase() || "?"}
            </div>

            {/* Name + Status */}
            <span
              className="text-xs font-medium truncate max-w-[180px]"
              style={{ color: speaker.role_color || "#E4E4E7" }}
            >
              {speaker.display_name}
            </span>

            {/* Mute/Deafen Icons */}
            {speaker.is_muted && (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="#EF4444" className="shrink-0">
                <path d="M8 1a3 3 0 00-3 3v4a3 3 0 006 0V4a3 3 0 00-3-3z" />
                <path d="M2 2l12 12M1 7.5h2A5 5 0 008 12.5V15" stroke="#EF4444" strokeWidth="1.5" fill="none" />
              </svg>
            )}
            {speaker.is_deafened && (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="#EF4444" className="shrink-0">
                <path d="M2 2l12 12M1 8a7 7 0 0114 0v3a2 2 0 01-2 2h-1v-4h2V8A5 5 0 003.5 4.6" stroke="#EF4444" strokeWidth="1.5" fill="none" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
