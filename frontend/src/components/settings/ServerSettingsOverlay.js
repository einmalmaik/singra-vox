import { useCallback, useEffect, useMemo, useState } from "react";
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
import api, { formatError } from "@/lib/api";
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
import SortableChannelItem from "@/components/channels/SortableChannelItem";
import ChannelContainerDropZone from "@/components/channels/ChannelContainerDropZone";
import InviteGeneratorPanel from "@/components/invites/InviteGeneratorPanel";

const SECTION_CONFIG = [
  { id: "general", label: "General", icon: <GearSix size={16} /> },
  { id: "channels", label: "Channels", icon: <Hash size={16} /> },
  { id: "roles", label: "Roles", icon: <Shield size={16} /> },
  { id: "members", label: "Members", icon: <UsersThree size={16} /> },
  { id: "invites", label: "Invites", icon: <UserPlus size={16} /> },
  { id: "audit", label: "Audit", icon: <ClipboardText size={16} /> },
];

const PERMISSION_LABELS = {
  manage_server: "Manage Server",
  manage_channels: "Manage Channels",
  manage_roles: "Manage Roles",
  manage_members: "Manage Members",
  kick_members: "Kick Members",
  ban_members: "Ban Members",
  send_messages: "Send Messages",
  read_messages: "Read Messages",
  manage_messages: "Manage Messages",
  attach_files: "Attach Files",
  mention_everyone: "Mention @everyone and all roles",
  join_voice: "Join Voice",
  speak: "Speak",
  mute_members: "Mute Members",
  deafen_members: "Deafen Members",
  priority_speaker: "Priority Speaker",
  create_invites: "Create Invites",
};

export default function ServerSettingsOverlay({
  open,
  onClose,
  server,
  channels,
  members,
  roles,
}) {
  const [activeSection, setActiveSection] = useState("general");
  const [serverName, setServerName] = useState(server?.name || "");
  const [serverDescription, setServerDescription] = useState(server?.description || "");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#6366F1");
  const [newRoleMentionable, setNewRoleMentionable] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [newChannelType, setNewChannelType] = useState("text");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelParentId, setNewChannelParentId] = useState("__root__");
  const [activeDragId, setActiveDragId] = useState(null);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [channelDraft, setChannelDraft] = useState({ name: "", topic: "", is_private: false, parent_id: "__root__", type: "text" });
  const [roleDraft, setRoleDraft] = useState({ name: "", color: "#6366F1", permissions: {}, mentionable: false });
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

  const saveGeneral = async () => {
    try {
      await api.put(`/servers/${server.id}`, {
        name: serverName,
        description: serverDescription,
      });
      toast.success("Server updated");
    } catch {
      toast.error("Failed to update server");
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
      toast.success("Channel updated");
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail));
    }
  };

  const deleteChannel = async () => {
    if (!selectedChannel) return;
    try {
      await api.delete(`/channels/${selectedChannel.id}`);
      toast.success("Channel deleted");
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail));
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
      toast.success(newChannelType === "category" ? "Category created" : "Channel created");
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail));
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
      toast.success("Channel order updated");
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail));
    }
  }, [channels, reorderChannels]);

  const renameChannelQuick = async (channel) => {
    const label = channel.type === "category" ? "category" : "channel";
    const nextName = window.prompt(`Rename ${label}`, channel.name);
    if (!nextName || nextName.trim() === channel.name) return;
    try {
      await api.put(`/channels/${channel.id}`, { name: nextName.trim() });
      toast.success(`${channel.type === "category" ? "Category" : "Channel"} renamed`);
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail));
    }
  };

  const deleteChannelQuick = async (channel) => {
    const label = channel.type === "category" ? "category" : "channel";
    const confirmed = window.confirm(`Delete ${label} "${channel.name}"?`);
    if (!confirmed) return;
    try {
      await api.delete(`/channels/${channel.id}`);
      toast.success(`${channel.type === "category" ? "Category" : "Channel"} deleted`);
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail));
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
      toast.success("Moved to the top level");
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail));
    }
  }, [channels, reorderChannels]);

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
              <ContextMenuItem onClick={() => prepareChannelCreate("text", channel.id)}>Create Text Channel</ContextMenuItem>
              <ContextMenuItem onClick={() => prepareChannelCreate("voice", channel.id)}>Create Voice Channel</ContextMenuItem>
              <ContextMenuItem onClick={() => renameChannelQuick(channel)}>Rename Category</ContextMenuItem>
              <ContextMenuItem className="text-[#EF4444]" onClick={() => deleteChannelQuick(channel)}>Delete Category</ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem onClick={() => renameChannelQuick(channel)}>Rename Channel</ContextMenuItem>
              {channel.parent_id && (
                <ContextMenuItem onClick={() => { void moveChannelToRoot(channel.id); }}>
                  Move To Root
                </ContextMenuItem>
              )}
              <ContextMenuItem className="text-[#EF4444]" onClick={() => deleteChannelQuick(channel)}>Delete Channel</ContextMenuItem>
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
                    Drop channel into {category.name}
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
              <div className="ml-4 px-3 py-1 text-[11px] text-[#52525B]">No channels yet</div>
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
      toast.success("Role created");
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail));
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
      toast.success("Role updated");
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail));
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
      toast.success("Role deleted");
    } catch (error) {
      toast.error(error.response?.data?.detail || "Failed to delete role");
    }
  };

  const assignRole = async (member, roleId) => {
    const nextRoles = member.roles?.includes(roleId)
      ? member.roles.filter((id) => id !== roleId)
      : [...(member.roles || []), roleId];

    try {
      await api.put(`/servers/${server.id}/members/${member.user_id}`, { roles: nextRoles });
      toast.success("Member updated");
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail));
    }
  };

  const moderateMember = async (memberId, action) => {
    try {
      if (action === "kick") {
        await api.delete(`/servers/${server.id}/members/${memberId}`);
      } else if (action === "ban") {
        await api.post(`/servers/${server.id}/moderation/ban`, { user_id: memberId, reason: "Banned by admin" });
      } else if (action === "mute") {
        await api.post(`/servers/${server.id}/moderation/mute`, { user_id: memberId, duration_minutes: 10 });
      }
      toast.success(
        action === "mute"
          ? "Member muted"
          : action === "kick"
            ? "Member kicked"
            : "Member banned",
      );
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail || `Failed to ${action} member`));
    }
  };

  if (!server) return null;

  return (
    <SettingsOverlayShell
      open={open}
      title={`${server.name} Settings`}
      sections={SECTION_CONFIG}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      onClose={onClose}
    >
      {activeSection === "general" && (
        <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
          <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>General</h3>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">Server Name</Label>
              <Input value={serverName} onChange={(event) => setServerName(event.target.value)} className="bg-[#0A0A0A] border-[#27272A] text-white" />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">Description</Label>
              <Input value={serverDescription} onChange={(event) => setServerDescription(event.target.value)} className="bg-[#0A0A0A] border-[#27272A] text-white" />
            </div>
          </div>
          <Button onClick={saveGeneral} className="mt-5 bg-[#6366F1] hover:bg-[#4F46E5]">Save Changes</Button>
        </section>
      )}

      {activeSection === "channels" && (
        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-4">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">Channels</p>
              <Button size="sm" variant="outline" onClick={createChannel} className="border-[#27272A] bg-[#0A0A0A] text-white hover:bg-[#1A1A1A]">
                <Plus size={14} className="mr-2" />
                Create
              </Button>
            </div>
            <div className="space-y-3">
              <div className="grid gap-2">
                <Input
                  value={newChannelName}
                  onChange={(event) => setNewChannelName(event.target.value)}
                  placeholder="new-channel"
                  className="bg-[#0A0A0A] border-[#27272A] text-white"
                />
                <div className="grid gap-2 md:grid-cols-2">
                  <select value={newChannelType} onChange={(event) => setNewChannelType(event.target.value)} className="h-10 rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white">
                    <option value="text">Text</option>
                    <option value="voice">Voice</option>
                    <option value="category">Category</option>
                  </select>
                  <select
                    value={newChannelParentId}
                    onChange={(event) => setNewChannelParentId(event.target.value)}
                    disabled={newChannelType === "category"}
                    className="h-10 rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white disabled:opacity-50"
                  >
                    <option value="__root__">No Category</option>
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
                              Drop here to move to the top level
                            </div>
                          )}
                        </ChannelContainerDropZone>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-52 border-[#27272A] bg-[#18181B] text-white">
                    <ContextMenuItem onClick={() => prepareChannelCreate("category")}>Create Category</ContextMenuItem>
                    <ContextMenuItem onClick={() => prepareChannelCreate("text")}>Create Text Channel</ContextMenuItem>
                    <ContextMenuItem onClick={() => prepareChannelCreate("voice")}>Create Voice Channel</ContextMenuItem>
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
                    <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>Edit Channel</h3>
                    <p className="mt-1 text-sm text-[#71717A]">
                      Drag channels in the list to reorder them or move them into a category.
                    </p>
                  </div>
                  <div className="rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 py-2 text-xs uppercase tracking-[0.2em] text-[#71717A]">
                    Drag & Drop
                  </div>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">Name</Label>
                    <Input
                      value={channelDraft.name}
                      onChange={(event) => setChannelDraft((previous) => ({ ...previous, name: event.target.value }))}
                      className="bg-[#0A0A0A] border-[#27272A] text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">Topic</Label>
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
                    <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">Type</Label>
                    <div className="h-10 flex items-center rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-[#A1A1AA]">
                      {channelDraft.type === "category" ? "Category" : channelDraft.type === "voice" ? "Voice" : "Text"}
                    </div>
                  </div>
                  {channelDraft.type !== "category" && (
                    <div className="space-y-2">
                      <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">Category</Label>
                      <select
                        value={channelDraft.parent_id}
                        onChange={(event) => setChannelDraft((previous) => ({ ...previous, parent_id: event.target.value }))}
                        className="h-10 w-full rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white"
                      >
                        <option value="__root__">No Category</option>
                        {categoryChannels.map((category) => (
                          <option key={category.id} value={category.id}>{category.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div className="mt-5 flex items-center justify-between rounded-lg border border-[#27272A] bg-[#0A0A0A] px-4 py-3">
                  <div>
                    <p className="text-sm text-white">Private Channel</p>
                    <p className="text-xs text-[#71717A]">Only explicitly allowed users and roles can access it.</p>
                  </div>
                  <Switch
                    checked={channelDraft.is_private}
                    disabled={channelDraft.type === "category"}
                    onCheckedChange={(checked) => setChannelDraft((previous) => ({ ...previous, is_private: checked }))}
                  />
                </div>
                <div className="mt-5 flex gap-2">
                  <Button onClick={saveChannel} className="bg-[#6366F1] hover:bg-[#4F46E5]">Save Channel</Button>
                  <Button onClick={deleteChannel} variant="outline" className="border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10">
                    <Trash size={14} className="mr-2" />
                    Delete
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-[#71717A]">No channel selected.</p>
            )}
          </section>
        </div>
      )}

      {activeSection === "roles" && (
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-4">
            <div className="mb-4 flex gap-2">
              <Input
                value={newRoleName}
                onChange={(event) => setNewRoleName(event.target.value)}
                placeholder="New role"
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
                <p className="text-sm text-white">Allow role mentions</p>
                <p className="text-xs text-[#71717A]">Members can ping this role without elevated mention rights.</p>
              </div>
              <Switch checked={newRoleMentionable} onCheckedChange={setNewRoleMentionable} />
            </div>
            <Button onClick={createRole} disabled={!newRoleName.trim()} className="mb-4 w-full bg-[#6366F1] hover:bg-[#4F46E5]">
              <Plus size={14} className="mr-2" />
              Create Role
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
                  <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>Role Editor</h3>
                  {!selectedRole.is_default && (
                    <Button onClick={deleteRole} variant="outline" className="border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10">
                      <Trash size={14} className="mr-2" />
                      Delete
                    </Button>
                  )}
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <div className="space-y-2 md:col-span-2">
                    <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">Role Name</Label>
                    <Input
                      value={roleDraft.name}
                      onChange={(event) => setRoleDraft((previous) => ({ ...previous, name: event.target.value }))}
                      disabled={selectedRole.is_default}
                      className="bg-[#0A0A0A] border-[#27272A] text-white"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">Color</Label>
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
                    <p className="text-sm text-white">@everyone is the fixed default role</p>
                    <p className="mt-1 text-xs text-[#71717A]">You can adjust its base permissions, but not rename, recolor or delete it.</p>
                  </div>
                ) : (
                  <div className="mt-4 flex items-center justify-between rounded-lg border border-[#27272A] bg-[#0A0A0A] px-4 py-3">
                    <div>
                      <p className="text-sm text-white">Allow role mentions</p>
                      <p className="text-xs text-[#71717A]">Members can ping this role without global mention rights.</p>
                    </div>
                    <Switch
                      checked={!!roleDraft.mentionable}
                      onCheckedChange={(checked) => setRoleDraft((previous) => ({ ...previous, mentionable: checked }))}
                    />
                  </div>
                )}

                <Button onClick={saveRole} className="mt-5 bg-[#6366F1] hover:bg-[#4F46E5]">Save Role</Button>

                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  {Object.entries(PERMISSION_LABELS).map(([permissionKey, label]) => (
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
              <p className="text-sm text-[#71717A]">No role selected.</p>
            )}
          </section>
        </div>
      )}

      {activeSection === "members" && (
        <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
          <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>Members</h3>
          <ScrollArea className="mt-5 h-[560px] pr-4">
            <div className="space-y-4">
              {members?.map((member) => (
                <div key={member.user_id} className="rounded-lg border border-[#27272A] bg-[#0A0A0A] p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-white">{member.user?.display_name}</p>
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
                      <Button onClick={() => moderateMember(member.user_id, "mute")} variant="outline" className="border-[#27272A] bg-transparent text-white hover:bg-[#1A1A1A]">Mute</Button>
                      <Button onClick={() => moderateMember(member.user_id, "kick")} variant="outline" className="border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10">
                        <UserMinus size={14} className="mr-2" />
                        Kick
                      </Button>
                      <Button onClick={() => moderateMember(member.user_id, "ban")} variant="outline" className="border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10">
                        <Trash size={14} className="mr-2" />
                        Ban
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </section>
      )}

        {activeSection === "invites" && (
          <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
            <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>Invites</h3>
            <p className="mt-1 text-sm text-[#71717A]">
              Generate shareable invite links with expiry and usage limits.
            </p>
            <div className="mt-5">
              <InviteGeneratorPanel serverId={server.id} />
            </div>
          </section>
        )}

      {activeSection === "audit" && (
        <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
          <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>Audit Log</h3>
          <ScrollArea className="mt-5 h-[560px] pr-4">
            {auditLogs.length === 0 ? (
              <p className="text-sm text-[#71717A]">No audit entries yet.</p>
            ) : (
              <div className="space-y-3">
                {auditLogs.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-[#27272A] bg-[#0A0A0A] px-4 py-3">
                    <p className="text-sm text-white">
                      <span className="font-semibold">{entry.actor?.display_name || "System"}</span>
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
