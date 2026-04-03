import { ShieldCheck } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

const BASE_BADGE_CLASS =
  "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em]";

export default function E2EEStatus({
  variant = "badge",
  scope = "private_channel",
  ready = false,
  isDesktopCapable = false,
  messageKey: customMessageKey = "",
  className = "",
}) {
  const { t } = useTranslation();

  if (variant === "badge") {
    return (
      <div className={`${BASE_BADGE_CLASS} border-cyan-400/25 bg-cyan-400/8 text-cyan-300 ${className}`.trim()}>
        <ShieldCheck size={12} weight="fill" />
        <span>{t("e2ee.badge")}</span>
      </div>
    );
  }

  if (variant === "notice") {
    return (
      <div className={`rounded-2xl border border-amber-400/20 bg-amber-500/10 p-4 text-sm text-amber-100 ${className}`.trim()}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 text-amber-200">
            <ShieldCheck size={16} weight="fill" />
          </span>
          <div className="space-y-1">
            <p className="font-semibold text-white">{t("e2ee.title")}</p>
            <p>{t(customMessageKey || "e2ee.deviceListChanged")}</p>
          </div>
        </div>
      </div>
    );
  }

  const messageKey = (() => {
    if (!ready) {
      switch (scope) {
        case "dm":
          return "e2ee.dmVerifyDevice";
        case "thread":
          return "e2ee.threadVerifyDevice";
        case "pins":
          return "e2ee.pinsVerifyDevice";
        default:
          return "e2ee.privateChannelVerifyDevice";
      }
    }
    return "e2ee.badge";
  })();

  return (
    <div className={`rounded-2xl border border-white/10 bg-zinc-950/75 p-4 text-sm text-zinc-300 ${className}`.trim()}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300">
          <ShieldCheck size={16} weight="fill" />
        </span>
        <div className="space-y-1">
          <p className="font-semibold text-white">{t("e2ee.title")}</p>
          <p>{t(messageKey)}</p>
        </div>
      </div>
    </div>
  );
}
