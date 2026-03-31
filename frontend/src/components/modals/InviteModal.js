import { useState } from "react";
import { UserPlus } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";
import InviteGeneratorPanel from "@/components/invites/InviteGeneratorPanel";

export default function InviteModal({ serverId }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
      <DialogContent className="bg-[#18181B] border-[#27272A] text-white max-w-xl">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: 'Manrope' }}>Invite People</DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          <InviteGeneratorPanel serverId={serverId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
