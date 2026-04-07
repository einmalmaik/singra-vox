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
 * useRichPresence – Polling-Hook für Desktop-Aktivitätserkennung.
 *
 * Ruft alle POLL_INTERVAL_MS den Tauri IPC Command `detect_current_activity`
 * auf und sendet erkannte Aktivitäten an das Backend. Nur aktiv wenn:
 *   1. Die App im Desktop-Modus läuft (isDesktopApp)
 *   2. Rich Presence in den Settings aktiviert ist
 *
 * Das Polling ist absichtlich client-seitig (nicht Push), weil:
 *   - Der Tauri-Client die Prozessliste nur lokal liest (Privacy)
 *   - Die Aktualisierungsrate vom User kontrollierbar ist
 *   - Kein Daemon oder Background-Service nötig ist
 */
import { useEffect, useRef, useCallback } from "react";
import { isDesktopApp } from "@/lib/desktop";
import api from "@/lib/api";

/** Polling-Intervall in ms (15 Sekunden – Balance zwischen Aktualität und Last) */
const POLL_INTERVAL_MS = 15_000;

export function useRichPresence({ enabled = true }) {
  const lastActivityRef = useRef(null);
  const intervalRef = useRef(null);

  const poll = useCallback(async () => {
    if (!isDesktopApp() || !enabled) return;

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const activity = await invoke("detect_current_activity");

      // Nur senden wenn sich die Aktivität geändert hat (Dedupe)
      const activityKey = activity ? `${activity.activity_type}:${activity.name}` : null;
      if (activityKey === lastActivityRef.current) return;
      lastActivityRef.current = activityKey;

      if (activity) {
        await api.put("/presence/activity", {
          type: activity.activity_type,
          name: activity.name,
          details: activity.details || null,
          state: null,
        });
      } else if (lastActivityRef.current !== null) {
        await api.delete("/presence/activity");
      }
    } catch {
      // Leise fehlschlagen – Presence ist nicht kritisch
    }
  }, [enabled]);

  useEffect(() => {
    if (!isDesktopApp() || !enabled) {
      // Aufräumen wenn deaktiviert
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return undefined;
    }

    // Sofort einmal pollen, dann im Intervall
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      // Aktivität beim Unmount löschen
      api.delete("/presence/activity").catch(() => {});
    };
  }, [enabled, poll]);
}
