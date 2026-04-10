/*
 * Singra Vox - Presentational chat header
 */
import { Hash, PushPin } from "@phosphor-icons/react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import NotificationPanel from "@/components/chat/NotificationPanel";
import SearchDialog from "@/components/modals/SearchDialog";

export default function ChatHeader({
  channel,
  serverId,
  isE2EEChannel,
  editingTopic,
  topicDraft,
  showPins,
  onTopicDraftChange,
  onBeginTopicEdit,
  onCancelTopicEdit,
  onSaveTopic,
  onTogglePins,
  t,
}) {
  return (
    <div className="h-14 flex items-center justify-between px-5 border-b workspace-divider shrink-0 bg-zinc-900/25" data-testid="chat-header">
      <div className="flex items-center min-w-0 flex-1">
        <Hash size={20} weight="bold" className="text-cyan-400 mr-2 shrink-0" />
        <h3 className="text-base font-bold text-white shrink-0" style={{ fontFamily: "Manrope" }}>{channel.name}</h3>
        {editingTopic ? (
          <div className="flex items-center gap-1 ml-3 border-l border-[#27272A] pl-3 flex-1 min-w-0">
            <input
              value={topicDraft}
              onChange={(event) => onTopicDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSaveTopic();
                if (event.key === "Escape") onCancelTopicEdit();
              }}
              className="flex-1 rounded-lg border border-white/10 bg-zinc-950/60 px-2 py-1 text-xs text-white outline-none"
              autoFocus
              data-testid="topic-edit-input"
            />
            <button onClick={onSaveTopic} className="text-cyan-400 text-xs font-medium">{t("common.save")}</button>
            <button onClick={onCancelTopicEdit} className="text-[#71717A] text-xs">{t("common.cancel")}</button>
          </div>
        ) : channel.topic ? (
          <button
            onClick={() => onBeginTopicEdit(channel.topic)}
            className="ml-3 text-xs text-[#71717A] truncate border-l workspace-divider pl-3 hidden md:inline hover:text-[#A1A1AA] transition-colors"
            data-testid="topic-display"
          >
            {channel.topic}
          </button>
        ) : (
          <button
            onClick={() => onBeginTopicEdit("")}
            className="ml-3 text-xs text-[#52525B] border-l workspace-divider pl-3 hidden md:inline hover:text-[#71717A] transition-colors"
          >
            {t("chat.setTopic")}
          </button>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onTogglePins}
                data-testid="pins-button"
                className={`workspace-icon-button ${showPins ? "text-[#F59E0B] border-amber-500/20 bg-amber-500/10" : ""}`}
              >
                <PushPin size={16} weight={showPins ? "fill" : "bold"} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p>{t("chat.pinnedMessages")}</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <NotificationPanel />
        {!isE2EEChannel && <SearchDialog serverId={serverId} />}
      </div>
    </div>
  );
}
