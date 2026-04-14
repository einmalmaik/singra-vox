/*
 * Singra Vox – Server Members settings tab
 * Member list with role assignment, moderation (mute/kick/ban), and ban list.
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash, UserMinus, Users, Gavel } from "@phosphor-icons/react";
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
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]" data-testid="server-settings-members">
      {/* Member list */}
      <section className="workspace-card p-6">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/15">
            <Users size={22} className="text-cyan-300" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white" style={{ fontFamily: "Manrope" }}>
              {t("server.members")}
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              {members?.length || 0} {t("serverSettings.membersCount")}
            </p>
          </div>
        </div>

        <ScrollArea className="h-[560px] pr-4" data-testid="members-list">
          <div className="space-y-3">
            {members?.map((member) => {
              const isOwner = server?.owner_id === member.user_id;
              return (
                <div
                  key={member.user_id}
                  className="rounded-2xl border border-white/10 bg-zinc-950/60 p-5 transition-colors hover:bg-zinc-950/80"
                  data-testid={`member-card-${member.user_id}`}
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/8 text-sm font-bold text-white uppercase">
                        {(member.user?.display_name || member.user?.username || "?").charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {member.user?.display_name}
                          {isOwner && (
                            <span className="ml-2 inline-flex items-center rounded-lg bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.15em] text-amber-300">
                              {t("server.owner")}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-zinc-500">@{member.user?.username}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {roles?.filter((r) => !r.is_default).map((role) => {
                        const hasRole = member.roles?.includes(role.id);
                        return (
                          <button
                            key={role.id}
                            onClick={() => assignRole(member, role.id)}
                            className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
                              hasRole
                                ? "border-current/30 opacity-100"
                                : "border-white/8 text-zinc-600 opacity-70 hover:opacity-100 hover:text-zinc-400"
                            }`}
                            style={hasRole ? { color: role.color, borderColor: `${role.color}44` } : undefined}
                            data-testid={`assign-role-${role.id}-${member.user_id}`}
                          >
                            {role.name}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-2 shrink-0">
                      {capabilities.canMuteMembers && (
                        <Button
                          onClick={() => moderateMember(member.user_id, "mute")}
                          variant="outline"
                          className="h-9 rounded-xl border-white/10 bg-transparent text-zinc-300 hover:bg-white/5 text-xs px-3 transition-colors"
                        >
                          {t("memberList.mute")}
                        </Button>
                      )}
                      {!isOwner && (
                        <>
                          {capabilities.canKickMembers && (
                            <Button
                              onClick={() => moderateMember(member.user_id, "kick")}
                              variant="outline"
                              className="h-9 rounded-xl border-red-500/20 bg-transparent text-red-400 hover:bg-red-500/10 text-xs px-3 transition-colors"
                            >
                              <UserMinus size={13} className="mr-1.5" />{t("memberList.kick")}
                            </Button>
                          )}
                          {capabilities.canBanMembers && (
                            <Button
                              onClick={() => moderateMember(member.user_id, "ban")}
                              variant="outline"
                              className="h-9 rounded-xl border-red-500/20 bg-transparent text-red-400 hover:bg-red-500/10 text-xs px-3 transition-colors"
                            >
                              <Trash size={13} className="mr-1.5" />{t("memberList.ban")}
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
      <section className="workspace-card p-6">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-500/15">
            <Gavel size={22} className="text-red-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white" style={{ fontFamily: "Manrope" }}>
                  {t("server.bannedMembers")}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">{t("serverSettings.bannedMembersHelp")}</p>
              </div>
              <Button
                variant="outline"
                onClick={() => void loadBans()}
                disabled={!capabilities.canBanMembers && !capabilities.canManageMembers}
                className="h-9 rounded-xl border-white/10 bg-transparent text-zinc-300 hover:bg-white/5 text-xs px-3 transition-colors shrink-0"
                data-testid="refresh-bans-btn"
              >
                {t("server.refresh")}
              </Button>
            </div>
          </div>
        </div>

        <ScrollArea className="h-[560px] pr-4">
          {!capabilities.canBanMembers && !capabilities.canManageMembers ? (
            <div className="rounded-2xl border border-white/8 bg-zinc-950/40 px-5 py-6 text-center">
              <p className="text-sm text-zinc-600">{t("serverSettings.noBanPermission")}</p>
            </div>
          ) : bannedMembers.length === 0 ? (
            <div className="rounded-2xl border border-white/8 bg-zinc-950/40 px-5 py-6 text-center">
              <p className="text-sm text-zinc-600">{t("serverSettings.noBannedMembers")}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {bannedMembers.map((member) => (
                <div
                  key={member.user_id}
                  className="rounded-2xl border border-white/10 bg-zinc-950/60 p-5"
                  data-testid={`banned-member-${member.user_id}`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-white">{member.user?.display_name || member.user?.username}</p>
                      <p className="text-xs text-zinc-500">@{member.user?.username}</p>
                      {member.ban_reason && (
                        <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
                          {t("serverSettings.bannedReason", { reason: member.ban_reason })}
                        </p>
                      )}
                    </div>
                    <Button
                      onClick={() => moderateMember(member.user_id, "unban")}
                      className="h-10 rounded-2xl bg-cyan-400 text-zinc-950 font-semibold hover:bg-cyan-300 px-5 transition-colors shrink-0"
                    >
                      {t("server.unban")}
                    </Button>
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
