import { Crown, ChatCircle, UserMinus, Prohibit, Timer } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import api, { formatError } from "@/lib/api";
import { toast } from "sonner";
import { buildWorkspaceCapabilities } from "@/lib/workspacePermissions";
import { useRuntime } from "@/contexts/RuntimeContext";
import { resolveAssetUrl } from "@/lib/assetUrls";

export default function MemberSidebar({ members, roles, serverId, server, user, onStartDM, onRefreshMembers }) {
  const { t } = useTranslation();
  const { config } = useRuntime();
  const onlineMembers = members.filter(m => m.user?.status === "online");
  const offlineMembers = members.filter(m => m.user?.status !== "online");
  const capabilities = buildWorkspaceCapabilities({ user, server, members, roles });

  const getRoleColor = (member) => {
    if (!member.roles?.length || !roles?.length) return "#A1A1AA";
    for (const rid of member.roles) {
      const role = roles.find(r => r.id === rid);
      if (role) return role.color;
    }
    return "#A1A1AA";
  };

  const isOwnerOrAdmin = (member) => {
    return server?.owner_id === member.user?.id || member.user?.role === "admin" || member.roles?.some(rid => {
      const r = roles?.find(role => role.id === rid);
      return r?.permissions?.manage_server;
    });
  };

  const handleKick = async (userId) => {
    try {
      await api.delete(`/servers/${serverId}/members/${userId}`);
      toast.success(t("memberList.kicked"));
      onRefreshMembers();
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail));
    }
  };

  const handleBan = async (userId) => {
    try {
      await api.post(`/servers/${serverId}/moderation/ban`, {
        user_id: userId,
        reason: t("serverSettings.defaultBanReason"),
      });
      toast.success(t("memberList.banned"));
      onRefreshMembers();
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail));
    }
  };

  const handleMute = async (userId) => {
    try {
      await api.post(`/servers/${serverId}/moderation/mute`, { user_id: userId, duration_minutes: 10 });
      toast.success(t("memberList.muted"));
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail));
    }
  };

  const MemberItem = ({ member }) => {
    const isOnline = member.user?.status === "online";
    const isSelf = member.user?.id === user?.id;
    const isAdmin = isOwnerOrAdmin(member);
    const isServerOwner = server?.owner_id === member.user?.id;
    const canModerate = capabilities.canMuteMembers || capabilities.canKickMembers || capabilities.canBanMembers;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-white/5 transition-colors text-left group"
            data-testid={`member-${member.user?.username}`}
          >
            <div className="relative">
              <div className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-xs font-bold ${
                isOnline ? 'bg-zinc-800/85' : 'bg-zinc-800/45'
              }`} style={{ color: getRoleColor(member) }}>
                {member.user?.avatar_url ? (
                  <img src={resolveAssetUrl(member.user.avatar_url, config?.assetBase)} alt={member.user?.display_name || member.user?.username || "avatar"} className="h-full w-full object-cover" />
                ) : (
                  member.user?.display_name?.[0]?.toUpperCase() || '?'
                )}
              </div>
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#121212] ${
                isOnline ? 'status-online' : 'status-offline'
              }`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className={`text-sm truncate ${isOnline ? 'text-white' : 'text-[#71717A]'}`}
                  style={{ color: isOnline ? getRoleColor(member) : undefined }}>
                  {member.user?.display_name || member.user?.username}
                </span>
                {isAdmin && <Crown size={12} weight="fill" className="text-[#F59E0B] shrink-0" />}
              </div>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="workspace-panel-solid text-white w-48">
          <div className="px-3 py-2 border-b border-[#27272A]">
            <p className="text-sm font-semibold" style={{ color: getRoleColor(member) }}>
              {member.user?.display_name}
            </p>
            <p className="text-xs text-[#71717A]">@{member.user?.username}</p>
          </div>
          {!isSelf && (
            <>
                <DropdownMenuItem onClick={() => onStartDM(member.user)} className="cursor-pointer text-[#A1A1AA] focus:text-white focus:bg-[#27272A]"
                  data-testid={`dm-member-${member.user?.username}`}>
                <ChatCircle size={16} className="mr-2" /> {t("memberList.message")}
              </DropdownMenuItem>
              {canModerate && <DropdownMenuSeparator className="bg-[#27272A]" />}
              {capabilities.canMuteMembers && (
                <DropdownMenuItem onClick={() => handleMute(member.user?.id)} className="cursor-pointer text-[#F59E0B] focus:text-[#F59E0B] focus:bg-[#27272A]"
                  data-testid={`mute-member-${member.user?.username}`}>
                  <Timer size={16} className="mr-2" /> {t("memberList.mute")}
                </DropdownMenuItem>
              )}
              {capabilities.canKickMembers && !isServerOwner && (
                <DropdownMenuItem onClick={() => handleKick(member.user?.id)} className="cursor-pointer text-[#EF4444] focus:text-[#EF4444] focus:bg-[#27272A]"
                  data-testid={`kick-member-${member.user?.username}`}>
                  <UserMinus size={16} className="mr-2" /> {t("memberList.kick")}
                </DropdownMenuItem>
              )}
              {capabilities.canBanMembers && !isServerOwner && (
                <DropdownMenuItem onClick={() => handleBan(member.user?.id)} className="cursor-pointer text-[#EF4444] focus:text-[#EF4444] focus:bg-[#27272A]"
                  data-testid={`ban-member-${member.user?.username}`}>
                  <Prohibit size={16} className="mr-2" /> {t("memberList.ban")}
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div className="workspace-panel w-[240px] h-full min-h-0 flex flex-col shrink-0 overflow-hidden" data-testid="member-sidebar">
      <div className="h-14 flex items-center px-4 border-b workspace-divider bg-zinc-900/25 shrink-0">
        <h3 className="text-sm font-bold text-white" style={{ fontFamily: "Manrope" }}>
          {t("server.members")}
        </h3>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-4 px-3">
        {onlineMembers.length > 0 && (
          <>
            <p className="workspace-section-label px-2 mb-2">
              {t("memberList.online")} &mdash; {onlineMembers.length}
            </p>
            {onlineMembers.map(m => <MemberItem key={m.user_id} member={m} />)}
          </>
        )}
        {offlineMembers.length > 0 && (
          <>
            <p className="workspace-section-label px-2 mb-2 mt-5">
              {t("memberList.offline")} &mdash; {offlineMembers.length}
            </p>
            {offlineMembers.map(m => <MemberItem key={m.user_id} member={m} />)}
          </>
        )}
      </div>
    </div>
  );
}
