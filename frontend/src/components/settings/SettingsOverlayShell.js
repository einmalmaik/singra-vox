/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useEffect } from "react";
import { X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export default function SettingsOverlayShell({
  open,
  title,
  sections,
  activeSection,
  onSectionChange,
  onClose,
  footerActions = [],
  children,
}) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 backdrop-blur-md p-0 md:p-6"
      data-testid="settings-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="workspace-panel-solid relative flex flex-col md:flex-row h-full md:h-[min(88vh,900px)] w-full md:max-w-7xl overflow-hidden text-white md:rounded-[1.35rem]">
        {/* Background decoration */}
        <div className="absolute left-[-8rem] top-[-8rem] h-72 w-72 rounded-full bg-cyan-500/10 blur-[100px] pointer-events-none" />
        <div className="absolute bottom-[-6rem] right-[-6rem] h-56 w-56 rounded-full bg-zinc-400/10 blur-[100px] pointer-events-none" />

        {/* Navigation: top-bar on mobile, sidebar on desktop */}
        <nav className="relative z-10 shrink-0 border-b md:border-b-0 md:border-r workspace-divider bg-zinc-950/45 md:w-[min(280px,35vw)] md:flex md:flex-col">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-4 py-3 md:flex-col md:items-start md:px-5 md:pt-5 md:pb-2">
            <div className="min-w-0 flex-1 md:w-full">
              <p className="workspace-section-label hidden md:block">
                {t("common.settings")}
              </p>
              <h2
                className="truncate text-lg font-bold leading-tight md:mt-2 md:text-xl"
                style={{ fontFamily: "Manrope" }}
              >
                {title}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="workspace-icon-button shrink-0"
              data-testid="settings-close-button"
            >
              <X size={18} />
            </button>
          </div>

          {/* Section tabs – horizontal scroll on mobile, vertical list on desktop */}
          <div className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-x-visible md:px-5 md:pb-0 md:space-y-1">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => onSectionChange(section.id)}
                className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm whitespace-nowrap transition-all md:w-full md:gap-3 md:py-2.5 ${
                  activeSection === section.id
                    ? "bg-cyan-500/12 text-white workspace-cyan-glow"
                    : "text-[#A1A1AA] hover:bg-white/5 hover:text-white"
                }`}
                data-testid={`settings-section-${section.id}`}
              >
                {section.icon}
                <span>{section.label}</span>
              </button>
            ))}
          </div>

          {/* Footer actions – sidebar only (desktop) */}
          {footerActions.length > 0 && (
            <div className="hidden md:block mt-auto border-t border-white/8 p-4">
              <div className="space-y-2">
                {footerActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={action.onClick}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
                      action.tone === "danger"
                        ? "border border-red-500/20 bg-red-500/10 text-red-200 hover:bg-red-500/15"
                        : "border border-white/8 bg-white/[0.03] text-[#D4D4D8] hover:bg-white/8 hover:text-white"
                    }`}
                    data-testid={
                      action.testId || `settings-footer-action-${action.id}`
                    }
                  >
                    {action.icon}
                    <span className="truncate">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </nav>

        {/* Main content */}
        <main className="relative z-10 flex-1 overflow-y-auto p-4 sm:p-6 md:p-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>

        {/* Mobile footer actions */}
        {footerActions.length > 0 && (
          <div className="md:hidden border-t border-white/8 bg-zinc-950/60 p-3">
            <div className="flex gap-2">
              {footerActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={action.onClick}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm transition-all ${
                    action.tone === "danger"
                      ? "border border-red-500/20 bg-red-500/10 text-red-200"
                      : "border border-white/8 bg-white/[0.03] text-[#D4D4D8]"
                  }`}
                  data-testid={
                    action.testId || `settings-footer-action-${action.id}`
                  }
                >
                  {action.icon}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
