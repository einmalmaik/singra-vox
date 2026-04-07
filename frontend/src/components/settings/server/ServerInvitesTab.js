/*
 * Singra Vox – Server Invites settings tab
 */
import { useTranslation } from "react-i18next";
import { LinkSimple } from "@phosphor-icons/react";
import InviteGeneratorPanel from "@/components/invites/InviteGeneratorPanel";

export default function ServerInvitesTab({ server }) {
  const { t } = useTranslation();

  return (
    <section className="workspace-card p-6" data-testid="server-settings-invites">
      <div className="flex items-start gap-4 mb-6">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/15">
          <LinkSimple size={22} className="text-cyan-300" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white" style={{ fontFamily: "Manrope" }}>
            {t("server.invites")}
          </h3>
          <p className="mt-1 text-sm text-zinc-500 leading-relaxed">
            {t("serverSettings.invitesDescription")}
          </p>
        </div>
      </div>
      <InviteGeneratorPanel serverId={server.id} />
    </section>
  );
}
