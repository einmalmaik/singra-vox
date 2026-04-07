/*
 * Singra Vox – Server Members settings tab
 * Member list with role assignment, moderation (mute/kick/ban), and ban list.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash, UserMinus } from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function ServerMembersTab({ server, members, roles, capabilities }) {
  const { t } = useTranslation();
  const [bannedMembers, setBannedMembers] = useState([]);

  const loadBans = useCallback(async () => {
    try {
      const res = await api.get(`/servers/${server.id}/moderation/bans`);
      setBannedMembers(res.data);
    } catch {
      setBannedMembers([]);
    }
  }, [server?.id]);

  useEffect(() => {
    if (server?.id) void loadBans();
  }, [loadBans, server?.id]);

  const assignRole = async (member, roleId) => {
    const nextRoles = member.roles?.includes(roleId)
      ? member.roles.filter((id) => id !== roleId)
      : [...(member.roles || []), roleId];
    try {
      await api.put(`/servers/${server.id}/members/${member.user_id}`, { roles: nextRoles });
      toast.success(t("serverSettings.memberUpdated"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.memberUpdateFailed" }));
    }
  };

  const moderateMember = async (memberId, action) => {
    try {
      if (action === "kick") await api.delete(`/servers/${server.id}/members/${memberId}`);
      else if (action === "ban") await api.post(`/servers/${server.id}/moderation/ban`, { user_id: memberId, reason: t("serverSettings.defaultBanReason") });
      else if (action === "unban") await api.post(`/servers/${server.id}/moderation/unban`, { user_id: memberId });
      else if (action === "mute") await api.post(`/servers/${server.id}/moderation/mute`, { user_id: memberId, duration_minutes: 10 });
      toast.success(
        action === "mute" ? t("serverSettings.memberMuted")
          : action === "kick" ? t("serverSettings.memberKicked")
          : action === "unban" ? t("serverSettings.memberUnbanned")
          : t("serverSettings.memberBanned"),
      );
      if (action === "unban" || action === "ban") await loadBans();
    } catch (error) {
      const actionLabel = { mute: t("memberList.mute"), kick: t("memberList.kick"), ban: t("memberList.ban"), unban: t("server.unban") }[action] || action;
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.memberActionFailed", fallbackParams: { action: actionLabel } }));
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="server-settings-members">
      {/* Member list */}
      <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
        <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("server.members")}</h3>
        <ScrollArea className="mt-5 h-[560px] pr-4" data-testid="members-list">
          <div className="space-y-4">
            {members?.map((member) => {
              const isOwner = server?.owner_id === member.user_id;
              return (
                <div key={member.user_id} className="rounded-lg border border-[#27272A] bg-[#0A0A0A] p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {member.user?.display_name}
                        {isOwner ? <span className="ml-2 text-[10px] uppercase tracking-[0.2em] text-[#F59E0B]">{t("server.owner")}</span> : null}
                      </p>
                      <p className="text-xs text-[#71717A]">@{member.user?.username}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {roles?.filter((r) => !r.is_default).map((role) => (
                        <button
                          key={role.id}
                          onClick={() => assignRole(member, role.id)}
                          className={`rounded-full border px-2 py-1 text-xs transition-colors ${
                            member.roles?.includes(role.id)
                              ? "border-current opacity-100"
                              : "border-[#27272A] text-[#71717A] opacity-70 hover:opacity-100"
                          }`}
                          style={{ color: role.color }}
                        >
                          {role.name}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      {capabilities.canMuteMembers && (
                        <Button onClick={() => moderateMember(member.user_id, "mute")} variant="outline" className="border-[#27272A] bg-transparent text-white hover:bg-[#1A1A1A]">{t("memberList.mute")}</Button>
                      )}
                      {!isOwner && (
                        <>
                          {capabilities.canKickMembers && (
                            <Button onClick={() => moderateMember(member.user_id, "kick")} variant="outline" className="border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10">
                              <UserMinus size={14} className="mr-2" />{t("memberList.kick")}
                            </Button>
                          )}
                          {capabilities.canBanMembers && (
                            <Button onClick={() => moderateMember(member.user_id, "ban")} variant="outline" className="border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10">
                              <Trash size={14} className="mr-2" />{t("memberList.ban")}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </section>

      {/* Ban list */}
      <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("server.bannedMembers")}</h3>
            <p className="mt-1 text-sm text-[#71717A]">{t("serverSettings.bannedMembersHelp")}</p>
          </div>
          <Button
            variant="outline"
            onClick={() => void loadBans()}
            disabled={!capabilities.canBanMembers && !capabilities.canManageMembers}
            className="border-[#27272A] bg-transparent text-white hover:bg-[#1A1A1A]"
          >
            {t("server.refresh")}
          </Button>
        </div>

        <ScrollArea className="mt-5 h-[560px] pr-4">
          {!capabilities.canBanMembers && !capabilities.canManageMembers ? (
            <p className="text-sm text-[#71717A]">{t("serverSettings.noBanPermission")}</p>
          ) : bannedMembers.length === 0 ? (
            <p className="text-sm text-[#71717A]">{t("serverSettings.noBannedMembers")}</p>
          ) : (
            <div className="space-y-3">
              {bannedMembers.map((member) => (
                <div key={member.user_id} className="rounded-lg border border-[#27272A] bg-[#0A0A0A] p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">{member.user?.display_name || member.user?.username}</p>
                      <p className="text-xs text-[#71717A]">@{member.user?.username}</p>
                      {member.ban_reason ? <p className="mt-2 text-xs text-[#A1A1AA]">{t("serverSettings.bannedReason", { reason: member.ban_reason })}</p> : null}
                    </div>
                    <Button onClick={() => moderateMember(member.user_id, "unban")} className="bg-cyan-400 text-zinc-950 hover:bg-cyan-300">{t("server.unban")}</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </section>
    </div>
  );
}
