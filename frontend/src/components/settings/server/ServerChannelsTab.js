/*
 * Singra Vox – Server Channels settings tab
 * Channel tree with drag-and-drop, CRUD, and category management.
 */
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
  CaretDown,
  CaretRight,
  Folder,
  Hash,
  Microphone,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export default function ServerChannelsTab({ server, channels }) {
  const { t } = useTranslation();
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [newChannelType, setNewChannelType] = useState("text");
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelParentId, setNewChannelParentId] = useState("__root__");
  const [activeDragId, setActiveDragId] = useState(null);
  const [collapsedCategories, setCollapsedCategories] = useState({});
  const [channelDraft, setChannelDraft] = useState({ name: "", topic: "", is_private: false, parent_id: "__root__", type: "text" });

  const channelOrganization = useMemo(() => buildChannelOrganization(channels || []), [channels]);
  const categoryChannels = useMemo(
    () => channelOrganization.topLevelItems.filter((ch) => ch.type === "category"),
    [channelOrganization],
  );
  const activeDragChannel = activeDragId ? channelOrganization.byId[activeDragId] : null;
  const isDraggingChannel = Boolean(activeDragChannel);
  const canDropIntoCategory = activeDragChannel?.type && activeDragChannel.type !== "category";

  const selectedChannel = useMemo(
    () => channels?.find((ch) => ch.id === selectedChannelId) || channels?.[0] || null,
    [channels, selectedChannelId],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    if (!selectedChannelId && channels?.length) setSelectedChannelId(channels[0].id);
    else if (selectedChannelId && !channels?.some((ch) => ch.id === selectedChannelId)) setSelectedChannelId(channels?.[0]?.id || "");
  }, [channels, selectedChannelId]);

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

  const reorderChannels = useCallback(
    async (items) => {
      if (!items?.length) return;
      await api.put(`/servers/${server.id}/channels/reorder`, { items });
    },
    [server?.id],
  );

  const collisionDetection = useCallback((args) => {
    const p = pointerWithin(args);
    return p.length > 0 ? p : rectIntersection(args);
  }, []);

  const handleChannelDragStart = useCallback((e) => setActiveDragId(String(e.active.id)), []);
  const handleChannelDragCancel = useCallback(() => setActiveDragId(null), []);

  const handleChannelDragEnd = useCallback(
    async (event) => {
      setActiveDragId(null);
      const activeId = String(event.active?.id || "");
      const rawOverId = event.over?.id;
      if (!activeId || !rawOverId) return;
      const overId = String(rawOverId);
      const overContainerId = parseContainerDropId(overId);
      const items = computeChannelReorderPayload({
        channels,
        activeId,
        overId: overContainerId ? null : overId,
        overContainerId,
      });
      if (!items.length) return;
      try {
        await reorderChannels(items);
        toast.success(t("serverSettings.channelOrderUpdated"));
      } catch (error) {
        toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelReorderFailed" }));
      }
    },
    [channels, reorderChannels, t],
  );

  const moveChannelToRoot = useCallback(
    async (channelId) => {
      const items = computeChannelReorderPayload({ channels, activeId: channelId, overContainerId: ROOT_CHANNEL_CONTAINER_ID });
      if (!items.length) return;
      try {
        await reorderChannels(items);
        toast.success(t("serverSettings.movedToTopLevel"));
      } catch (error) {
        toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.channelReorderFailed" }));
      }
    },
    [channels, reorderChannels, t],
  );

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

  const prepareChannelCreate = (type, parentId = "__root__") => {
    setNewChannelType(type);
    setNewChannelParentId(type === "category" ? "__root__" : parentId);
    setNewChannelName("");
  };

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
                  if (isCategory) setCollapsedCategories((prev) => ({ ...prev, [channel.id]: !prev[channel.id] }));
                }}
                className={`flex ${nested ? "ml-4 w-[calc(100%-1rem)]" : "w-full"} items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors touch-none ${
                  selectedChannel?.id === channel.id ? "bg-[#27272A] text-white" : "text-[#A1A1AA] hover:bg-[#1A1A1A] hover:text-white"
                } ${isOver ? "ring-1 ring-[#6366F1] bg-[#18181B]" : ""} ${isDragging ? "opacity-60" : ""}`}
              >
                {isCategory ? (
                  <>{isCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}<Folder size={14} /></>
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
                <ContextMenuItem onClick={() => { void moveChannelToRoot(channel.id); }}>{t("serverSettings.moveToRoot")}</ContextMenuItem>
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
            {canDropIntoCategory && (
              <ChannelContainerDropZone id={getContainerDropId(category.id)} data={{ containerId: category.id }}>
                {({ setNodeRef, isOver }) => (
                  <div
                    ref={setNodeRef}
                    className={`ml-4 rounded-md border border-dashed px-3 py-2 text-[11px] transition-colors ${
                      isOver ? "border-[#6366F1] bg-[#18181B] text-[#A5B4FC]" : "border-[#27272A] bg-[#111113] text-[#71717A]"
                    }`}
                  >
                    {t("serverSettings.dropIntoCategory", { name: category.name })}
                  </div>
                )}
              </ChannelContainerDropZone>
            )}
            <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
              {childIds.map((childId) => {
                const child = channelOrganization.byId[childId];
                return child ? renderChannelTreeRow(child, { nested: true }) : null;
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

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
      {/* Channel tree panel */}
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
              onChange={(e) => setNewChannelName(e.target.value)}
              placeholder={t("serverSettings.createChannelPlaceholder")}
              className="bg-[#0A0A0A] border-[#27272A] text-white"
            />
            <div className="grid gap-2 md:grid-cols-2">
              <select value={newChannelType} onChange={(e) => setNewChannelType(e.target.value)} className="h-10 rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white">
                <option value="text">{t("serverSettings.channelTypeText")}</option>
                <option value="voice">{t("serverSettings.channelTypeVoice")}</option>
                <option value="category">{t("serverSettings.channelTypeCategory")}</option>
              </select>
              <select
                value={newChannelParentId}
                onChange={(e) => setNewChannelParentId(e.target.value)}
                disabled={newChannelType === "category"}
                className="h-10 rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white disabled:opacity-50"
              >
                <option value="__root__">{t("common.noCategory")}</option>
                {categoryChannels.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
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
                    {channelOrganization.rootIds.map((chId) => {
                      const ch = channelOrganization.byId[chId];
                      if (!ch) return null;
                      return ch.type === "category" ? renderCategoryTreeBlock(ch) : renderChannelTreeRow(ch);
                    })}
                  </SortableContext>
                  {isDraggingChannel && (
                    <ChannelContainerDropZone id={getContainerDropId(ROOT_CHANNEL_CONTAINER_ID)} data={{ containerId: ROOT_CHANNEL_CONTAINER_ID }}>
                      {({ setNodeRef, isOver }) => (
                        <div
                          ref={setNodeRef}
                          className={`rounded-md border border-dashed px-3 py-2 text-[11px] transition-colors ${
                            isOver ? "border-[#6366F1] bg-[#18181B] text-[#A5B4FC]" : "border-[#27272A] bg-[#111113] text-[#71717A]"
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
                <div className="flex items-center gap-2 rounded-md border border-[#6366F1] bg-[#18181B] px-3 py-2 text-sm text-white shadow-2xl" style={{ transform: "translateY(-14px)" }}>
                  {activeDragChannel.type === "category" ? <Folder size={14} className="text-[#A5B4FC]" /> : activeDragChannel.type === "voice" ? <Microphone size={14} className="text-[#A5B4FC]" /> : <Hash size={14} className="text-[#A5B4FC]" />}
                  <span>{activeDragChannel.name}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </section>

      {/* Channel editor panel */}
      <section className="rounded-xl border border-[#27272A] bg-[#121212] p-6">
        {selectedChannel ? (
          <>
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("serverSettings.editChannel")}</h3>
                <p className="mt-1 text-sm text-[#71717A]">{t("serverSettings.editChannelHelp")}</p>
              </div>
              <div className="rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 py-2 text-xs uppercase tracking-[0.2em] text-[#71717A]">{t("serverSettings.dragDrop")}</div>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("common.name")}</Label>
                <Input value={channelDraft.name} onChange={(e) => setChannelDraft((p) => ({ ...p, name: e.target.value }))} className="bg-[#0A0A0A] border-[#27272A] text-white" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("serverSettings.topicLabel")}</Label>
                <Input value={channelDraft.topic} onChange={(e) => setChannelDraft((p) => ({ ...p, topic: e.target.value }))} disabled={channelDraft.type === "category"} className="bg-[#0A0A0A] border-[#27272A] text-white" />
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
                    onChange={(e) => setChannelDraft((p) => ({ ...p, parent_id: e.target.value }))}
                    className="h-10 w-full rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white"
                  >
                    <option value="__root__">{t("common.noCategory")}</option>
                    {categoryChannels.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
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
                onCheckedChange={(checked) => setChannelDraft((p) => ({ ...p, is_private: checked }))}
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
  );
}
