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
 * UpdateNotification – vollständige Update-Anzeige für die Desktop-App.
 *
 * Phasen:
 *  idle        → nichts anzeigen
 *  checking    → "Prüfe auf Updates…" (Spinner, 3 Sek. sichtbar, dann idle)
 *  available   → "Update X.X.X verfügbar" + Button
 *  downloading → Fortschrittsbalken
 *  installing  → "Installiere…"
 *  done        → Auto-Neustart
 */
import { useState, useEffect, useRef } from "react";
import { isDesktopApp, invokeTauri, listenTauri } from "@/lib/desktop";
import { ArrowsClockwise, X, CheckCircle } from "@phosphor-icons/react";

export function UpdateNotification() {
  const [phase, setPhase] = useState("idle"); // idle | checking | available | downloading | installing
  const [update, setUpdate] = useState(null);
  const [progress, setProgress] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const checkingTimer = useRef(null);
  const downloadedRef = useRef(0);

  useEffect(() => {
    if (!isDesktopApp()) return;

    let unlistenChecking, unlistenAvailable, unlistenNotAvailable,
        unlistenProgress, unlistenInstall, unlistenError;

    (async () => {
      // "Prüfe gerade…" – kurz anzeigen, dann wieder idle
      unlistenChecking = await listenTauri("update-checking", () => {
        setPhase("checking");
        setDismissed(false);
        if (checkingTimer.current) clearTimeout(checkingTimer.current);
        checkingTimer.current = setTimeout(() => {
          setPhase((prev) => prev === "checking" ? "idle" : prev);
        }, 3500);
      });

      // Update gefunden
      unlistenAvailable = await listenTauri("update-available", (event) => {
        if (checkingTimer.current) clearTimeout(checkingTimer.current);
        setUpdate(event.payload);
        setPhase("available");
        setDismissed(false);
      });

      // Kein Update
      unlistenNotAvailable = await listenTauri("update-not-available", () => {
        if (checkingTimer.current) clearTimeout(checkingTimer.current);
        setPhase((prev) => prev === "checking" ? "idle" : prev);
      });

      unlistenProgress = await listenTauri("update-download-progress", (event) => {
        const { chunkLength, contentLength } = event.payload;
        if (contentLength) {
          downloadedRef.current += chunkLength;
          setProgress(Math.min(99, Math.round((downloadedRef.current / contentLength) * 100)));
        }
      });

      unlistenInstall = await listenTauri("update-install-started", () => {
        setPhase("installing");
      });

      // Update-Fehler (z.B. Netzwerkfehler, ungültige Signatur)
      unlistenError = await listenTauri("update-error", (event) => {
        if (checkingTimer.current) clearTimeout(checkingTimer.current);
        console.warn("[Updater] Fehler:", event.payload?.error);
        setPhase("idle");
      });
    })();

    return () => {
      if (checkingTimer.current) clearTimeout(checkingTimer.current);
      unlistenChecking?.();
      unlistenAvailable?.();
      unlistenNotAvailable?.();
      unlistenProgress?.();
      unlistenInstall?.();
      unlistenError?.();
    };
  }, []);

  const handleUpdate = async () => {
    setPhase("downloading");
    setProgress(0);
    try {
      await invokeTauri("install_update_command");
    } catch (err) {
      console.error("Update fehlgeschlagen:", err);
      setPhase("available");
    }
  };

  if (!isDesktopApp()) return null;

  // ── Checking-Banner (schmales Top-Banner) ──────────────────────────────────
  if (phase === "checking") {
    return (
      <div
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 py-1.5 text-xs text-zinc-400"
        style={{ background: "rgba(24,24,27,0.92)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        data-testid="update-checking-banner"
      >
        <div className="w-3 h-3 border border-zinc-500 border-t-transparent rounded-full animate-spin" />
        <span>Prüfe auf Updates…</span>
      </div>
    );
  }

  // Nichts anzeigen wenn dismissed oder kein Update
  if (dismissed || phase === "idle" || !update) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 w-80 rounded-2xl border border-cyan-500/30 bg-zinc-900/95 shadow-2xl backdrop-blur-xl"
      data-testid="update-notification"
    >
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-cyan-500/15">
          <ArrowsClockwise
            size={16}
            className={`text-cyan-400 ${phase === "downloading" ? "animate-spin" : ""}`}
          />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">
            {phase === "installing" ? "Update wird installiert…" : "Update verfügbar"}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">
            Version {update.version} — du nutzt {update.currentVersion || update.current_version}
          </p>

          {update.body && phase === "available" && (
            <p className="mt-1.5 text-xs text-zinc-500 line-clamp-2">{update.body}</p>
          )}

          {phase === "available" && (
            <button
              onClick={handleUpdate}
              className="mt-3 w-full rounded-lg bg-cyan-500/20 px-3 py-1.5 text-xs font-medium text-cyan-300 transition-colors hover:bg-cyan-500/30"
              data-testid="update-install-btn"
            >
              Jetzt aktualisieren
            </button>
          )}

          {phase === "downloading" && (
            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Herunterladen…</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-700">
                <div
                  className="h-1.5 rounded-full bg-cyan-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {phase === "installing" && (
            <p className="mt-3 text-xs text-cyan-400 animate-pulse">
              Installiere… App startet gleich automatisch neu.
            </p>
          )}
        </div>

        {phase === "available" && (
          <button
            onClick={() => setDismissed(true)}
            className="ml-1 rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300"
            data-testid="update-dismiss-btn"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
