/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { DndContext, DragOverlay } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Folder, Hash, Lock, Plus, SpeakerHigh } from "@phosphor-icons/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import ChannelContainerDropZone from "@/components/channels/ChannelContainerDropZone";
import {
  getContainerDropId,
  ROOT_CHANNEL_CONTAINER_ID,
} from "@/lib/channelOrganization";
import ChannelTreeItem from "./ChannelTreeItem";
import VoiceParticipantList from "./VoiceParticipantList";

export default function ChannelTree({
  sensors,
  collisionDetection,
  onDragStart,
  onDragCancel,
  onDragEnd,
  channelOrganization,
  currentChannel,
  unreadMap,
  collapsedCategories,
  capabilities,
  activeDragChannel,
  isDraggingChannel,
  canDropIntoCategory,
  channelParticipantEntries,
  currentUserId,
  onUpdateLocalPreferences,
  onOpenMediaStage,
  onHandleModerationAction,
  onOpenCreateDialog,
  onOpenCreateDialogButton,
  onRenameChannel,
  onDeleteChannel,
  onMoveChannelToRoot,
  onOpenServerSettings,
  onActivateChannel,
  createButtonLabel,
  t,
}) {
  const renderChannelEntry = (channel, { nested = false } = {}) => (
    <div key={channel.id}>
      <ChannelTreeItem
        channel={channel}
        nested={nested}
        unread={unreadMap?.[channel.id]}
        isCurrent={currentChannel?.id === channel.id}
        isCollapsed={Boolean(collapsedCategories[channel.id])}
        capabilities={capabilities}
        onActivate={onActivateChannel}
        onOpenCreateDialog={onOpenCreateDialog}
        onRenameChannel={onRenameChannel}
        onDeleteChannel={onDeleteChannel}
        onMoveChannelToRoot={onMoveChannelToRoot}
        onOpenServerSettings={onOpenServerSettings}
        t={t}
      />
      {channel.type === "voice" && (
        <VoiceParticipantList
          participants={channelParticipantEntries[channel.id] || []}
          capabilities={capabilities}
          currentUserId={currentUserId}
          onUpdateLocalPreferences={onUpdateLocalPreferences}
          onOpenMediaStage={onOpenMediaStage}
          onHandleModerationAction={onHandleModerationAction}
          t={t}
        />
      )}
    </div>
  );

  const renderCategoryBlock = (category) => {
    const collapsed = Boolean(collapsedCategories[category.id]);
    const childIds = channelOrganization.childIdsByCategory[category.id] || [];

    return (
      <div key={category.id} className="workspace-card px-1.5 py-1.5">
        {renderChannelEntry(category)}
        {!collapsed && (
          <div className="space-y-1 border-t border-[#202027] pt-1">
            {canDropIntoCategory && (
              <ChannelContainerDropZone
                id={getContainerDropId(category.id)}
                data={{ containerId: category.id }}
              >
                {({ setNodeRef, isOver }) => (
                  <div
                    ref={setNodeRef}
                    className={`ml-7 rounded-md border border-dashed px-3 py-1 text-[11px] transition-colors ${
                      isOver
                        ? "border-[#6366F1] bg-[#18181B] text-[#A5B4FC]"
                        : "border-[#27272A] bg-[#111113] text-[#52525B]"
                    }`}
                  >
                    {t("serverSettings.dropIntoCategory", { name: category.name })}
                  </div>
                )}
              </ChannelContainerDropZone>
            )}
            <SortableContext items={childIds} strategy={verticalListSortingStrategy}>
              {childIds.map((channelId) => {
                const childChannel = channelOrganization.byId[channelId];
                if (!childChannel) {
                  return null;
                }
                return renderChannelEntry(childChannel, { nested: true });
              })}
            </SortableContext>
            {childIds.length === 0 && !canDropIntoCategory && (
              <div className="px-7 py-1 text-[11px] text-[#5A5A63]">{t("channel.noChannelsYet")}</div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragCancel={onDragCancel}
      onDragEnd={onDragEnd}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
            <div className="space-y-3">
              <SortableContext items={channelOrganization.rootIds} strategy={verticalListSortingStrategy}>
                {channelOrganization.rootIds.map((channelId) => {
                  const channel = channelOrganization.byId[channelId];
                  if (!channel) {
                    return null;
                  }
                  if (channel.type === "category") {
                    return renderCategoryBlock(channel);
                  }
                  return renderChannelEntry(channel);
                })}
              </SortableContext>
              {capabilities.canManageChannels && isDraggingChannel && (
                <ChannelContainerDropZone
                  id={getContainerDropId(ROOT_CHANNEL_CONTAINER_ID)}
                  data={{ containerId: ROOT_CHANNEL_CONTAINER_ID }}
                >
                  {({ setNodeRef, isOver }) => (
                    <div
                      ref={setNodeRef}
                      className={`rounded-xl border border-dashed px-3 py-2 text-[11px] transition-colors ${
                        isOver
                          ? "border-cyan-400 bg-cyan-500/10 text-cyan-200"
                          : "border-white/10 bg-zinc-950/55 text-[#71717A]"
                      }`}
                    >
                      {t("serverSettings.dropToTopLevel")}
                    </div>
                  )}
                </ChannelContainerDropZone>
              )}
            </div>

            {capabilities.canManageChannels && (
              <button
                type="button"
                data-testid="create-channel-button"
                onClick={onOpenCreateDialogButton}
                className="mt-1 flex w-full items-center gap-2 rounded-xl border border-dashed border-white/10 bg-zinc-950/35 px-3 py-2 text-sm text-[#A1A1AA] transition-all hover:border-cyan-400/40 hover:bg-cyan-500/8 hover:text-white"
              >
                <Plus size={14} weight="bold" />
                <span>{createButtonLabel}</span>
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52 border-[#27272A] bg-[#18181B] text-white">
          {capabilities.canManageChannels ? (
            <>
              <ContextMenuItem onClick={() => onOpenCreateDialog("category", null)}>{t("serverSettings.createCategory")}</ContextMenuItem>
              <ContextMenuItem onClick={() => onOpenCreateDialog("text", null)}>{t("serverSettings.createTextChannel")}</ContextMenuItem>
              <ContextMenuItem onClick={() => onOpenCreateDialog("voice", null)}>{t("serverSettings.createVoiceChannel")}</ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem disabled className="text-[#71717A] focus:text-[#71717A] focus:bg-transparent cursor-default">
              {t("common.noActionsAvailable", { defaultValue: "No actions available" })}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <DragOverlay>
        {activeDragChannel ? (
          <div
            className="flex items-center gap-2 rounded-md border border-[#6366F1] bg-[#18181B] px-3 py-2 text-sm text-white shadow-2xl"
            style={{ transform: "translateY(-14px)" }}
          >
            {activeDragChannel.type === "category" ? (
              <Folder size={16} weight="bold" className="text-[#A5B4FC]" />
            ) : activeDragChannel.type === "voice" ? (
              <SpeakerHigh size={16} weight="bold" className="text-[#A5B4FC]" />
            ) : activeDragChannel.is_private ? (
              <Lock size={16} weight="bold" className="text-[#A5B4FC]" />
            ) : (
              <Hash size={16} weight="bold" className="text-[#A5B4FC]" />
            )}
            <span className="truncate">{activeDragChannel.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
