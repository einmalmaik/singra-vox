/*
 * Singra Vox – Server Invites settings tab
 */
import { useTranslation } from "react-i18next";
import InviteGeneratorPanel from "@/components/invites/InviteGeneratorPanel";

export default function ServerInvitesTab({ server }) {
  const { t } = useTranslation();

  return (
    <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
      <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("server.invites")}</h3>
      <p className="mt-1 text-sm text-[#71717A]">{t("serverSettings.invitesDescription")}</p>
      <div className="mt-5">
        <InviteGeneratorPanel serverId={server.id} />
      </div>
    </section>
  );
}
