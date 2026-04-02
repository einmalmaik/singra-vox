import { useState } from "react";
import { useTranslation } from "react-i18next";
import { UserPlus } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";
import InviteGeneratorPanel from "@/components/invites/InviteGeneratorPanel";

export default function InviteModal({ serverId }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <button className="workspace-icon-button" data-testid="invite-button">
                <UserPlus size={16} weight="bold" />
              </button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>{t("server.invite")}</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DialogContent className="workspace-panel-solid max-w-xl text-white">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: 'Manrope' }}>{t("server.invite")}</DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          <InviteGeneratorPanel serverId={serverId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
