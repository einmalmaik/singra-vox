/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChatCircleDots, GearSix, Plus, Trash } from "@phosphor-icons/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import api from "@/lib/api";
import { toast } from "sonner";
import { canCreateServer } from "@/lib/serverPermissions";
import { formatAppError } from "@/lib/appErrors";
import { openExternalUrl } from "@/lib/desktop";

function ServerIcon({
  active,
  unread,
  mentions,
  iconUrl,
  label,
  children,
  onClick,
}) {
  return (
    <div className="relative flex items-center">
      {unread > 0 && !active && (
        <span
          className={`absolute -left-2 h-5 rounded-r-full transition-all ${
            mentions > 0 ? "w-2.5 bg-[#EF4444] animate-pulse" : "w-1.5 bg-cyan-200/90"
          }`}
        />
      )}
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`server-icon relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-3xl text-lg font-bold text-white transition-all ${
          active ? "active rounded-xl" : "bg-zinc-900/60 hover:bg-cyan-500/90"
        }`}
      >
        {iconUrl ? (
          <img src={iconUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          children
        )}
        {unread > 0 && !active && (
          <span className={`absolute -bottom-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[9px] font-bold ${
            mentions > 0 ? "bg-[#EF4444] text-white" : "bg-cyan-500 text-zinc-950"
          }`}>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </div>
  );
}

export default function ServerSidebar({
  servers,
  currentServer,
  onSelectServer,
  onRefreshServers,
  view,
  onSwitchToDm,
  user,
  dmUnread,
  serverUnreadMap = {},
  onManageServer,
  onDeleteServer,
}) {
  const { t } = useTranslation();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const canCreateNewServer = canCreateServer(user);

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await api.post("/servers", { name: name.trim() });
      toast.success(t("server.serverCreated"));
      setShowCreate(false);
      setName("");
      onRefreshServers?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "onboarding.serverCreateFailed" }));
    } finally {
      setCreating(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="workspace-panel-solid flex h-full w-[72px] shrink-0 flex-col items-center gap-3 py-4 overflow-hidden" data-testid="server-sidebar">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onSwitchToDm}
              data-testid="dm-button"
              className={`server-icon relative flex h-12 w-12 items-center justify-center rounded-3xl transition-all ${
                view === "dm" ? "active rounded-xl" : "bg-zinc-900/60 hover:bg-cyan-500/90"
              }`}
            >
              <ChatCircleDots size={24} weight={view === "dm" ? "fill" : "bold"} className="text-white" />
              {dmUnread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#EF4444] px-1 text-[9px] font-bold text-white">
                  {dmUnread > 9 ? "9+" : dmUnread}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>{t("server.directMessages")}</p></TooltipContent>
        </Tooltip>

        <div className="my-1 h-[2px] w-8 rounded-full bg-white/10" />

        {/* Scrollable server list – max 10 icons visible (~60px each), then scrolls */}
        <div
          data-testid="server-list-scroll"
          className="server-list-scroll flex w-full flex-col items-center gap-3 overflow-y-auto"
          style={{
            maxHeight: "min(600px, calc(100vh - 160px))",
          }}
        >
          {servers.map((server) => {
            const unread = serverUnreadMap?.[server.id]?.count || 0;
            const mentions = serverUnreadMap?.[server.id]?.mentions || 0;
            const active = currentServer?.id === server.id && view === "server";
            const canManageIcon = server.owner_id === user?.id || user?.instance_role === "owner";
            const canDeleteIcon = server.owner_id === user?.id;

            return (
              <Tooltip key={server.id}>
                <ContextMenu>
                  <TooltipTrigger asChild>
                    <ContextMenuTrigger asChild>
                      <div>
                        <ServerIcon
                          active={active}
                          unread={unread}
                          mentions={mentions}
                          iconUrl={server.icon_url}
                          label={server.name}
                          onClick={() => onSelectServer?.(server)}
                        >
                          {server.name.charAt(0).toUpperCase()}
                        </ServerIcon>
                      </div>
                    </ContextMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right"><p>{server.name}</p></TooltipContent>
                  <ContextMenuContent className="w-56">
                    <ContextMenuItem onClick={() => onSelectServer?.(server)}>
                      {t("server.openServer")}
                    </ContextMenuItem>
                    {canManageIcon && (
                      <ContextMenuItem onClick={() => onManageServer?.(server)}>
                        <GearSix size={14} className="mr-2" />
                        {t("server.manageServer")}
                      </ContextMenuItem>
                    )}
                    {canDeleteIcon && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem className="text-red-300 focus:text-red-100" onClick={() => onDeleteServer?.(server)}>
                          <Trash size={14} className="mr-2" />
                          {t("server.deleteServer")}
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              </Tooltip>
            );
          })}
        </div>

        {canCreateNewServer && (
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    data-testid="add-server-button"
                    className="server-icon flex h-12 w-12 items-center justify-center rounded-3xl border border-dashed border-white/10 bg-zinc-900/60 text-cyan-300 transition-all hover:bg-cyan-500 hover:text-zinc-950"
                  >
                    <Plus size={24} weight="bold" />
                  </button>
                </DialogTrigger>
              </TooltipTrigger>
              <TooltipContent side="right"><p>{t("server.addServer")}</p></TooltipContent>
            </Tooltip>
            <DialogContent className="workspace-panel-solid max-w-sm text-white">
              <DialogHeader>
                <DialogTitle style={{ fontFamily: "Manrope" }}>{t("server.createServer")}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="mt-2 space-y-4">
                <div className="space-y-2">
                  <Label className="workspace-section-label">{t("server.serverName")}</Label>
                  <Input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t("server.serverNamePlaceholder")}
                    data-testid="new-server-name-input"
                    className="h-12 rounded-2xl border-white/10 bg-zinc-950/75 text-white focus-visible:border-cyan-400/40 focus-visible:ring-cyan-400/40"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={creating || !name.trim()}
                  data-testid="create-server-submit"
                  className="w-full rounded-2xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300"
                >
                  {creating ? t("server.creating") : t("server.create")}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Repo-Link */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => openExternalUrl("https://github.com/einmalmaik/singra-vox")}
            className="mb-1 flex h-8 w-8 items-center justify-center rounded-full text-zinc-600 transition-colors hover:text-zinc-400"
            data-testid="repo-footer-link"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right"><p>Source Code</p></TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
