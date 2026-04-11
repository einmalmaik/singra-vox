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
import { openExternalUrl } from "@/lib/desktop";

function FoxLogo({ size = 26 }) {
  return (
    <img
      src="/favicon-192x192.png"
      alt="Singra Vox"
      width={size}
      height={size}
      className="object-contain"
      style={{ imageRendering: "auto" }}
    />
  );
}

export default function AuthShell({
  eyebrow,
  title,
  subtitle,
  children,
  footer = null,
  icon: Icon = null,
  sideTitle = "Singra Vox",
  sideCopy = null,
  sideDetails = [],
  cardClassName = "",
  contentClassName = "",
}) {
  const { t } = useTranslation();
  return (
    <div className="relative min-h-screen overflow-x-hidden overflow-y-auto bg-[#06080d] px-3 py-4 text-white sm:px-6 sm:py-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),transparent_35%),linear-gradient(180deg,#06080d_0%,#090c12_45%,#05070b_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)", backgroundSize: "42px 42px" }} />
      <div className="pointer-events-none absolute left-[-10%] top-[-10%] h-[28rem] w-[28rem] rounded-full bg-cyan-500/16 blur-[140px]" />
      <div className="pointer-events-none absolute bottom-[-15%] right-[-8%] h-[24rem] w-[24rem] rounded-full bg-zinc-500/14 blur-[120px]" />

      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl flex-col items-center justify-start py-2 lg:justify-center lg:py-0">
        <main className={`workspace-panel-solid grid w-full max-w-5xl overflow-hidden p-0 lg:grid-cols-[minmax(0,1fr)_340px] ${cardClassName}`}>
          <section className="relative p-6 sm:p-8 xl:p-10">
            <div className={`mx-auto w-full max-w-md ${contentClassName}`}>
              <div className="mb-8 flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-400/20 to-cyan-600/20 shadow-[0_18px_36px_rgba(34,211,238,0.18)] overflow-hidden">
                  {Icon ? <Icon size={26} weight="fill" /> : <FoxLogo size={38} />}
                </div>
                <div>
                  <p className="workspace-section-label">Singra Vox</p>
                  <p className="mt-1 text-xl font-bold text-white" style={{ fontFamily: "Manrope" }}>
                    {sideTitle}
                  </p>
                </div>
              </div>

              {eyebrow ? (
                <p className="workspace-section-label">{eyebrow}</p>
              ) : null}
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-[2rem]" style={{ fontFamily: "Manrope" }}>
                {title}
              </h2>
              {subtitle ? (
                <p className="mt-3 text-sm leading-6 text-zinc-400 sm:text-base">
                  {subtitle}
                </p>
              ) : null}

              <div className="mt-8">{children}</div>
              {footer ? <div className="mt-8">{footer}</div> : null}
            </div>
          </section>

          <aside className="hidden border-l border-white/8 bg-zinc-950/45 p-8 lg:flex lg:flex-col">
            <div className="rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_55%),rgba(9,11,18,0.85)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <p className="workspace-section-label">{t("auth.welcomeBack")}</p>
              <h1 className="mt-3 text-3xl font-bold tracking-tight text-white" style={{ fontFamily: "Manrope" }}>
                {sideTitle}
              </h1>
              {sideCopy ? (
                <p className="mt-4 text-sm leading-7 text-zinc-300">
                  {sideCopy}
                </p>
              ) : null}
            </div>

            {sideDetails.length > 0 ? (
              <div className="mt-5 grid gap-3">
                {sideDetails.map((detail) => (
                  <div key={detail.title} className="workspace-card p-4">
                    <p className="workspace-section-label">{detail.title}</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-300">{detail.description}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <div className="workspace-card p-4">
                  <p className="workspace-section-label">{t("auth.sideFeatureSecureTitle")}</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {t("auth.sideFeatureSecureCopy")}
                  </p>
                </div>
                <div className="workspace-card p-4">
                  <p className="workspace-section-label">{t("auth.sideFeatureVoiceTitle")}</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">
                    {t("auth.sideFeatureVoiceCopy")}
                  </p>
                </div>
              </div>
            )}
          </aside>
        </main>
        <button
          onClick={() => openExternalUrl("https://github.com/einmalmaik/singra-vox")}
          className="mt-4 text-[11px] text-zinc-600 transition-colors hover:text-zinc-400 bg-transparent border-0 cursor-pointer"
          data-testid="repo-footer-link"
        >
          Singra Vox &middot; Open Source on GitHub
        </button>
      </div>
    </div>
  );
}
