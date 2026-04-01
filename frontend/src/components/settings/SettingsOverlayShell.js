import { X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export default function SettingsOverlayShell({
  open,
  title,
  sections,
  activeSection,
  onSectionChange,
  onClose,
  children,
}) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex bg-black/70 backdrop-blur-sm" data-testid="settings-overlay">
      <div className="flex h-full w-full bg-[#0A0A0A] text-white">
        <div className="w-[260px] border-r border-[#27272A] bg-[#121212] p-4">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("common.settings")}</p>
              <h2 className="mt-1 text-xl font-bold" style={{ fontFamily: "Manrope" }}>{title}</h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-2 text-[#71717A] transition-colors hover:bg-[#27272A] hover:text-white"
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
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  activeSection === section.id
                    ? "bg-[#27272A] text-white"
                    : "text-[#A1A1AA] hover:bg-[#1A1A1A] hover:text-white"
                }`}
                data-testid={`settings-section-${section.id}`}
              >
                {section.icon}
                <span>{section.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-[#18181B] p-6">
          <div className="mx-auto max-w-6xl">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
