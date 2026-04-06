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
import { saveInstance } from "@/lib/instanceManager";
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
      // Instanz automatisch in gespeicherten Instanzen speichern
      try {
        const url = instanceUrl.trim().replace(/\/+$/, "");
        const name = new URL(url).hostname;
        saveInstance({ name, url });
      } catch { /* URL ungültig – kein Absturz */ }
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
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <div
            className="flex items-center justify-center w-12 h-12 rounded-2xl"
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
            <p className="text-zinc-500 text-sm mt-0.5">{t("connect.subtitle")}</p>
          </div>
        </div>

        {/* Card */}
        <div className="workspace-card p-6 space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <LocalizedErrorBanner
              message={error}
              className="rounded-xl text-red-300 bg-red-950/30 border border-red-800/30 px-4 py-3 text-sm"
              data-testid="connect-error"
            />

            {/* URL Input */}
            <div className="space-y-1.5">
              <Label className="workspace-section-label">{t("connect.instanceUrl")}</Label>
              <Input
                value={instanceUrl}
                onChange={(e) => setInstanceUrl(e.target.value)}
                placeholder={t("connect.instanceUrlPlaceholder")}
                required
                data-testid="instance-url-input"
                className="bg-zinc-900/70 border-white/10 focus:border-cyan-500/50 text-white placeholder:text-zinc-600 rounded-xl h-10"
              />
            </div>

            {/* Help Text */}
            <div
              className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-xs text-zinc-400"
              style={{
                background: "rgba(34,211,238,0.06)",
                border: "1px solid rgba(34,211,238,0.15)",
              }}
            >
              <LinkSimple size={15} className="text-cyan-400 shrink-0 mt-0.5" />
              <span>{t("connect.helpText")}</span>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading}
              data-testid="connect-submit-button"
              className="w-full font-semibold h-11 rounded-xl text-sm transition-all duration-200"
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
        className="fixed bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-zinc-600 transition-colors hover:text-zinc-400 bg-transparent border-0 cursor-pointer"
        data-testid="repo-footer-link"
      >
        Singra Vox &middot; Open Source on GitHub
      </button>
    </div>
  );
}
