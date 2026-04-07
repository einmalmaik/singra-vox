/*
 * Singra Vox – Server Audit Log settings tab
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import api from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";

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
    <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
      <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("serverSettings.auditTitle")}</h3>
      <ScrollArea className="mt-5 h-[560px] pr-4">
        {auditLogs.length === 0 ? (
          <p className="text-sm text-[#71717A]">{t("serverSettings.auditEmpty")}</p>
        ) : (
          <div className="space-y-3">
            {auditLogs.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-[#27272A] bg-[#0A0A0A] px-4 py-3">
                <p className="text-sm text-white">
                  <span className="font-semibold">{entry.actor?.display_name || t("common.system")}</span>{" "}
                  <span className="text-[#A1A1AA]">{entry.action.replace(/_/g, " ")}</span>
                </p>
                <p className="mt-1 text-xs text-[#71717A]">{new Date(entry.created_at).toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </section>
  );
}
