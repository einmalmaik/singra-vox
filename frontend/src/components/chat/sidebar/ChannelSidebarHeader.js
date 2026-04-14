/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { GearSix } from "@phosphor-icons/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export default function ChannelSidebarHeader({
  serverName,
  canManageChannels,
  canOpenServerSettings,
  onOpenCreateDialog,
  onOpenServerSettings,
  t,
}) {
  return (
    <div className="h-14 flex items-center justify-between px-4 border-b workspace-divider shrink-0 bg-zinc-900/25">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <h3 className="text-base font-bold text-white truncate" style={{ fontFamily: "Manrope" }} data-testid="server-name-header">
            {serverName}
          </h3>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52 border-[#27272A] bg-[#18181B] text-white">
          {canManageChannels ? (
            <>
              <ContextMenuItem onClick={() => onOpenCreateDialog("category", null)}>{t("serverSettings.createCategory")}</ContextMenuItem>
              <ContextMenuItem onClick={() => onOpenCreateDialog("text", null)}>{t("serverSettings.createTextChannel")}</ContextMenuItem>
              <ContextMenuItem onClick={() => onOpenCreateDialog("voice", null)}>{t("serverSettings.createVoiceChannel")}</ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem disabled className="text-[#71717A] focus:text-[#71717A] focus:bg-transparent cursor-default">
              {t("common.noActionsAvailable")}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {canOpenServerSettings && (
        <button
          className="workspace-icon-button"
          onClick={onOpenServerSettings}
          data-testid="server-settings-button"
        >
          <GearSix size={16} weight="bold" />
        </button>
      )}
    </div>
  );
}
