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
import api, { formatError } from "@/lib/api";
import { toast } from "sonner";
import { canCreateCommunity } from "@/lib/workspacePermissions";

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
  const canCreateServer = canCreateCommunity(user);

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
      toast.error(formatError(error.response?.data?.detail));
    } finally {
      setCreating(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="workspace-panel-solid flex h-full w-[72px] shrink-0 flex-col items-center gap-3 py-4" data-testid="server-sidebar">
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

        {canCreateServer && (
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

        <div className="flex-1" />
      </div>
    </TooltipProvider>
  );
}
