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
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 p-3 backdrop-blur-md sm:p-6" data-testid="settings-overlay">
      <div className="workspace-panel-solid relative flex h-[min(88vh,900px)] w-full max-w-7xl overflow-hidden text-white">
        <div className="absolute left-[-8rem] top-[-8rem] h-72 w-72 rounded-full bg-cyan-500/10 blur-[100px]" />
        <div className="absolute bottom-[-6rem] right-[-6rem] h-56 w-56 rounded-full bg-zinc-400/10 blur-[100px]" />
        <div className="relative z-10 flex w-[min(290px,40vw)] shrink-0 flex-col border-r workspace-divider bg-zinc-950/45 p-4 sm:p-5">
          <div className="mb-6 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="workspace-section-label">{t("common.settings")}</p>
              <h2 className="mt-2 break-words pr-12 text-xl font-bold leading-tight sm:text-2xl" style={{ fontFamily: "Manrope" }}>
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

          <div className="space-y-1">
            {sections.map((section) => (
              <button
                key={section.id}
                onClick={() => onSectionChange(section.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all ${
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

          {footerActions.length > 0 && (
            <div className="mt-auto border-t border-white/8 pt-4">
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
                    data-testid={action.testId || `settings-footer-action-${action.id}`}
                  >
                    {action.icon}
                    <span className="truncate">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="relative z-10 flex-1 overflow-y-auto bg-zinc-900/15 p-5 sm:p-8">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
