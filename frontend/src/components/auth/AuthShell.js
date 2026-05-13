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
    <div className="relative min-h-screen overflow-x-hidden overflow-y-auto bg-[#071014] px-3 py-4 text-white sm:px-6 sm:py-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_52%_0%,rgba(137,214,228,0.14),transparent_34rem),radial-gradient(circle_at_12%_32%,rgba(86,205,178,0.07),transparent_28rem),linear-gradient(180deg,#071014_0%,#0b1319_45%,#05090c_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.12) 1px, transparent 1px)", backgroundSize: "44px 44px" }} />
      <div className="pointer-events-none absolute left-[-10%] top-[-10%] h-[28rem] w-[28rem] rounded-full bg-cyan-300/10 blur-[140px]" />
      <div className="pointer-events-none absolute bottom-[-15%] right-[-8%] h-[24rem] w-[24rem] rounded-full bg-emerald-300/8 blur-[120px]" />

      <div className="relative mx-auto flex min-h-[calc(100vh-2rem)] max-w-6xl flex-col items-center justify-start py-2 lg:justify-center lg:py-0">
        <main className={`workspace-panel-solid grid w-full max-w-5xl overflow-hidden p-0 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_24px_64px_rgba(0,0,0,0.42)] lg:grid-cols-[minmax(0,1fr)_340px] ${cardClassName}`}>
          <section className="relative p-6 sm:p-8 xl:p-10">
            <div className={`mx-auto w-full max-w-md ${contentClassName}`}>
              <div className="mb-8 flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl border border-cyan-100/15 bg-gradient-to-br from-cyan-100/18 to-emerald-200/10 shadow-[0_18px_36px_rgba(137,214,228,0.16)]">
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

          <aside className="hidden border-l border-cyan-100/10 bg-[#071014]/55 p-8 lg:flex lg:flex-col">
            <div className="rounded-2xl border border-cyan-100/12 bg-[radial-gradient(circle_at_top,rgba(137,214,228,0.16),transparent_55%),rgba(10,18,24,0.86)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
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
