/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import {
  ArrowDown,
  ArrowsClockwise,
  CheckCircle,
  WarningCircle,
} from "@phosphor-icons/react";

const UPDATE_EVENT_HANDLER_MAP = [
  ["update-checking", "onChecking"],
  ["update-available", "onAvailable"],
  ["update-not-available", "onNotAvailable"],
  ["update-download-progress", "onDownloadProgress"],
  ["update-install-started", "onInstallStarted"],
  ["update-error", "onError"],
];

export const UPDATE_EVENT_NAMES = UPDATE_EVENT_HANDLER_MAP.map(([eventName]) => eventName);

export const PHASE_CONFIG = {
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
  if (!config) {
    return null;
  }
  return t(config.labelKey);
}

export function formatUpdateVersion(update, t) {
  if (!update?.version) {
    return null;
  }

  return t("updater.versionTransition", {
    current: update.currentVersion || update.current_version || "0.0.0",
    next: update.version,
  });
}

export function registerUpdateListeners({ listen, handlers, isDisposed = () => false }) {
  const unlisteners = [];

  for (const [eventName, handlerName] of UPDATE_EVENT_HANDLER_MAP) {
    const handler = handlers[handlerName];
    void listen(eventName, handler)
      .then((unlisten) => {
        if (isDisposed()) {
          unlisten?.();
          return;
        }
        unlisteners.push(unlisten);
      })
      .catch((error) => {
        console.warn(`[Updater] Failed to register ${eventName} listener:`, error);
      });
  }

  return () => {
    unlisteners.forEach((unlisten) => unlisten?.());
  };
}
