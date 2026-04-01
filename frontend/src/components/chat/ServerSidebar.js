import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, ChatCircleDots } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";
import api, { formatError } from "@/lib/api";
import { toast } from "sonner";
import { canCreateCommunity } from "@/lib/workspacePermissions";

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
}) {
  const { t } = useTranslation();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const canCreateServer = canCreateCommunity(user);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await api.post("/servers", { name: name.trim() });
      toast.success(t("server.serverCreated"));
      setShowCreate(false);
      setName("");
      onRefreshServers();
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail));
    } finally {
      setCreating(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="w-[72px] h-full bg-[#0A0A0A] flex flex-col items-center py-3 gap-2 border-r border-[#27272A]/40 shrink-0" data-testid="server-sidebar">
        {/* DM Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onSwitchToDm}
              data-testid="dm-button"
              className={`server-icon w-12 h-12 rounded-3xl flex items-center justify-center transition-all relative ${
                view === "dm" ? 'active bg-[#6366F1] rounded-xl' : 'bg-[#121212] hover:bg-[#6366F1]'
              }`}
            >
              <ChatCircleDots size={24} weight={view === "dm" ? "fill" : "bold"} className="text-white" />
              {dmUnread > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#EF4444] text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">
                  {dmUnread > 9 ? '9+' : dmUnread}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>{t("server.directMessages")}</p></TooltipContent>
        </Tooltip>

        <div className="w-8 h-[2px] bg-[#27272A] rounded-full my-1" />

        {/* Server Icons */}
        {servers.map(server => (
          <Tooltip key={server.id}>
            <TooltipTrigger asChild>
              <div className="relative flex items-center">
                {serverUnreadMap?.[server.id]?.count > 0 && !(currentServer?.id === server.id && view === "server") && (
                  <span
                    className={`absolute -left-2 h-5 rounded-r-full transition-all ${
                      serverUnreadMap?.[server.id]?.mentions > 0 ? "w-2.5 bg-[#EF4444] animate-pulse" : "w-1.5 bg-white/90"
                    }`}
                  />
                )}
                <button
                  onClick={() => onSelectServer(server)}
                  data-testid={`server-icon-${server.id}`}
                  className={`server-icon relative w-12 h-12 rounded-3xl flex items-center justify-center text-white font-bold text-lg transition-all overflow-hidden ${
                    currentServer?.id === server.id && view === "server" ? 'active bg-[#6366F1] rounded-xl' : 'bg-[#121212] hover:bg-[#6366F1]'
                  }`}
                >
                  {server.icon_url ? (
                    <img src={server.icon_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    server.name.charAt(0).toUpperCase()
                  )}
                  {serverUnreadMap?.[server.id]?.count > 0 && !(currentServer?.id === server.id && view === "server") && (
                    <span className={`absolute -bottom-1 -right-1 min-w-[18px] h-[18px] rounded-full px-1 text-[9px] font-bold flex items-center justify-center ${
                      serverUnreadMap?.[server.id]?.mentions > 0 ? "bg-[#EF4444] text-white" : "bg-[#6366F1] text-white"
                    }`}>
                      {serverUnreadMap?.[server.id]?.count > 99 ? "99+" : serverUnreadMap?.[server.id]?.count}
                    </span>
                  )}
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="right"><p>{server.name}</p></TooltipContent>
          </Tooltip>
        ))}

        {/* Add Server */}
        {canCreateServer && (
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DialogTrigger asChild>
                  <button
                    data-testid="add-server-button"
                    className="server-icon w-12 h-12 rounded-3xl bg-[#121212] flex items-center justify-center text-[#22C55E] hover:bg-[#22C55E] hover:text-white transition-all"
                  >
                    <Plus size={24} weight="bold" />
                  </button>
                </DialogTrigger>
              </TooltipTrigger>
              <TooltipContent side="right"><p>{t("server.addServer")}</p></TooltipContent>
            </Tooltip>
            <DialogContent className="bg-[#18181B] border-[#27272A] text-white max-w-sm">
              <DialogHeader>
                <DialogTitle style={{ fontFamily: "Manrope" }}>{t("server.createServer")}</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-2">
                <div className="space-y-2">
                  <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("server.serverName")}</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("server.serverNamePlaceholder")}
                    data-testid="new-server-name-input"
                    className="bg-[#121212] border-[#27272A] focus:border-[#6366F1] text-white"
                  />
                </div>
                <Button
                  type="submit"
                  disabled={creating || !name.trim()}
                  data-testid="create-server-submit"
                  className="w-full bg-[#6366F1] hover:bg-[#4F46E5]"
                >
                  {creating ? t("server.creating") : t("server.create")}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}

        {/* Spacer + User actions */}
        <div className="flex-1" />
      </div>
    </TooltipProvider>
  );
}
