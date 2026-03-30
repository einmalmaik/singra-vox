import { useState } from "react";
import { UserPlus, Copy, Check } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";
import api from "@/lib/api";
import { toast } from "sonner";

export default function InviteModal({ serverId }) {
  const [open, setOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const generateInvite = async () => {
    setLoading(true);
    try {
      const res = await api.post(`/servers/${serverId}/invites`, { max_uses: 0, expires_hours: 24 });
      setInviteCode(res.data.code);
    } catch {
      toast.error("Failed to create invite");
    } finally {
      setLoading(false);
    }
  };

  const copyInvite = () => {
    const link = `${window.location.origin}/invite/${inviteCode}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    toast.success("Invite link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) generateInvite(); }}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <button className="p-1 rounded hover:bg-[#27272A] text-[#71717A] hover:text-white transition-colors" data-testid="invite-button">
                <UserPlus size={16} weight="bold" />
              </button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>Invite People</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DialogContent className="bg-[#18181B] border-[#27272A] text-white max-w-sm">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: 'Manrope' }}>Invite People</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          {inviteCode ? (
            <div className="space-y-3">
              <p className="text-sm text-[#A1A1AA]">Share this link to invite people:</p>
              <div className="flex gap-2">
                <Input
                  value={`${window.location.origin}/invite/${inviteCode}`}
                  readOnly data-testid="invite-link-input"
                  className="bg-[#121212] border-[#27272A] text-white text-xs"
                />
                <Button onClick={copyInvite} size="sm" data-testid="copy-invite-button"
                  className="bg-[#6366F1] hover:bg-[#4F46E5] shrink-0">
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                </Button>
              </div>
              <p className="text-xs text-[#71717A]">This invite expires in 24 hours.</p>
            </div>
          ) : (
            <div className="flex items-center justify-center py-6">
              <div className="w-6 h-6 border-2 border-[#6366F1] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
