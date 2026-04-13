/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import {
  CaretDown,
  CaretRight,
  Folder,
  Hash,
  Lock,
  SpeakerHigh,
} from "@phosphor-icons/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import SortableChannelItem from "@/components/channels/SortableChannelItem";
import { ROOT_CHANNEL_CONTAINER_ID } from "@/lib/channelOrganization";

export default function ChannelTreeItem({
  channel,
  nested = false,
  unread,
  isCurrent,
  isCollapsed,
  capabilities,
  onActivate,
  onOpenCreateDialog,
  onRenameChannel,
  onDeleteChannel,
  onMoveChannelToRoot,
  onOpenServerSettings,
  t,
}) {
  const hasUnread = Boolean(unread?.count) && channel.type === "text" && !isCurrent;
  const hasMentionUnread = hasUnread && unread?.mentions > 0;

  return (
    <ContextMenu>
      <SortableChannelItem
        id={channel.id}
        disabled={!capabilities.canManageChannels}
        data={{
          itemType: channel.type,
          containerId: channel.type === "category"
            ? ROOT_CHANNEL_CONTAINER_ID
            : (channel.parent_id || ROOT_CHANNEL_CONTAINER_ID),
        }}
      >
        {({ setNodeRef, attributes, listeners, isDragging, isOver, style }) => (
          <ContextMenuTrigger asChild>
            <button
              ref={setNodeRef}
              type="button"
              {...attributes}
              {...listeners}
              style={{
                ...style,
                paddingLeft: nested ? "28px" : undefined,
              }}
              onClick={() => onActivate(channel)}
              className={`channel-item w-full flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm touch-none transition-all ${
                isCurrent
                  ? "active text-white bg-cyan-500/12 workspace-cyan-glow"
                  : hasMentionUnread
                    ? "bg-[#2A1616] text-white font-semibold"
                    : hasUnread
                      ? "text-white font-semibold hover:bg-white/5"
                      : "text-[#A1A1AA] hover:bg-white/5 hover:text-white"
              } ${isOver ? "ring-1 ring-cyan-400/70 bg-white/5" : ""} ${isDragging ? "opacity-60" : ""}`}
              data-testid={`channel-${channel.name}`}
            >
              {hasUnread && (
                <span
                  className={`h-5 rounded-r-full transition-all ${
                    hasMentionUnread ? "w-2 bg-[#EF4444] animate-pulse" : "w-1 bg-white/90"
                  }`}
                />
              )}
              {channel.type === "category" ? (
                <>
                  {isCollapsed ? (
                    <CaretRight size={12} weight="bold" className="text-[#71717A] shrink-0" />
                  ) : (
                    <CaretDown size={12} weight="bold" className="text-[#71717A] shrink-0" />
                  )}
                  <Folder size={16} weight="bold" className="text-[#71717A] shrink-0" />
                </>
              ) : channel.type === "voice" ? (
                <SpeakerHigh size={16} weight="bold" className="text-[#71717A] shrink-0" />
              ) : channel.is_private ? (
                <Lock size={16} weight="bold" className="text-[#71717A] shrink-0" />
              ) : (
                <Hash size={16} weight="bold" className="text-[#71717A] shrink-0" />
              )}
              <span className="truncate flex-1">{channel.name}</span>
              {unread?.count > 0 && !isCurrent && channel.type === "text" && (
                <span className={`shrink-0 min-w-[18px] h-[18px] rounded-full text-[10px] font-bold flex items-center justify-center ${
                  unread.mentions > 0 ? "bg-[#EF4444] text-white" : "bg-[#6366F1] text-white"
                }`}>
                  {unread.count > 99 ? "99+" : unread.count}
                </span>
              )}
            </button>
          </ContextMenuTrigger>
        )}
      </SortableChannelItem>
      <ContextMenuContent className="w-52 border-[#27272A] bg-[#18181B] text-white">
        {capabilities.canManageChannels ? (
          channel.type === "category" ? (
            <>
              <ContextMenuItem onClick={() => onOpenCreateDialog("text", channel.id)}>{t("serverSettings.createTextChannel")}</ContextMenuItem>
              <ContextMenuItem onClick={() => onOpenCreateDialog("voice", channel.id)}>{t("serverSettings.createVoiceChannel")}</ContextMenuItem>
              <ContextMenuItem onClick={() => onRenameChannel(channel)}>{t("serverSettings.renameCategoryAction")}</ContextMenuItem>
              <ContextMenuItem className="text-[#EF4444]" onClick={() => onDeleteChannel(channel)}>{t("serverSettings.deleteCategoryAction")}</ContextMenuItem>
            </>
          ) : (
            <>
              <ContextMenuItem onClick={() => onRenameChannel(channel)}>{t("serverSettings.renameChannelAction")}</ContextMenuItem>
              {channel.parent_id && (
                <ContextMenuItem onClick={() => { void onMoveChannelToRoot(channel.id); }}>
                  {t("serverSettings.moveToRoot")}
                </ContextMenuItem>
              )}
              <ContextMenuItem className="text-[#EF4444]" onClick={() => onDeleteChannel(channel)}>{t("serverSettings.deleteChannelAction")}</ContextMenuItem>
              <ContextMenuItem onClick={onOpenServerSettings}>{t("serverSettings.editChannel")}</ContextMenuItem>
            </>
          )
        ) : (
          <ContextMenuItem disabled className="text-[#71717A] focus:text-[#71717A] focus:bg-transparent cursor-default">
            {t("common.noActionsAvailable", { defaultValue: "No actions available" })}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
