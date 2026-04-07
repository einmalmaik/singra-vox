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
 * UpdateNotification – Auto-Update-Anzeige fuer die Desktop-App.
 *
 * Zeigt bei jedem App-Start eine deutliche Status-Anzeige:
 *
 *   checking     → "Pruefe auf Updates…"         (prominentes Banner)
 *   available    → "Update vX.Y.Z gefunden"       (wird automatisch heruntergeladen)
 *   downloading  → Fortschrittsbalken              (automatisch)
 *   installing   → "Wird installiert…"             (automatisch)
 *   up-to-date   → "App ist aktuell"               (blendet nach 3s aus)
 *   error        → Fehlermeldung                    (blendet nach 5s aus)
 *
 * Die gesamte Update-Logik (Download + Install + Restart) laeuft automatisch
 * im Rust-Backend. Das Frontend ist rein deklarativ und zeigt nur den State.
 *
 * Wiederverwendbarkeit: Die Komponente ist selbststaendig (kein Prop noetig),
 * registriert Tauri-Events im Mount-Lifecycle und raumt im Cleanup auf.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { isDesktopApp, listenTauri } from "@/lib/desktop";
import { ArrowsClockwise, CheckCircle, WarningCircle, ArrowDown } from "@phosphor-icons/react";

/** Wie lange "App ist aktuell" sichtbar bleibt (ms) */
const UP_TO_DATE_DISPLAY_MS = 3000;

/** Wie lange eine Fehlermeldung sichtbar bleibt (ms) */
const ERROR_DISPLAY_MS = 6000;

// ── Phase-Konfiguration ──────────────────────────────────────────────────────
// Jede Phase hat ein Icon, Label und optionale Farbe. Das macht die Komponente
// leicht erweiterbar ohne die Render-Logik anzufassen.
const PHASE_CONFIG = {
  checking: {
    icon: ArrowsClockwise,
    iconClass: "text-cyan-400 animate-spin",
    label: "Pruefe auf Updates…",
    bg: "bg-zinc-900/95 border-cyan-500/20",
  },
  available: {
    icon: ArrowDown,
    iconClass: "text-cyan-400 animate-bounce",
    label: "Update gefunden – wird heruntergeladen…",
    bg: "bg-zinc-900/95 border-cyan-500/30",
  },
  downloading: {
    icon: ArrowsClockwise,
    iconClass: "text-cyan-400 animate-spin",
    label: "Wird heruntergeladen…",
    bg: "bg-zinc-900/95 border-cyan-500/30",
  },
  installing: {
    icon: ArrowsClockwise,
    iconClass: "text-cyan-400 animate-spin",
    label: "Wird installiert… App startet gleich neu.",
    bg: "bg-zinc-900/95 border-cyan-500/40",
  },
  "up-to-date": {
    icon: CheckCircle,
    iconClass: "text-emerald-400",
    label: "App ist aktuell",
    bg: "bg-zinc-900/95 border-emerald-500/20",
  },
  error: {
    icon: WarningCircle,
    iconClass: "text-amber-400",
    label: "Update-Fehler",
    bg: "bg-zinc-900/95 border-amber-500/20",
  },
};

export function UpdateNotification() {
  const [phase, setPhase] = useState("idle");
  const [update, setUpdate] = useState(null);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState(null);
  const downloadedRef = useRef(0);
  const fadeTimerRef = useRef(null);

  // Hilfsfunktion: Phase nach Delay auf idle setzen
  const fadeToIdle = useCallback((delayMs) => {
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    fadeTimerRef.current = setTimeout(() => {
      setPhase("idle");
    }, delayMs);
  }, []);

  useEffect(() => {
    if (!isDesktopApp()) return undefined;

    const unlisteners = [];

    (async () => {
      // ── Checking ───────────────────────────────────────────────────────
      unlisteners.push(await listenTauri("update-checking", (event) => {
        setPhase("checking");
        setUpdate((prev) => prev || { currentVersion: event.payload?.currentVersion });
        setErrorMsg(null);
        downloadedRef.current = 0;
        setProgress(0);
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      }));

      // ── Update gefunden ────────────────────────────────────────────────
      unlisteners.push(await listenTauri("update-available", (event) => {
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        setUpdate(event.payload);
        setPhase("available");
      }));

      // ── Kein Update ────────────────────────────────────────────────────
      unlisteners.push(await listenTauri("update-not-available", () => {
        setPhase("up-to-date");
        fadeToIdle(UP_TO_DATE_DISPLAY_MS);
      }));

      // ── Download-Fortschritt ───────────────────────────────────────────
      unlisteners.push(await listenTauri("update-download-progress", (event) => {
        const { chunkLength, contentLength } = event.payload;
        if (contentLength) {
          downloadedRef.current += chunkLength;
          setProgress(Math.min(99, Math.round((downloadedRef.current / contentLength) * 100)));
        }
        setPhase("downloading");
      }));

      // ── Installation gestartet ─────────────────────────────────────────
      unlisteners.push(await listenTauri("update-install-started", () => {
        setProgress(100);
        setPhase("installing");
      }));

      // ── Fehler ─────────────────────────────────────────────────────────
      unlisteners.push(await listenTauri("update-error", (event) => {
        const msg = event.payload?.error || "Unbekannter Fehler";
        console.warn("[Updater] Fehler:", msg);
        setErrorMsg(msg);
        setPhase("error");
        fadeToIdle(ERROR_DISPLAY_MS);
      }));
    })();

    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      unlisteners.forEach((unlisten) => unlisten?.());
    };
  }, [fadeToIdle]);

  // ── Nichts anzeigen wenn idle oder kein Desktop ────────────────────────────
  if (!isDesktopApp() || phase === "idle") return null;

  const config = PHASE_CONFIG[phase];
  if (!config) return null;

  const PhaseIcon = config.icon;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[100] border-b backdrop-blur-xl transition-all duration-300 ${config.bg}`}
      data-testid="update-notification"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-2.5">
        {/* Phase-Icon */}
        <PhaseIcon size={18} weight="bold" className={config.iconClass} />

        {/* Haupttext */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">
            {phase === "error" ? errorMsg : config.label}
          </p>

          {/* Version-Info (bei available/downloading/installing) */}
          {update?.version && phase !== "checking" && phase !== "up-to-date" && phase !== "error" && (
            <p className="text-xs text-zinc-400 truncate">
              {update.currentVersion || update.current_version} → {update.version}
            </p>
          )}

          {/* Fortschrittsbalken (bei downloading) */}
          {phase === "downloading" && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-zinc-700/60 overflow-hidden">
                <div
                  className="h-full rounded-full bg-cyan-400 transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-zinc-400 tabular-nums w-8 text-right">{progress}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
