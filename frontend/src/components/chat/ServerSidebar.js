import { useState } from "react";
import { Plus, ChatCircleDots, GearSix, SignOut } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";
import api from "@/lib/api";
import { toast } from "sonner";

export default function ServerSidebar({ servers, currentServer, onSelectServer, onRefreshServers, view, onSwitchToDm, user, onLogout }) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await api.post("/servers", { name: name.trim() });
      toast.success("Server created!");
      setShowCreate(false);
      setName("");
      onRefreshServers();
    } catch (err) {
      toast.error("Failed to create server");
    } finally {
      setCreating(false);
    }
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="w-[72px] bg-[#0A0A0A] flex flex-col items-center py-3 gap-2 border-r border-[#27272A]/40 shrink-0" data-testid="server-sidebar">
        {/* DM Button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onSwitchToDm}
              data-testid="dm-button"
              className={`server-icon w-12 h-12 rounded-3xl flex items-center justify-center transition-all ${
                view === "dm" ? 'active bg-[#6366F1] rounded-xl' : 'bg-[#121212] hover:bg-[#6366F1]'
              }`}
            >
              <ChatCircleDots size={24} weight={view === "dm" ? "fill" : "bold"} className="text-white" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>Direct Messages</p></TooltipContent>
        </Tooltip>

        <div className="w-8 h-[2px] bg-[#27272A] rounded-full my-1" />

        {/* Server Icons */}
        {servers.map(server => (
          <Tooltip key={server.id}>
            <TooltipTrigger asChild>
              <button
                onClick={() => onSelectServer(server)}
                data-testid={`server-icon-${server.id}`}
                className={`server-icon w-12 h-12 rounded-3xl flex items-center justify-center text-white font-bold text-lg transition-all overflow-hidden ${
                  currentServer?.id === server.id && view === "server" ? 'active bg-[#6366F1] rounded-xl' : 'bg-[#121212] hover:bg-[#6366F1]'
                }`}
              >
                {server.icon_url ? (
                  <img src={server.icon_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  server.name.charAt(0).toUpperCase()
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right"><p>{server.name}</p></TooltipContent>
          </Tooltip>
        ))}

        {/* Add Server */}
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
            <TooltipContent side="right"><p>Add Server</p></TooltipContent>
          </Tooltip>
          <DialogContent className="bg-[#18181B] border-[#27272A] text-white max-w-sm">
            <DialogHeader>
              <DialogTitle style={{ fontFamily: 'Manrope' }}>Create Server</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Server Name</Label>
                <Input
                  value={name} onChange={e => setName(e.target.value)}
                  placeholder="My Server" data-testid="new-server-name-input"
                  className="bg-[#121212] border-[#27272A] focus:border-[#6366F1] text-white"
                />
              </div>
              <Button type="submit" disabled={creating || !name.trim()} data-testid="create-server-submit"
                className="w-full bg-[#6366F1] hover:bg-[#4F46E5]">
                {creating ? "Creating..." : "Create"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        {/* Spacer + User actions */}
        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={onLogout} data-testid="logout-button"
              className="w-12 h-12 rounded-3xl bg-[#121212] flex items-center justify-center text-[#71717A] hover:text-[#EF4444] hover:bg-[#27272A] transition-all">
              <SignOut size={20} weight="bold" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right"><p>Logout</p></TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
