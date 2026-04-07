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
  PencilSimple,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { SETTINGS_INPUT_CLASSNAME, SETTINGS_NATIVE_SELECT_CLASSNAME } from "@/components/settings/settingsConstants";
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

  const channelIcon = (type, size = 16) => {
    if (type === "category") return <Folder size={size} weight="duotone" />;
    if (type === "voice") return <Microphone size={size} />;
    return <Hash size={size} />;
  };

  const renderChannelTreeRow = (channel, { nested = false } = {}) => {
    const isCategory = channel.type === "category";
    const isCollapsed = Boolean(collapsedCategories[channel.id]);
    const isSelected = selectedChannel?.id === channel.id;
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
                className={`flex ${nested ? "ml-5 w-[calc(100%-1.25rem)]" : "w-full"} items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-all touch-none ${
                  isSelected
                    ? "bg-white/8 text-white shadow-[0_0_12px_rgba(34,211,238,0.06)]"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                } ${isOver ? "ring-1 ring-cyan-400/40 bg-cyan-500/5" : ""} ${isDragging ? "opacity-50" : ""}`}
                data-testid={`channel-tree-item-${channel.id}`}
              >
                <span className={isSelected ? "text-cyan-300" : "text-zinc-500"}>
                  {isCategory ? (
                    <>{isCollapsed ? <CaretRight size={13} /> : <CaretDown size={13} />}</>
                  ) : null}
                </span>
                <span className={isSelected ? "text-cyan-300" : "text-zinc-500"}>
                  {channelIcon(channel.type, 16)}
                </span>
                <span className="truncate">{channel.name}</span>
              </button>
            </ContextMenuTrigger>
          )}
        </SortableChannelItem>
        <ContextMenuContent className="w-56 rounded-xl border-white/10 bg-zinc-900/95 backdrop-blur-xl text-white shadow-2xl">
          {isCategory ? (
            <>
              <ContextMenuItem onClick={() => prepareChannelCreate("text", channel.id)} className="rounded-lg">{t("serverSettings.createTextChannel")}</ContextMenuItem>
              <ContextMenuItem onClick={() => prepareChannelCreate("voice", channel.id)} className="rounded-lg">{t("serverSettings.createVoiceChannel")}</ContextMenuItem>
              <ContextMenuItem onClick={() => renameChannelQuick(channel)} className="rounded-lg">{t("serverSettings.renameCategoryAction")}</ContextMenuItem>
              <ContextMenuItem className="rounded-lg text-red-400" onClick={() => deleteChannelQuick(channel)}>{t("serverSettings.deleteCategoryAction")}</ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem onClick={() => renameChannelQuick(channel)} className="rounded-lg">{t("serverSettings.renameChannelAction")}</ContextMenuItem>
              {channel.parent_id && (
                <ContextMenuItem onClick={() => { void moveChannelToRoot(channel.id); }} className="rounded-lg">{t("serverSettings.moveToRoot")}</ContextMenuItem>
              )}
              <ContextMenuItem className="rounded-lg text-red-400" onClick={() => deleteChannelQuick(channel)}>{t("serverSettings.deleteChannelAction")}</ContextMenuItem>
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
      <div key={category.id} className="space-y-1 rounded-2xl border border-white/8 bg-zinc-950/40 p-2">
        {renderChannelTreeRow(category)}
        {!isCollapsed && (
          <div className="space-y-1 border-t border-white/5 pt-1.5">
            {canDropIntoCategory && (
              <ChannelContainerDropZone id={getContainerDropId(category.id)} data={{ containerId: category.id }}>
                {({ setNodeRef, isOver }) => (
                  <div
                    ref={setNodeRef}
                    className={`ml-5 rounded-xl border border-dashed px-4 py-2.5 text-xs transition-all ${
                      isOver ? "border-cyan-400/50 bg-cyan-500/8 text-cyan-300" : "border-white/8 bg-zinc-950/30 text-zinc-600"
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
              <div className="ml-5 px-4 py-2 text-xs text-zinc-600">{t("channel.noChannelsYet")}</div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)] xl:grid-cols-[400px_minmax(0,1fr)]" data-testid="server-settings-channels">
      {/* Channel tree panel */}
      <section className="workspace-card p-6">
        <div className="mb-5 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">{t("serverSettings.channelsPanelTitle")}</p>
          <Button
            size="sm"
            onClick={createChannel}
            disabled={!newChannelName.trim()}
            className="h-9 rounded-xl bg-cyan-400 text-zinc-950 font-semibold hover:bg-cyan-300 transition-colors px-4"
            data-testid="create-channel-btn"
          >
            <Plus size={14} className="mr-1.5" />
            {t("common.create")}
          </Button>
        </div>

        {/* Create form */}
        <div className="space-y-3 mb-5">
          <Input
            value={newChannelName}
            onChange={(e) => setNewChannelName(e.target.value)}
            placeholder={t("serverSettings.createChannelPlaceholder")}
            className={SETTINGS_INPUT_CLASSNAME}
            data-testid="new-channel-name-input"
          />
          <div className="grid gap-3 grid-cols-2">
            <select
              value={newChannelType}
              onChange={(e) => setNewChannelType(e.target.value)}
              className={SETTINGS_NATIVE_SELECT_CLASSNAME}
              data-testid="new-channel-type-select"
            >
              <option value="text">{t("serverSettings.channelTypeText")}</option>
              <option value="voice">{t("serverSettings.channelTypeVoice")}</option>
              <option value="category">{t("serverSettings.channelTypeCategory")}</option>
            </select>
            <select
              value={newChannelParentId}
              onChange={(e) => setNewChannelParentId(e.target.value)}
              disabled={newChannelType === "category"}
              className={SETTINGS_NATIVE_SELECT_CLASSNAME}
              data-testid="new-channel-parent-select"
            >
              <option value="__root__">{t("common.noCategory")}</option>
              {categoryChannels.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Channel tree */}
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={handleChannelDragStart}
          onDragCancel={handleChannelDragCancel}
          onDragEnd={handleChannelDragEnd}
        >
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="space-y-2">
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
                        className={`rounded-xl border border-dashed px-4 py-3 text-xs transition-all ${
                          isOver ? "border-cyan-400/50 bg-cyan-500/8 text-cyan-300" : "border-white/8 bg-zinc-950/30 text-zinc-600"
                        }`}
                      >
                        {t("serverSettings.dropToTopLevel")}
                      </div>
                    )}
                  </ChannelContainerDropZone>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56 rounded-xl border-white/10 bg-zinc-900/95 backdrop-blur-xl text-white shadow-2xl">
              <ContextMenuItem onClick={() => prepareChannelCreate("category")} className="rounded-lg">{t("serverSettings.createCategory")}</ContextMenuItem>
              <ContextMenuItem onClick={() => prepareChannelCreate("text")} className="rounded-lg">{t("serverSettings.createTextChannel")}</ContextMenuItem>
              <ContextMenuItem onClick={() => prepareChannelCreate("voice")} className="rounded-lg">{t("serverSettings.createVoiceChannel")}</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <DragOverlay>
            {activeDragChannel ? (
              <div className="flex items-center gap-2.5 rounded-xl border border-cyan-400/30 bg-zinc-900/95 backdrop-blur-xl px-4 py-3 text-sm font-medium text-white shadow-2xl">
                <span className="text-cyan-300">{channelIcon(activeDragChannel.type, 16)}</span>
                <span>{activeDragChannel.name}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {(!channels || channels.length === 0) && (
          <div className="mt-4 rounded-2xl border border-white/8 bg-zinc-950/40 px-5 py-6 text-center">
            <p className="text-sm text-zinc-500">{t("channel.noChannelsYet")}</p>
          </div>
        )}
      </section>

      {/* Channel editor panel */}
      <section className="workspace-card p-6">
        {selectedChannel ? (
          <>
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/15">
                  <PencilSimple size={22} className="text-cyan-300" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white" style={{ fontFamily: "Manrope" }}>
                    {t("serverSettings.editChannel")}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500">{t("serverSettings.editChannelHelp")}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-zinc-950/60 px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-zinc-500">
                {t("serverSettings.dragDrop")}
              </div>
            </div>

            <div className="grid gap-5 xl:grid-cols-2">
              <div className="space-y-2.5">
                <Label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">{t("common.name")}</Label>
                <Input
                  value={channelDraft.name}
                  onChange={(e) => setChannelDraft((p) => ({ ...p, name: e.target.value }))}
                  className={SETTINGS_INPUT_CLASSNAME}
                  data-testid="edit-channel-name-input"
                />
              </div>
              <div className="space-y-2.5">
                <Label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">{t("serverSettings.topicLabel")}</Label>
                <Input
                  value={channelDraft.topic}
                  onChange={(e) => setChannelDraft((p) => ({ ...p, topic: e.target.value }))}
                  disabled={channelDraft.type === "category"}
                  className={SETTINGS_INPUT_CLASSNAME}
                  data-testid="edit-channel-topic-input"
                />
              </div>
            </div>

            <div className="mt-5 grid gap-5 xl:grid-cols-2">
              <div className="space-y-2.5">
                <Label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">{t("common.type")}</Label>
                <div className="h-12 flex items-center rounded-2xl border border-white/10 bg-zinc-950/60 px-4 text-sm text-zinc-400">
                  {channelIcon(channelDraft.type, 15)}
                  <span className="ml-2.5">
                    {channelDraft.type === "category" ? t("serverSettings.channelTypeCategory") : channelDraft.type === "voice" ? t("serverSettings.channelTypeVoice") : t("serverSettings.channelTypeText")}
                  </span>
                </div>
              </div>
              {channelDraft.type !== "category" && (
                <div className="space-y-2.5">
                  <Label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">{t("common.category")}</Label>
                  <select
                    value={channelDraft.parent_id}
                    onChange={(e) => setChannelDraft((p) => ({ ...p, parent_id: e.target.value }))}
                    className={SETTINGS_NATIVE_SELECT_CLASSNAME}
                    data-testid="edit-channel-category-select"
                  >
                    <option value="__root__">{t("common.noCategory")}</option>
                    {categoryChannels.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-between rounded-2xl border border-white/10 bg-zinc-950/60 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-white">{t("serverSettings.privateChannel")}</p>
                <p className="mt-1 text-xs text-zinc-500">{t("serverSettings.privateChannelHelp")}</p>
              </div>
              <Switch
                checked={channelDraft.is_private}
                disabled={channelDraft.type === "category"}
                onCheckedChange={(checked) => setChannelDraft((p) => ({ ...p, is_private: checked }))}
                data-testid="edit-channel-private-toggle"
              />
            </div>

            <div className="mt-6 flex gap-3">
              <Button
                onClick={saveChannel}
                className="h-11 rounded-2xl bg-cyan-400 px-8 text-zinc-950 font-semibold hover:bg-cyan-300 transition-colors"
                data-testid="save-channel-btn"
              >
                {t("serverSettings.saveChannel")}
              </Button>
              <Button
                onClick={deleteChannel}
                variant="outline"
                className="h-11 rounded-2xl border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 px-6 transition-colors"
                data-testid="delete-channel-btn"
              >
                <Trash size={15} className="mr-2" />
                {t("common.delete")}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-60">
            <p className="text-sm text-zinc-600">{t("serverSettings.noChannelSelected")}</p>
          </div>
        )}
      </section>
    </div>
  );
}
