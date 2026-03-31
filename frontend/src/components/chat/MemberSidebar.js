import { Crown, ChatCircle, UserMinus, Prohibit, Timer } from "@phosphor-icons/react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import api, { formatError } from "@/lib/api";
import { toast } from "sonner";
import { buildWorkspaceCapabilities } from "@/lib/workspacePermissions";

export default function MemberSidebar({ members, roles, serverId, server, user, onStartDM, onRefreshMembers }) {
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
    return member.user?.role === "admin" || member.roles?.some(rid => {
      const r = roles?.find(role => role.id === rid);
      return r?.permissions?.manage_server;
    });
  };

  const handleKick = async (userId) => {
    try {
      await api.delete(`/servers/${serverId}/members/${userId}`);
      toast.success("Member kicked");
      onRefreshMembers();
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail));
    }
  };

  const handleBan = async (userId) => {
    try {
      await api.post(`/servers/${serverId}/moderation/ban`, { user_id: userId, reason: "Banned by admin" });
      toast.success("Member banned");
      onRefreshMembers();
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail));
    }
  };

  const handleMute = async (userId) => {
    try {
      await api.post(`/servers/${serverId}/moderation/mute`, { user_id: userId, duration_minutes: 10 });
      toast.success("Member muted for 10 minutes");
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail));
    }
  };

  const MemberItem = ({ member }) => {
    const isOnline = member.user?.status === "online";
    const isSelf = member.user?.id === user?.id;
    const isAdmin = isOwnerOrAdmin(member);
    const canModerate = capabilities.canMuteMembers || capabilities.canKickMembers || capabilities.canBanMembers;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="w-full flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-[#27272A]/50 transition-colors text-left group"
            data-testid={`member-${member.user?.username}`}
          >
            <div className="relative">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                isOnline ? 'bg-[#27272A]' : 'bg-[#27272A]/50'
              }`} style={{ color: getRoleColor(member) }}>
                {member.user?.display_name?.[0]?.toUpperCase() || '?'}
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
        <DropdownMenuContent className="bg-[#18181B] border-[#27272A] text-white w-48">
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
                <ChatCircle size={16} className="mr-2" /> Message
              </DropdownMenuItem>
              {canModerate && <DropdownMenuSeparator className="bg-[#27272A]" />}
              {capabilities.canMuteMembers && (
                <DropdownMenuItem onClick={() => handleMute(member.user?.id)} className="cursor-pointer text-[#F59E0B] focus:text-[#F59E0B] focus:bg-[#27272A]"
                  data-testid={`mute-member-${member.user?.username}`}>
                  <Timer size={16} className="mr-2" /> Mute (10 min)
                </DropdownMenuItem>
              )}
              {capabilities.canKickMembers && (
                <DropdownMenuItem onClick={() => handleKick(member.user?.id)} className="cursor-pointer text-[#EF4444] focus:text-[#EF4444] focus:bg-[#27272A]"
                  data-testid={`kick-member-${member.user?.username}`}>
                  <UserMinus size={16} className="mr-2" /> Kick
                </DropdownMenuItem>
              )}
              {capabilities.canBanMembers && (
                <DropdownMenuItem onClick={() => handleBan(member.user?.id)} className="cursor-pointer text-[#EF4444] focus:text-[#EF4444] focus:bg-[#27272A]"
                  data-testid={`ban-member-${member.user?.username}`}>
                  <Prohibit size={16} className="mr-2" /> Ban
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <div className="w-[240px] h-full min-h-0 bg-[#18181B] border-l border-[#27272A]/40 flex flex-col shrink-0" data-testid="member-sidebar">
      <div className="h-12 flex items-center px-4 border-b border-[#27272A] shrink-0">
        <h3 className="text-sm font-bold text-white" style={{ fontFamily: "Manrope" }}>
          Members
        </h3>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto py-4 px-2">
        {onlineMembers.length > 0 && (
          <>
            <p className="text-[#71717A] text-xs font-bold uppercase tracking-[0.2em] px-2 mb-2">
              Online &mdash; {onlineMembers.length}
            </p>
            {onlineMembers.map(m => <MemberItem key={m.user_id} member={m} />)}
          </>
        )}
        {offlineMembers.length > 0 && (
          <>
            <p className="text-[#71717A] text-xs font-bold uppercase tracking-[0.2em] px-2 mb-2 mt-4">
              Offline &mdash; {offlineMembers.length}
            </p>
            {offlineMembers.map(m => <MemberItem key={m.user_id} member={m} />)}
          </>
        )}
      </div>
    </div>
  );
}
