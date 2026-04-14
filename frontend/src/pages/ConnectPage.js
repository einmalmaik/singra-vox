/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DesktopTower, LinkSimple } from "@phosphor-icons/react";
import { useRuntime } from "@/contexts/RuntimeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAppError } from "@/lib/appErrors";
import LocalizedErrorBanner from "@/components/ui/LocalizedErrorBanner";
import { openExternalUrl } from "@/lib/desktop";

export default function ConnectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { connectToInstance } = useRuntime();
  const [instanceUrl, setInstanceUrl] = useState("http://localhost:8080");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { status } = await connectToInstance(instanceUrl);
      navigate(status?.initialized ? "/login" : "/setup");
    } catch (err) {
      setError(formatAppError(t, err, { fallbackKey: "connect.couldNotReach" }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{
        background:
          "radial-gradient(circle at top left, rgba(34,211,238,0.12), transparent 28%), radial-gradient(circle at bottom right, rgba(113,113,122,0.2), transparent 32%), linear-gradient(180deg,#05070b 0%,#09090b 45%,#060608 100%)",
      }}
      data-testid="connect-page"
    >
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-4">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-2xl"
            style={{
              background: "rgba(34,211,238,0.12)",
              border: "1px solid rgba(34,211,238,0.22)",
              boxShadow: "0 0 28px rgba(34,211,238,0.1)",
            }}
          >
            <DesktopTower size={24} weight="fill" className="text-cyan-400" />
          </div>
          <div>
            <h1
              className="text-2xl font-bold text-white"
              style={{ fontFamily: "Manrope" }}
            >
              {t("connect.title")}
            </h1>
            <p className="mt-0.5 text-sm text-zinc-500">{t("connect.subtitle")}</p>
          </div>
        </div>

        <div className="workspace-card space-y-4 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <LocalizedErrorBanner
              message={error}
              className="rounded-xl border border-red-800/30 bg-red-950/30 px-4 py-3 text-sm text-red-300"
              data-testid="connect-error"
            />

            <div className="space-y-1.5">
              <Label className="workspace-section-label">{t("connect.instanceUrl")}</Label>
              <Input
                value={instanceUrl}
                onChange={(event) => setInstanceUrl(event.target.value)}
                placeholder={t("connect.instanceUrlPlaceholder")}
                required
                data-testid="instance-url-input"
                className="h-10 rounded-xl border-white/10 bg-zinc-900/70 text-white placeholder:text-zinc-600 focus:border-cyan-500/50"
              />
            </div>

            <div
              className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-xs text-zinc-400"
              style={{
                background: "rgba(34,211,238,0.06)",
                border: "1px solid rgba(34,211,238,0.15)",
              }}
            >
              <LinkSimple size={15} className="mt-0.5 shrink-0 text-cyan-400" />
              <span>{t("connect.helpText")}</span>
            </div>

            <Button
              type="submit"
              disabled={loading}
              data-testid="connect-submit-button"
              className="h-11 w-full rounded-xl text-sm font-semibold transition-all duration-200"
              style={{
                background: loading
                  ? "rgba(34,211,238,0.3)"
                  : "linear-gradient(135deg, rgba(34,211,238,0.85), rgba(6,182,212,0.9))",
                color: "#05070b",
                border: "1px solid rgba(34,211,238,0.3)",
                boxShadow: loading ? "none" : "0 0 20px rgba(34,211,238,0.2)",
              }}
            >
              {loading ? t("connect.connecting") : t("connect.connect")}
            </Button>
          </form>
        </div>
      </div>
      <button
        onClick={() => openExternalUrl("https://github.com/einmalmaik/singra-vox")}
        className="fixed bottom-3 left-1/2 -translate-x-1/2 cursor-pointer border-0 bg-transparent text-[11px] text-zinc-600 transition-colors hover:text-zinc-400"
        data-testid="repo-footer-link"
      >
        Singra Vox &middot; Open Source on GitHub
      </button>
    </div>
  );
}
