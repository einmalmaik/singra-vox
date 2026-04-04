import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  ClipboardText,
  CaretDown,
  CaretRight,
  Folder,
  GearSix,
  Hash,
  Microphone,
  Plus,
  Shield,
  Trash,
  UserMinus,
  UserPlus,
  UsersThree,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import SettingsOverlayShell from "@/components/settings/SettingsOverlayShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  buildChannelOrganization,
  computeChannelReorderPayload,
  getContainerDropId,
  parseContainerDropId,
  ROOT_CHANNEL_CONTAINER_ID,
} from "@/lib/channelOrganization";
import { buildServerCapabilities } from "@/lib/serverPermissions";
import SortableChannelItem from "@/components/channels/SortableChannelItem";
import ChannelContainerDropZone from "@/components/channels/ChannelContainerDropZone";
import InviteGeneratorPanel from "@/components/invites/InviteGeneratorPanel";

const SECTION_CONFIG = [
  { id: "general", icon: <GearSix size={16} /> },
  { id: "channels", icon: <Hash size={16} /> },
  { id: "roles", icon: <Shield size={16} /> },
  { id: "members", icon: <UsersThree size={16} /> },
  { id: "invites", icon: <UserPlus size={16} /> },
  { id: "audit", icon: <ClipboardText size={16} /> },
];

export default function ServerSettingsOverlay({
  open,
  onClose,
  server,
  channels,
  members,
  roles,
  user,
  viewerContext,
  onRefreshServers,
}) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState("general");
  const [serverName, setServerName] = useState(server?.name || "");
  const [serverDescription, setServerDescription] = useState(server?.description || "");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#6366F1");
  const [newRoleMentionable, setNewRoleMentionable] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [bannedMembers, setBannedMembers] = useState([]);
  const [newChannelType, setNewChannelType] = useState("text");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelParentId, setNewChannelParentId] = useState("__root__");
  const [activeDragId, setActiveDragId] = useState(null);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [channelDraft, setChannelDraft] = useState({ name: "", topic: "", is_private: false, parent_id: "__root__", type: "text" });
  const [roleDraft, setRoleDraft] = useState({ name: "", color: "#6366F1", permissions: {}, mentionable: false });
  const [ownershipTargetId, setOwnershipTargetId] = useState("");
  const [transferringOwnership, setTransferringOwnership] = useState(false);
  const [leavingServer, setLeavingServer] = useState(false);
  const capabilities = useMemo(
    () => buildServerCapabilities({ user, server, viewerContext }),
    [server, user, viewerContext],
  );
  const channelOrganization = useMemo(
    () => buildChannelOrganization(channels || []),
    [channels],
  );
  const categoryChannels = useMemo(
    () => channelOrganization.topLevelItems.filter((channel) => channel.type === "category"),
    [channelOrganization],
  );
  const activeDragChannel = activeDragId ? channelOrganization.byId[activeDragId] : null;
  const isDraggingChannel = Boolean(activeDragChannel);
  const canDropIntoCategory = activeDragChannel?.type && activeDragChannel.type !== "category";
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
  );

  const loadAudit = useCallback(async () => {
    try {
      const res = await api.get(`/servers/${server.id}/moderation/audit-log`);
      setAuditLogs(res.data);
    } catch {
      setAuditLogs([]);
    }
  }, [server?.id]);

  const loadBans = useCallback(async () => {
    try {
      const res = await api.get(`/servers/${server.id}/moderation/bans`);
      setBannedMembers(res.data);
    } catch {
      setBannedMembers([]);
    }
  }, [server?.id]);

  const selectedChannel = useMemo(
    () => channels?.find((channel) => channel.id === selectedChannelId) || channels?.[0] || null,
    [channels, selectedChannelId],
  );
  const selectedRole = useMemo(
    () => roles?.find((role) => role.id === selectedRoleId) || roles?.[0] || null,
    [roles, selectedRoleId],
  );

  useEffect(() => {
    setServerName(server?.name || "");
    setServerDescription(server?.description || "");
  }, [server]);

  useEffect(() => {
    if (!selectedChannelId && channels?.length) {
      setSelectedChannelId(channels[0].id);
    } else if (selectedChannelId && !channels?.some((channel) => channel.id === selectedChannelId)) {
      setSelectedChannelId(channels?.[0]?.id || "");
    }
  }, [channels, selectedChannelId]);

  useEffect(() => {
    if (!selectedRoleId && roles?.length) {
      setSelectedRoleId(roles[0].id);
    } else if (selectedRoleId && !roles?.some((role) => role.id === selectedRoleId)) {
      setSelectedRoleId(roles?.[0]?.id || "");
    }
  }, [roles, selectedRoleId]);

  useEffect(() => {
    if (!selectedChannel) {
      setChannelDraft({ name: "", topic: "", is_private: false, parent_id: "__root__", type: "text" });
      return;
    }

    setChannelDraft({
      name: selectedChannel.name || "",
      topic: selectedChannel.topic || "",
      is_private: !!selectedChannel.is_private,
      parent_id: selectedChannel.parent_id || "__root__",
      type: selectedChannel.type || "text",
    });
  }, [selectedChannel]);

  useEffect(() => {
    if (!selectedRole) {
      setRoleDraft({ name: "", color: "#6366F1", permissions: {}, mentionable: false });
      return;
    }

    setRoleDraft({
      name: selectedRole.name || "",
      color: selectedRole.color || "#6366F1",
      permissions: { ...(selectedRole.permissions || {}) },
      mentionable: !!selectedRole.mentionable,
    });
  }, [selectedRole]);

  useEffect(() => {
    if (!open || activeSection !== "audit" || !server?.id) return;
    void loadAudit();
  }, [activeSection, loadAudit, open, server?.id]);

  useEffect(() => {
    if (!open || activeSection !== "members" || !server?.id) return;
    void loadBans();
  }, [activeSection, loadBans, open, server?.id]);

  useEffect(() => {
    if (!open) return;
    setOwnershipTargetId("");
  }, [open, server?.id]);

  const isServerOwner = server?.owner_id === user?.id;
  const transferCandidates = useMemo(
    () => (members || []).filter((member) => member.user_id !== user?.id),
    [members, user?.id],
  );
  const sectionConfig = useMemo(() => ([
    { ...SECTION_CONFIG[0], label: t("server.general") },
    { ...SECTION_CONFIG[1], label: t("server.channels") },
    { ...SECTION_CONFIG[2], label: t("server.roles") },
    { ...SECTION_CONFIG[3], label: t("server.members") },
    { ...SECTION_CONFIG[4], label: t("server.invites") },
    { ...SECTION_CONFIG[5], label: t("server.audit") },
  ]), [t]);
  const permissionLabels = useMemo(() => ({
    manage_server: t("permissions.manageServer"),
    manage_channels: t("permissions.manageChannels"),
    manage_roles: t("permissions.manageRoles"),
    manage_members: t("permissions.manageMembers"),
    kick_members: t("permissions.kickMembers"),
    ban_members: t("permissions.banMembers"),
    view_channels: t("permissions.viewChannels"),
    read_messages: t("permissions.readMessages"),
    read_message_history: t("permissions.readMessageHistory"),
    send_messages: t("permissions.sendMessages"),
    attach_files: t("permissions.attachFiles"),
    pin_messages: t("permissions.pinMessages"),
    manage_messages: t("permissions.manageMessages"),
    mention_everyone: t("permissions.mentionEveryone"),
    create_invites: t("permissions.createInvites"),
    join_voice: t("permissions.joinVoice"),
    speak: t("permissions.speak"),
    stream: t("permissions.stream"),
    mute_members: t("permissions.muteMembers"),
    deafen_members: t("permissions.deafenMembers"),
    priority_speaker: t("permissions.prioritySpeaker"),
  }), [t]);

  const saveGeneral = async () => {
    try {
      await api.put(`/servers/${server.id}`, {
        name: serverName,
        description: serverDescription,
      });
      toast.success(t("serverSettings.updated"));
    } catch {
      toast.error(t("serverSettings.updateFailed"));
    }
  };

  const saveChannel = async () => {
    if (!selectedChannel) return;
    try {
      await api.put(`/channels/${selectedChannel.id}`, {
        name: channelDraft.name,
        topic: channelDraft.topic || "",
        is_private: !!channelDraft.is_private,
        parent_id: channelDraft.type === "category" ? null : (channelDraft.parent_id === "__root__" ? null : channelDraft.parent_id),
      });
      toast.success(t("serverSettings.channelUpdated"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelUpdateFailed" }));
    }
  };

  const deleteChannel = async () => {
    if (!selectedChannel) return;
    try {
      await api.delete(`/channels/${selectedChannel.id}`);
      toast.success(t("serverSettings.channelDeleted"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelDeleteFailed" }));
    }
  };

  const createChannel = async () => {
    if (!newChannelName.trim()) return;
    try {
      const res = await api.post(`/servers/${server.id}/channels`, {
        name: newChannelName.trim(),
        type: newChannelType,
        parent_id: newChannelType === "category" ? null : (newChannelParentId === "__root__" ? null : newChannelParentId),
      });
      setNewChannelName("");
      setNewChannelType("text");
      setNewChannelParentId("__root__");
      setSelectedChannelId(res.data.id);
      toast.success(newChannelType === "category" ? t("serverSettings.categoryCreated") : t("serverSettings.channelCreated"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelCreateFailed" }));
    }
  };

  const prepareChannelCreate = (type, parentId = "__root__") => {
    setNewChannelType(type);
    setNewChannelParentId(type === "category" ? "__root__" : parentId);
    setNewChannelName("");
  };

  const reorderChannels = useCallback(async (items) => {
    if (!items?.length) {
      return;
    }
    await api.put(`/servers/${server.id}/channels/reorder`, { items });
  }, [server?.id]);

  const collisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }
    return rectIntersection(args);
  }, []);

  const handleChannelDragStart = useCallback((event) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleChannelDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);

  const handleChannelDragEnd = useCallback(async (event) => {
    setActiveDragId(null);

    const activeId = String(event.active?.id || "");
    const rawOverId = event.over?.id;
    if (!activeId || !rawOverId) {
      return;
    }

    const overId = String(rawOverId);
    const overContainerId = parseContainerDropId(overId);
    const items = computeChannelReorderPayload({
      channels,
      activeId,
      overId: overContainerId ? null : overId,
      overContainerId,
    });

    if (!items.length) {
      return;
    }

    try {
      await reorderChannels(items);
      toast.success(t("serverSettings.channelOrderUpdated"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelReorderFailed" }));
    }
  }, [channels, reorderChannels, t]);

  const renameChannelQuick = async (channel) => {
    const nextName = window.prompt(
      channel.type === "category" ? t("serverSettings.renameCategoryPrompt") : t("serverSettings.renameChannelPrompt"),
      channel.name,
    );
    if (!nextName || nextName.trim() === channel.name) return;
    try {
      await api.put(`/channels/${channel.id}`, { name: nextName.trim() });
      toast.success(channel.type === "category" ? t("serverSettings.categoryRenamed") : t("serverSettings.channelRenamed"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelRenameFailed" }));
    }
  };

  const deleteChannelQuick = async (channel) => {
    const confirmed = window.confirm(
      channel.type === "category"
        ? t("serverSettings.deleteCategoryConfirm", { name: channel.name })
        : t("serverSettings.deleteChannelConfirm", { name: channel.name }),
    );
    if (!confirmed) return;
    try {
      await api.delete(`/channels/${channel.id}`);
      toast.success(channel.type === "category" ? t("serverSettings.categoryDeleted") : t("serverSettings.channelDeleted"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelDeleteFailed" }));
    }
  };

  const moveChannelToRoot = useCallback(async (channelId) => {
    const items = computeChannelReorderPayload({
      channels,
      activeId: channelId,
      overContainerId: ROOT_CHANNEL_CONTAINER_ID,
    });
    if (!items.length) {
      return;
    }
    try {
      await reorderChannels(items);
      toast.success(t("serverSettings.movedToTopLevel"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelReorderFailed" }));
    }
  }, [channels, reorderChannels, t]);

  const renderChannelTreeRow = (channel, { nested = false } = {}) => {
    const isCategory = channel.type === "category";
    const isCollapsed = Boolean(collapsedCategories[channel.id]);
    return (
      <ContextMenu key={channel.id}>
        <SortableChannelItem
          id={channel.id}
          disabled={false}
          data={{
            itemType: channel.type,
            containerId: isCategory ? ROOT_CHANNEL_CONTAINER_ID : (channel.parent_id || ROOT_CHANNEL_CONTAINER_ID),
          }}
        >
          {({ setNodeRef, attributes, listeners, isDragging, isOver, style }) => (
            <ContextMenuTrigger asChild>
              <button
                ref={setNodeRef}
                type="button"
                {...attributes}
                {...listeners}
                style={style}
                onClick={() => {
                  setSelectedChannelId(channel.id);
                  if (isCategory) {
                    setCollapsedCategories((previous) => ({
                      ...previous,
                      [channel.id]: !previous[channel.id],
                    }));
                  }
                }}
                className={`flex ${nested ? "ml-4 w-[calc(100%-1rem)]" : "w-full"} items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors touch-none ${
                  selectedChannel?.id === channel.id ? "bg-[#27272A] text-white" : "text-[#A1A1AA] hover:bg-[#1A1A1A] hover:text-white"
                } ${isOver ? "ring-1 ring-[#6366F1] bg-[#18181B]" : ""} ${isDragging ? "opacity-60" : ""}`}
              >
                {isCategory ? (
                  <>
                    {isCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
                    <Folder size={14} />
                  </>
                ) : channel.type === "voice" ? (
                  <Microphone size={14} />
                ) : (
                  <Hash size={14} />
                )}
                <span>{channel.name}</span>
              </button>
            </ContextMenuTrigger>
          )}
        </SortableChannelItem>
        <ContextMenuContent className="w-52 border-[#27272A] bg-[#18181B] text-white">
          {isCategory ? (
            <>
              <ContextMenuItem onClick={() => prepareChannelCreate("text", channel.id)}>{t("serverSettings.createTextChannel")}</ContextMenuItem>
              <ContextMenuItem onClick={() => prepareChannelCreate("voice", channel.id)}>{t("serverSettings.createVoiceChannel")}</ContextMenuItem>
              <ContextMenuItem onClick={() => renameChannelQuick(channel)}>{t("serverSettings.renameCategoryAction")}</ContextMenuItem>
              <ContextMenuItem className="text-[#EF4444]" onClick={() => deleteChannelQuick(channel)}>{t("serverSettings.deleteCategoryAction")}</ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem onClick={() => renameChannelQuick(channel)}>{t("serverSettings.renameChannelAction")}</ContextMenuItem>
              {channel.parent_id && (
                <ContextMenuItem onClick={() => { void moveChannelToRoot(channel.id); }}>
                  {t("serverSettings.moveToRoot")}
                </ContextMenuItem>
              )}
              <ContextMenuItem className="text-[#EF4444]" onClick={() => deleteChannelQuick(channel)}>{t("serverSettings.deleteChannelAction")}</ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const renderCategoryTreeBlock = (category) => {
    const childIds = channelOrganization.childIdsByCategory[category.id] || [];
    const isCollapsed = Boolean(collapsedCategories[category.id]);

    return (
      <div key={category.id} className="space-y-1 rounded-lg border border-[#27272A] bg-[#101113] p-1.5">
        {renderChannelTreeRow(category)}
        {!isCollapsed && (
          <div className="space-y-1 border-t border-[#27272A] pt-1">
            {/* Categories expose an explicit container drop zone so dropping a
                channel "into" a category is distinct from reordering the
                category itself at the top level. */}
            {canDropIntoCategory && (
              <ChannelContainerDropZone
                id={getContainerDropId(category.id)}
                data={{ containerId: category.id }}
              >
                {({ setNodeRef, isOver }) => (
                  <div
                    ref={setNodeRef}
                    className={`ml-4 rounded-md border border-dashed px-3 py-2 text-[11px] transition-colors ${
                      isOver
                        ? "border-[#6366F1] bg-[#18181B] text-[#A5B4FC]"
                        : "border-[#27272A] bg-[#111113] text-[#71717A]"
                    }`}
                  >
                    {t("serverSettings.dropIntoCategory", { name: category.name })}
                  </div>
                )}
              </ChannelContainerDropZone>
            )}
            <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
              {childIds.map((childId) => {
                const childChannel = channelOrganization.byId[childId];
                if (!childChannel) {
                  return null;
                }
                return renderChannelTreeRow(childChannel, { nested: true });
              })}
            </SortableContext>
            {!childIds.length && !canDropIntoCategory && (
              <div className="ml-4 px-3 py-1 text-[11px] text-[#52525B]">{t("channel.noChannelsYet")}</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const createRole = async () => {
    if (!newRoleName.trim()) return;
    try {
      const res = await api.post(`/servers/${server.id}/roles`, {
        name: newRoleName.trim(),
        color: newRoleColor,
        mentionable: newRoleMentionable,
      });
      setNewRoleName("");
      setNewRoleMentionable(false);
      setSelectedRoleId(res.data.id);
      toast.success(t("serverSettings.roleCreated"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.roleCreateFailed" }));
    }
  };

  const saveRole = async () => {
    if (!selectedRole) return;
    try {
      const payload = selectedRole.is_default
        ? { permissions: roleDraft.permissions }
        : {
            name: roleDraft.name,
            color: roleDraft.color,
            permissions: roleDraft.permissions,
            mentionable: roleDraft.mentionable,
          };
      await api.put(`/servers/${server.id}/roles/${selectedRole.id}`, payload);
      toast.success(t("serverSettings.roleUpdated"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.roleUpdateFailed" }));
    }
  };

  const togglePermission = async (permissionKey) => {
    setRoleDraft((previous) => ({
      ...previous,
      permissions: {
        ...previous.permissions,
        [permissionKey]: !previous.permissions?.[permissionKey],
      },
    }));
  };

  const deleteRole = async () => {
    if (!selectedRole || selectedRole.is_default) return;
    try {
      await api.delete(`/servers/${server.id}/roles/${selectedRole.id}`);
      toast.success(t("serverSettings.roleDeleted"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.roleDeleteFailed" }));
    }
  };

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
      if (action === "kick") {
        await api.delete(`/servers/${server.id}/members/${memberId}`);
      } else if (action === "ban") {
        await api.post(`/servers/${server.id}/moderation/ban`, {
          user_id: memberId,
          reason: t("serverSettings.defaultBanReason"),
        });
      } else if (action === "unban") {
        await api.post(`/servers/${server.id}/moderation/unban`, { user_id: memberId });
      } else if (action === "mute") {
        await api.post(`/servers/${server.id}/moderation/mute`, { user_id: memberId, duration_minutes: 10 });
      }
      toast.success(
        action === "mute"
          ? t("serverSettings.memberMuted")
          : action === "kick"
            ? t("serverSettings.memberKicked")
            : action === "unban"
              ? t("serverSettings.memberUnbanned")
              : t("serverSettings.memberBanned"),
      );
      if (action === "unban") {
        await loadBans();
      } else if (action === "ban") {
        await loadBans();
      }
    } catch (error) {
      const actionLabel = {
        mute: t("memberList.mute"),
        kick: t("memberList.kick"),
        ban: t("memberList.ban"),
        unban: t("server.unban"),
      }[action] || action;
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.memberActionFailed", fallbackParams: { action: actionLabel } }));
    }
  };

  const handleTransferOwnership = async () => {
    if (!ownershipTargetId) {
      toast.error(t("serverSettings.transferSelectFirst"));
      return;
    }

    const confirmed = window.confirm(t("serverSettings.transferConfirm"));
    if (!confirmed) {
      return;
    }

    setTransferringOwnership(true);
    try {
      await api.post(`/servers/${server.id}/ownership/transfer`, { user_id: ownershipTargetId });
      toast.success(t("serverSettings.transferSuccess"));
      await onRefreshServers?.();
      onClose?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.transferFailed" }));
    } finally {
      setTransferringOwnership(false);
    }
  };

  const handleLeaveServer = async () => {
    if (isServerOwner) {
      toast.error(t("serverSettings.leaveOwnerGuard"));
      return;
    }
    const confirmed = window.confirm(
      t("serverSettings.leaveConfirm", { name: server.name }),
    );
    if (!confirmed) {
      return;
    }

    setLeavingServer(true);
    try {
      await api.post(`/servers/${server.id}/leave`);
      toast.success(t("serverSettings.leaveSuccess"));
      await onRefreshServers?.();
      onClose?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.leaveFailed" }));
    } finally {
      setLeavingServer(false);
    }
  };

  if (!server) return null;

  return (
    <SettingsOverlayShell
      open={open}
      title={t("server.settingsTitle", { name: server.name })}
      sections={sectionConfig}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      onClose={onClose}
      data-testid="server-settings-overlay"
    >
      {activeSection === "general" && (
        <div className="space-y-6" data-testid="server-settings-general">
          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
            <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("server.general")}</h3>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("server.serverName")}</Label>
                <Input data-testid="server-name-input" value={serverName} onChange={(event) => setServerName(event.target.value)} className="bg-[#0A0A0A] border-[#27272A] text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("serverSettings.descriptionLabel")}</Label>
                <Input data-testid="server-description-input" value={serverDescription} onChange={(event) => setServerDescription(event.target.value)} className="bg-[#0A0A0A] border-[#27272A] text-white" />
              </div>
            </div>
            <Button data-testid="server-save-general-btn" onClick={saveGeneral} className="mt-5 bg-cyan-400 text-zinc-950 hover:bg-cyan-300">{t("serverSettings.saveChanges")}</Button>
          </section>

          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("server.ownership")}</h3>
                <p className="mt-1 text-sm text-[#71717A]">
                  {t("serverSettings.ownershipBanner")}
                </p>
              </div>
              <div className="rounded-full border border-[#27272A] bg-[#0A0A0A] px-3 py-1 text-xs uppercase tracking-[0.2em] text-[#A1A1AA]">
                {isServerOwner ? t("server.owner") : t("server.ownership")}
              </div>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("server.transferOwnership")}</Label>
                <select
                  value={ownershipTargetId}
                  onChange={(event) => setOwnershipTargetId(event.target.value)}
                  disabled={!isServerOwner || transferCandidates.length === 0}
                  className="h-10 w-full rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white disabled:opacity-50"
                >
                  <option value="">{t("serverSettings.selectMember")}</option>
                  {transferCandidates.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.user?.display_name || member.user?.username}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-[#71717A]">
                  {isServerOwner
                    ? t("serverSettings.ownershipHelpOwner")
                    : t("serverSettings.ownershipHelpMember")}
                </p>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={handleTransferOwnership}
                  disabled={!isServerOwner || !ownershipTargetId || transferringOwnership}
                  className="w-full bg-cyan-400 text-zinc-950 hover:bg-cyan-300"
                >
                  {transferringOwnership ? t("serverSettings.transferring") : t("server.transferOwnership")}
                </Button>
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-[#EF4444]/20 bg-[#0A0A0A] px-4 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-medium text-white">{t("server.leaveServer")}</p>
                  <p className="mt-1 text-xs text-[#71717A]">
                    {isServerOwner
                      ? t("serverSettings.leaveOwnerHelp")
                      : t("serverSettings.leaveMemberHelp")}
                  </p>
                </div>
                <Button
                  onClick={handleLeaveServer}
                  disabled={leavingServer}
                  variant="outline"
                  className="border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10"
                >
                  {leavingServer ? t("serverSettings.leaving") : t("server.leaveServer")}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}

      {activeSection === "channels" && (
        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-4">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("serverSettings.channelsPanelTitle")}</p>
              <Button size="sm" variant="outline" onClick={createChannel} className="border-[#27272A] bg-[#0A0A0A] text-white hover:bg-[#1A1A1A]">
                <Plus size={14} className="mr-2" />
                {t("common.create")}
              </Button>
            </div>
            <div className="space-y-3">
              <div className="grid gap-2">
                <Input
                  value={newChannelName}
                  onChange={(event) => setNewChannelName(event.target.value)}
                  placeholder={t("serverSettings.createChannelPlaceholder")}
                  className="bg-[#0A0A0A] border-[#27272A] text-white"
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <select value={newChannelType} onChange={(event) => setNewChannelType(event.target.value)} className="h-10 rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white">
                    <option value="text">{t("serverSettings.channelTypeText")}</option>
                    <option value="voice">{t("serverSettings.channelTypeVoice")}</option>
                    <option value="category">{t("serverSettings.channelTypeCategory")}</option>
                  </select>
                  <select
                    value={newChannelParentId}
                    onChange={(event) => setNewChannelParentId(event.target.value)}
                    disabled={newChannelType === "category"}
                    className="h-10 rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white disabled:opacity-50"
                  >
                    <option value="__root__">{t("common.noCategory")}</option>
                    {categoryChannels.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={collisionDetection}
                onDragStart={handleChannelDragStart}
                onDragCancel={handleChannelDragCancel}
                onDragEnd={handleChannelDragEnd}
              >
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <div className="space-y-2 rounded-lg">
                      <SortableContext items={channelOrganization.rootIds} strategy={verticalListSortingStrategy}>
                        {channelOrganization.rootIds.map((channelId) => {
                          const channel = channelOrganization.byId[channelId];
                          if (!channel) {
                            return null;
                          }
                          if (channel.type === "category") {
                            return renderCategoryTreeBlock(channel);
                          }
                          return renderChannelTreeRow(channel);
                        })}
                      </SortableContext>
                      {isDraggingChannel && (
                        <ChannelContainerDropZone
                          id={getContainerDropId(ROOT_CHANNEL_CONTAINER_ID)}
                          data={{ containerId: ROOT_CHANNEL_CONTAINER_ID }}
                        >
                          {({ setNodeRef, isOver }) => (
                            <div
                              ref={setNodeRef}
                              className={`rounded-md border border-dashed px-3 py-2 text-[11px] transition-colors ${
                                isOver
                                  ? "border-[#6366F1] bg-[#18181B] text-[#A5B4FC]"
                                  : "border-[#27272A] bg-[#111113] text-[#71717A]"
                              }`}
                            >
                              {t("serverSettings.dropToTopLevel")}
                            </div>
                          )}
                        </ChannelContainerDropZone>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-52 border-[#27272A] bg-[#18181B] text-white">
                    <ContextMenuItem onClick={() => prepareChannelCreate("category")}>{t("serverSettings.createCategory")}</ContextMenuItem>
                    <ContextMenuItem onClick={() => prepareChannelCreate("text")}>{t("serverSettings.createTextChannel")}</ContextMenuItem>
                    <ContextMenuItem onClick={() => prepareChannelCreate("voice")}>{t("serverSettings.createVoiceChannel")}</ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>

                <DragOverlay>
                  {activeDragChannel ? (
                    <div
                      className="flex items-center gap-2 rounded-md border border-[#6366F1] bg-[#18181B] px-3 py-2 text-sm text-white shadow-2xl"
                      style={{ transform: "translateY(-14px)" }}
                    >
                      {activeDragChannel.type === "category" ? (
                        <Folder size={14} className="text-[#A5B4FC]" />
                      ) : activeDragChannel.type === "voice" ? (
                        <Microphone size={14} className="text-[#A5B4FC]" />
                      ) : (
                        <Hash size={14} className="text-[#A5B4FC]" />
                      )}
                      <span>{activeDragChannel.name}</span>
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
            </div>
          </section>

          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-6">
            {selectedChannel ? (
              <>
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("serverSettings.editChannel")}</h3>
                    <p className="mt-1 text-sm text-[#71717A]">
                      {t("serverSettings.editChannelHelp")}
                    </p>
                  </div>
                  <div className="rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 py-2 text-xs uppercase tracking-[0.2em] text-[#71717A]">
                    {t("serverSettings.dragDrop")}
                  </div>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("common.name")}</Label>
                    <Input
                      value={channelDraft.name}
                      onChange={(event) => setChannelDraft((previous) => ({ ...previous, name: event.target.value }))}
                      className="bg-[#0A0A0A] border-[#27272A] text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("serverSettings.topicLabel")}</Label>
                    <Input
                      value={channelDraft.topic}
                      onChange={(event) => setChannelDraft((previous) => ({ ...previous, topic: event.target.value }))}
                      disabled={channelDraft.type === "category"}
                      className="bg-[#0A0A0A] border-[#27272A] text-white"
                    />
                  </div>
                </div>
                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("common.type")}</Label>
                    <div className="h-10 flex items-center rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-[#A1A1AA]">
                      {channelDraft.type === "category" ? t("serverSettings.channelTypeCategory") : channelDraft.type === "voice" ? t("serverSettings.channelTypeVoice") : t("serverSettings.channelTypeText")}
                    </div>
                  </div>
                  {channelDraft.type !== "category" && (
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("common.category")}</Label>
                      <select
                        value={channelDraft.parent_id}
                        onChange={(event) => setChannelDraft((previous) => ({ ...previous, parent_id: event.target.value }))}
                        className="h-10 w-full rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white"
                      >
                        <option value="__root__">{t("common.noCategory")}</option>
                        {categoryChannels.map((category) => (
                          <option key={category.id} value={category.id}>{category.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="mt-5 flex items-center justify-between rounded-lg border border-[#27272A] bg-[#0A0A0A] px-4 py-3">
                  <div>
                    <p className="text-sm text-white">{t("serverSettings.privateChannel")}</p>
                    <p className="text-xs text-[#71717A]">{t("serverSettings.privateChannelHelp")}</p>
                  </div>
                  <Switch
                    checked={channelDraft.is_private}
                    disabled={channelDraft.type === "category"}
                    onCheckedChange={(checked) => setChannelDraft((previous) => ({ ...previous, is_private: checked }))}
                  />
                </div>
                <div className="mt-5 flex gap-2">
                  <Button onClick={saveChannel} className="bg-cyan-400 text-zinc-950 hover:bg-cyan-300">{t("serverSettings.saveChannel")}</Button>
                  <Button onClick={deleteChannel} variant="outline" className="border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10">
                    <Trash size={14} className="mr-2" />
                    {t("common.delete")}
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-[#71717A]">{t("serverSettings.noChannelSelected")}</p>
            )}
          </section>
        </div>
      )}

      {activeSection === "roles" && (
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]" data-testid="server-settings-roles">
          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-4">
            <div className="mb-4 flex gap-2">
              <Input
                data-testid="new-role-name-input"
                value={newRoleName}
                onChange={(event) => setNewRoleName(event.target.value)}
                placeholder={t("serverSettings.newRolePlaceholder")}
                className="bg-[#0A0A0A] border-[#27272A] text-white"
              />
              <input
                type="color"
                value={newRoleColor}
                onChange={(event) => setNewRoleColor(event.target.value)}
                className="h-10 w-10 rounded-md border border-[#27272A] bg-[#0A0A0A]"
              />
            </div>
            <div className="mb-4 flex items-center justify-between rounded-lg border border-[#27272A] bg-[#0A0A0A] px-3 py-2.5">
              <div>
                <p className="text-sm text-white">{t("serverSettings.allowRoleMentions")}</p>
                <p className="text-xs text-[#71717A]">{t("serverSettings.allowRoleMentionsHelp")}</p>
              </div>
              <Switch checked={newRoleMentionable} onCheckedChange={setNewRoleMentionable} />
            </div>
            <Button data-testid="create-role-btn" onClick={createRole} disabled={!newRoleName.trim()} className="mb-4 w-full bg-cyan-400 text-zinc-950 hover:bg-cyan-300">
              <Plus size={14} className="mr-2" />
              {t("common.create")} {t("server.roles")}
            </Button>

            <div className="space-y-1">
              {roles?.map((role) => (
                <button
                  key={role.id}
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    selectedRole?.id === role.id ? "bg-[#27272A] text-white" : "text-[#A1A1AA] hover:bg-[#1A1A1A] hover:text-white"
                  }`}
                >
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: role.color }} />
                  <span className="truncate">{role.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
            {selectedRole ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("serverSettings.roleEditor")}</h3>
                  {!selectedRole.is_default && (
                    <Button onClick={deleteRole} variant="outline" className="border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10">
                      <Trash size={14} className="mr-2" />
                      {t("common.delete")}
                    </Button>
                  )}
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <div className="space-y-2 md:col-span-2">
                    <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("server.roles")} {t("common.name")}</Label>
                    <Input
                      value={roleDraft.name}
                      onChange={(event) => setRoleDraft((previous) => ({ ...previous, name: event.target.value }))}
                      disabled={selectedRole.is_default}
                      className="bg-[#0A0A0A] border-[#27272A] text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("common.color")}</Label>
                    <input
                      type="color"
                      value={roleDraft.color}
                      onChange={(event) => setRoleDraft((previous) => ({ ...previous, color: event.target.value }))}
                      disabled={selectedRole.is_default}
                      className="h-10 w-full rounded-md border border-[#27272A] bg-[#0A0A0A]"
                    />
                  </div>
                </div>

                {selectedRole.is_default ? (
                  <div className="mt-4 rounded-lg border border-[#3F3F46] bg-[#0A0A0A] px-4 py-3">
                    <p className="text-sm text-white">{t("serverSettings.everyoneFixedTitle")}</p>
                    <p className="mt-1 text-xs text-[#71717A]">{t("serverSettings.everyoneFixedHelp")}</p>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center justify-between rounded-lg border border-[#27272A] bg-[#0A0A0A] px-4 py-3">
                    <div>
                      <p className="text-sm text-white">{t("serverSettings.allowRoleMentions")}</p>
                      <p className="text-xs text-[#71717A]">{t("serverSettings.allowRoleMentionsHelp")}</p>
                    </div>
                    <Switch
                      checked={!!roleDraft.mentionable}
                      onCheckedChange={(checked) => setRoleDraft((previous) => ({ ...previous, mentionable: checked }))}
                    />
                  </div>
                )}

                <Button data-testid="save-role-btn" onClick={saveRole} className="mt-5 bg-cyan-400 text-zinc-950 hover:bg-cyan-300">{t("serverSettings.saveRole")}</Button>

                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  {Object.entries(permissionLabels).map(([permissionKey, label]) => (
                    <div key={permissionKey} className="flex items-center justify-between rounded-lg border border-[#27272A] bg-[#0A0A0A] px-4 py-3">
                      <span className="text-sm text-white">{label}</span>
                      <Switch
                        checked={!!roleDraft.permissions?.[permissionKey]}
                        onCheckedChange={() => togglePermission(permissionKey)}
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-[#71717A]">{t("serverSettings.noRoleSelected")}</p>
            )}
          </section>
        </div>
      )}

      {activeSection === "members" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]" data-testid="server-settings-members">
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
                          {roles?.filter((role) => !role.is_default).map((role) => (
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
                                  <UserMinus size={14} className="mr-2" />
                                  {t("memberList.kick")}
                                </Button>
                              )}
                              {capabilities.canBanMembers && (
                                <Button onClick={() => moderateMember(member.user_id, "ban")} variant="outline" className="border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10">
                                  <Trash size={14} className="mr-2" />
                                  {t("memberList.ban")}
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
                          {member.ban_reason ? (
                            <p className="mt-2 text-xs text-[#A1A1AA]">{t("serverSettings.bannedReason", { reason: member.ban_reason })}</p>
                          ) : null}
                        </div>
                        <Button
                          onClick={() => moderateMember(member.user_id, "unban")}
                          className="bg-cyan-400 text-zinc-950 hover:bg-cyan-300"
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
      )}

        {activeSection === "invites" && (
          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
            <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("server.invites")}</h3>
            <p className="mt-1 text-sm text-[#71717A]">
              {t("serverSettings.invitesDescription")}
            </p>
            <div className="mt-5">
              <InviteGeneratorPanel serverId={server.id} />
            </div>
          </section>
        )}

      {activeSection === "audit" && (
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
                      <span className="font-semibold">{entry.actor?.display_name || t("common.system")}</span>
                      {" "}
                      <span className="text-[#A1A1AA]">{entry.action.replace(/_/g, " ")}</span>
                    </p>
                    <p className="mt-1 text-xs text-[#71717A]">{new Date(entry.created_at).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </section>
      )}
    </SettingsOverlayShell>
  );
}
