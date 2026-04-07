/*
 * Singra Vox – Server Audit Log settings tab
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import api from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";

export default function ServerAuditTab({ server }) {
  const { t } = useTranslation();
  const [auditLogs, setAuditLogs] = useState([]);

  const loadAudit = useCallback(async () => {
    try {
      const res = await api.get(`/servers/${server.id}/moderation/audit-log`);
      setAuditLogs(res.data);
    } catch {
      setAuditLogs([]);
    }
  }, [server?.id]);

  useEffect(() => {
    if (server?.id) void loadAudit();
  }, [loadAudit, server?.id]);

  return (
    <section className="workspace-card p-6" data-testid="server-settings-audit">
      <div className="flex items-start gap-4 mb-6">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/15">
          <ClockCounterClockwise size={22} className="text-violet-300" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-white" style={{ fontFamily: "Manrope" }}>
                {t("serverSettings.auditTitle")}
              </h3>
              <p className="mt-1 text-sm text-zinc-500">
                {t("serverSettings.auditDescription", { defaultValue: "Protokoll aller administrativen Aktionen auf diesem Server." })}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => void loadAudit()}
              className="h-9 rounded-xl border-white/10 bg-transparent text-zinc-300 hover:bg-white/5 text-xs px-3 transition-colors shrink-0"
              data-testid="refresh-audit-btn"
            >
              {t("server.refresh", { defaultValue: "Aktualisieren" })}
            </Button>
          </div>
        </div>
      </div>

      <ScrollArea className="h-[560px] pr-4">
        {auditLogs.length === 0 ? (
          <div className="rounded-2xl border border-white/8 bg-zinc-950/40 px-5 py-10 text-center">
            <ClockCounterClockwise size={32} className="mx-auto text-zinc-700 mb-3" />
            <p className="text-sm text-zinc-600">{t("serverSettings.auditEmpty")}</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {auditLogs.map((entry) => (
              <div
                key={entry.id}
                className="rounded-2xl border border-white/10 bg-zinc-950/60 px-5 py-4 transition-colors hover:bg-zinc-950/80"
                data-testid={`audit-entry-${entry.id}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm text-white">
                      <span className="font-semibold">{entry.actor?.display_name || t("common.system")}</span>{" "}
                      <span className="text-zinc-400">{entry.action.replace(/_/g, " ")}</span>
                    </p>
                    {entry.details && (
                      <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">{entry.details}</p>
                    )}
                  </div>
                  <time className="shrink-0 text-[11px] text-zinc-600 tabular-nums">
                    {new Date(entry.created_at).toLocaleString()}
                  </time>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}
