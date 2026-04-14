/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useTranslation } from "react-i18next";
import { DesktopUpdateProvider, useDesktopUpdateState } from "./DesktopUpdateState";
import {
  PHASE_CONFIG,
  UPDATE_EVENT_NAMES,
  formatUpdateVersion,
  getUpdatePhaseLabel,
  registerUpdateListeners,
} from "./updateHelpers";

function UpdateProgressBar({ progress, compact = false }) {
  return (
    <div className={`flex items-center gap-2 ${compact ? "mt-1.5" : "mt-4"}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-700/60">
        <div
          className="h-full rounded-full bg-cyan-400 transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-zinc-400">{progress}%</span>
    </div>
  );
}

function VersionLabel({ update }) {
  const { t } = useTranslation();
  const versionLabel = formatUpdateVersion(update, t);

  if (!versionLabel) {
    return null;
  }

  return (
    <p className="truncate text-xs text-zinc-400">
      {versionLabel}
    </p>
  );
}

export function DesktopStartupUpdateGate() {
  const { t } = useTranslation();
  const {
    isDesktop,
    phase,
    progress,
    update,
    errorMsg,
    showStartupGate,
  } = useDesktopUpdateState();

  if (!isDesktop || !showStartupGate) {
    return null;
  }

  const config = PHASE_CONFIG[phase] || PHASE_CONFIG.checking;
  const PhaseIcon = config.icon;
  const resolvedMessage = phase === "error"
    ? (errorMsg || t("updater.unknownError"))
    : getUpdatePhaseLabel(phase, t);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_35%),linear-gradient(180deg,#040508,#07080c_42%,#05060a_100%)]"
      data-testid="desktop-update-startup-gate"
      role="status"
      aria-live="polite"
    >
      <div className="mx-6 w-full max-w-md rounded-[32px] border border-white/10 bg-zinc-950/88 p-8 text-white shadow-[0_30px_120px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
        <div className="mb-6 flex items-center gap-4">
          <img
            src="/favicon-192x192.png"
            alt="Singra Vox"
            className="h-14 w-14 rounded-2xl"
            style={{ filter: "drop-shadow(0 0 24px rgba(34,211,238,0.22))" }}
          />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300/80">
              Singra Vox
            </p>
            <h2 className="mt-1 text-2xl font-bold" style={{ fontFamily: "Manrope" }}>
              {t("updater.startupTitle")}
            </h2>
          </div>
        </div>

        <p className="text-sm text-zinc-400">{t("updater.startupSubtitle")}</p>

        <div className="mt-8 flex items-start gap-4 rounded-3xl border border-white/8 bg-white/[0.03] p-4">
          <PhaseIcon size={22} weight="bold" className={config.iconClass} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-white">{resolvedMessage}</p>
            <VersionLabel update={update} />
            {phase === "downloading" && <UpdateProgressBar progress={progress} />}
          </div>
        </div>
      </div>
    </div>
  );
}

export function UpdateNotification() {
  const { t } = useTranslation();
  const {
    isDesktop,
    phase,
    progress,
    update,
    errorMsg,
    showStartupGate,
  } = useDesktopUpdateState();

  if (!isDesktop || showStartupGate || phase === "idle") {
    return null;
  }

  const config = PHASE_CONFIG[phase];
  if (!config) {
    return null;
  }

  const PhaseIcon = config.icon;
  const resolvedMessage = phase === "error"
    ? (errorMsg || t("updater.unknownError"))
    : getUpdatePhaseLabel(phase, t);
  const versionUpdate = phase === "checking" || phase === "up-to-date" || phase === "error"
    ? null
    : update;

  return (
    <div
      className={`fixed left-0 right-0 top-0 z-[100] border-b backdrop-blur-xl transition-all duration-300 ${config.bg}`}
      data-testid="update-notification"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-2.5">
        <PhaseIcon size={18} weight="bold" className={config.iconClass} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">{resolvedMessage}</p>
          <VersionLabel update={versionUpdate} />
          {phase === "downloading" && <UpdateProgressBar progress={progress} compact />}
        </div>
      </div>
    </div>
  );
}

export {
  DesktopUpdateProvider,
  UPDATE_EVENT_NAMES,
  formatUpdateVersion,
  getUpdatePhaseLabel,
  registerUpdateListeners,
};
