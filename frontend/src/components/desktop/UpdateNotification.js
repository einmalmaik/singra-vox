/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowsClockwise, ArrowDown, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { isDesktopApp, listenTauri } from "@/lib/desktop";

const UP_TO_DATE_DISPLAY_MS = 3000;
const ERROR_DISPLAY_MS = 6000;

const PHASE_CONFIG = {
  checking: {
    icon: ArrowsClockwise,
    iconClass: "text-cyan-400 animate-spin",
    labelKey: "updater.checking",
    bg: "bg-zinc-900/95 border-cyan-500/20",
  },
  available: {
    icon: ArrowDown,
    iconClass: "text-cyan-400 animate-bounce",
    labelKey: "updater.available",
    bg: "bg-zinc-900/95 border-cyan-500/30",
  },
  downloading: {
    icon: ArrowsClockwise,
    iconClass: "text-cyan-400 animate-spin",
    labelKey: "updater.downloading",
    bg: "bg-zinc-900/95 border-cyan-500/30",
  },
  installing: {
    icon: ArrowsClockwise,
    iconClass: "text-cyan-400 animate-spin",
    labelKey: "updater.installing",
    bg: "bg-zinc-900/95 border-cyan-500/40",
  },
  "up-to-date": {
    icon: CheckCircle,
    iconClass: "text-emerald-400",
    labelKey: "updater.upToDate",
    bg: "bg-zinc-900/95 border-emerald-500/20",
  },
  error: {
    icon: WarningCircle,
    iconClass: "text-amber-400",
    labelKey: "updater.error",
    bg: "bg-zinc-900/95 border-amber-500/20",
  },
};

export function getUpdatePhaseLabel(phase, t) {
  const config = PHASE_CONFIG[phase];
  if (!config) return null;
  return t(config.labelKey);
}

export function formatUpdateVersion(update) {
  if (!update?.version) return null;
  const currentVersion = update.currentVersion || update.current_version;
  return currentVersion ? `${currentVersion} → ${update.version}` : update.version;
}

export function UpdateNotification() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState("idle");
  const [update, setUpdate] = useState(null);
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState(null);
  const downloadedRef = useRef(0);
  const fadeTimerRef = useRef(null);

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
      unlisteners.push(await listenTauri("update-checking", (event) => {
        setPhase("checking");
        setUpdate((prev) => prev || { currentVersion: event.payload?.currentVersion });
        setErrorMsg(null);
        downloadedRef.current = 0;
        setProgress(0);
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      }));

      unlisteners.push(await listenTauri("update-available", (event) => {
        if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
        setUpdate(event.payload);
        setPhase("available");
      }));

      unlisteners.push(await listenTauri("update-not-available", () => {
        setPhase("up-to-date");
        fadeToIdle(UP_TO_DATE_DISPLAY_MS);
      }));

      unlisteners.push(await listenTauri("update-download-progress", (event) => {
        const { chunkLength, contentLength } = event.payload;
        if (contentLength) {
          downloadedRef.current += chunkLength;
          setProgress(Math.min(99, Math.round((downloadedRef.current / contentLength) * 100)));
        }
        setPhase("downloading");
      }));

      unlisteners.push(await listenTauri("update-install-started", () => {
        setProgress(100);
        setPhase("installing");
      }));

      unlisteners.push(await listenTauri("update-error", (event) => {
        const message = event.payload?.error || t("updater.unknownError");
        console.warn("[Updater] Fehler:", message);
        setErrorMsg(message);
        setPhase("error");
        fadeToIdle(ERROR_DISPLAY_MS);
      }));
    })();

    return () => {
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      unlisteners.forEach((unlisten) => unlisten?.());
    };
  }, [fadeToIdle, t]);

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
        <PhaseIcon size={18} weight="bold" className={config.iconClass} />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">
            {phase === "error" ? errorMsg : getUpdatePhaseLabel(phase, t)}
          </p>

          {phase !== "checking" && phase !== "up-to-date" && phase !== "error" && formatUpdateVersion(update) && (
            <p className="truncate text-xs text-zinc-400">
              {formatUpdateVersion(update)}
            </p>
          )}

          {phase === "downloading" && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-700/60">
                <div
                  className="h-full rounded-full bg-cyan-400 transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="w-8 text-right text-xs tabular-nums text-zinc-400">{progress}%</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
