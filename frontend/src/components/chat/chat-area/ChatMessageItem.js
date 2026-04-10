/*
 * Singra Vox - Presentational chat message item
 */
import {
  ChatText,
  Pencil,
  PushPin,
  PushPinSlash,
  Trash,
} from "@phosphor-icons/react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AttachmentRenderer } from "@/components/chat/AttachmentRenderer";
import MessageReferencePreview from "@/components/chat/MessageReferencePreview";
import { REACTIONS } from "@/components/chat/chat-area/chatAreaState";
import { renderMessageContent } from "@/lib/messageMentions";

export default function ChatMessageItem({
  message,
  config,
  currentUserId,
  showReactions,
  editingId,
  editContent,
  resolveAvatarUrl,
  onSetEditContent,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDeleteMessage,
  onToggleReactionPicker,
  onReact,
  onOpenThread,
  onTogglePin,
  onRevealMessage,
  onDownloadEncryptedAttachment,
  registerMessageRef,
  t,
}) {
  return (
    <div
      ref={registerMessageRef}
      className={`message-item group relative flex gap-3 rounded-2xl px-3 py-2 transition-[background-color,box-shadow,border-color] ${
        message.compact ? "mt-0" : "mt-3"
      } ${
        message.isHighlighted
          ? "bg-[#221A10] shadow-[0_0_0_1px_rgba(245,158,11,0.35),0_0_32px_rgba(245,158,11,0.12)]"
          : "hover:bg-white/[0.03]"
      }`}
      data-testid={`message-${message.id}`}
    >
      {!message.compact ? (
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-zinc-800/80 text-sm font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
          {message.author?.avatar_url ? (
            <img
              src={resolveAvatarUrl(message.author.avatar_url)}
              alt={message.author?.display_name || message.author?.username || "avatar"}
              className="h-full w-full object-cover"
            />
          ) : (
            message.author?.display_name?.[0]?.toUpperCase() || "?"
          )}
        </div>
      ) : (
        <div className="w-10 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        {!message.compact && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-sm font-semibold" style={{ color: message.author?.role === "admin" ? "#E74C3C" : "#FFFFFF" }}>
              {message.author?.display_name || message.author?.username || t("common.unknown")}
            </span>
            <span className="text-[10px] text-[#52525B]">
              {new Date(message.created_at).toLocaleString()}
            </span>
            {message.edited_at && <span className="text-[10px] text-[#52525B]">{t("chat.edited")}</span>}
          </div>
        )}

        {editingId === message.id ? (
          <div className="flex gap-2">
            <input
              value={editContent}
              onChange={(event) => onSetEditContent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSaveEdit(message.id);
                if (event.key === "Escape") onCancelEdit();
              }}
              className="flex-1 bg-[#27272A] rounded px-2 py-1 text-sm text-white outline-none"
              data-testid="edit-message-input"
              autoFocus
            />
            <button onClick={() => onSaveEdit(message.id)} className="text-[#6366F1] text-xs font-medium">{t("common.save")}</button>
            <button onClick={onCancelEdit} className="text-[#71717A] text-xs">{t("common.cancel")}</button>
          </div>
        ) : (
          <>
            {message.reply_to_id && (
              <div className="mb-2 max-w-[540px]">
                <MessageReferencePreview
                  message={message.replyTarget}
                  placeholder={t("chat.originalUnavailable")}
                  onClick={message.replyTarget?.id ? () => onRevealMessage(message.replyTarget.id) : undefined}
                />
              </div>
            )}
            {message.is_pinned && (
              <div className="flex items-center gap-1 text-[10px] text-[#F59E0B] mb-0.5">
                <PushPin size={10} weight="fill" /> {t("chat.pinned")}
              </div>
            )}
            {message.displayContent ? (
              <p className="text-sm text-[#E4E4E7] break-words whitespace-pre-wrap">
                {renderMessageContent(message.displayContent, message)}
              </p>
            ) : null}

            {message.displayAttachments?.length > 0 && (
              <div className="mt-2 space-y-1">
                {message.displayAttachments.map((attachment, index) => (
                  <div key={attachment?.blob_id || attachment?.id || index}>
                    <AttachmentRenderer
                      attachment={attachment}
                      isE2EE={message.is_e2ee}
                      assetBase={config?.assetBase || ""}
                      onDownload={onDownloadEncryptedAttachment}
                    />
                  </div>
                ))}
              </div>
            )}

            {message.reactions && Object.keys(message.reactions).length > 0 && (
              <div className="flex gap-1 mt-1.5 flex-wrap">
                {Object.entries(message.reactions).map(([emoji, users]) => (
                  <button
                    key={emoji}
                    onClick={() => onReact(message.id, emoji)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
                      users.includes(currentUserId)
                        ? "bg-cyan-500/14 border-cyan-400/40 text-cyan-300"
                        : "bg-zinc-900/65 border-white/10 text-[#A1A1AA] hover:border-cyan-400/30"
                    }`}
                  >
                    <span>{emoji}</span><span>{users.length}</span>
                  </button>
                ))}
              </div>
            )}

            {(message.thread_count > 0) && (
              <button
                onClick={() => onOpenThread(message.id)}
                data-testid={`thread-btn-${message.id}`}
                className="mt-1.5 flex items-center gap-1.5 text-cyan-300 text-xs font-medium hover:text-cyan-200 transition-colors"
              >
                <ChatText size={14} weight="bold" />
                {t("thread.replyCount", { count: message.thread_count })}
              </button>
            )}
          </>
        )}
      </div>

      <div className="absolute right-2 -top-3 hidden group-hover:flex bg-zinc-950/90 border border-white/10 rounded-xl overflow-hidden shadow-xl z-10 backdrop-blur-xl">
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onToggleReactionPicker(message.id)}
                className="px-1.5 py-1 hover:bg-[#27272A] transition-colors text-[#A1A1AA] hover:text-white"
              >
                <span className="text-xs">+</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><p>{t("chat.react")}</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onOpenThread(message.id)}
                data-testid={`open-thread-${message.id}`}
                className="px-1.5 py-1 hover:bg-[#27272A] transition-colors text-[#A1A1AA] hover:text-white"
              >
                <ChatText size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top"><p>{t("chat.replyInThread")}</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {message.author_id === currentUserId && !message.is_e2ee && (
          <>
            <button
              onClick={() => onStartEdit(message)}
              className="px-1.5 py-1 hover:bg-[#27272A] transition-colors"
              data-testid={`edit-msg-${message.id}`}
            >
              <Pencil size={14} className="text-[#A1A1AA]" />
            </button>
            <button
              onClick={() => onDeleteMessage(message.id)}
              className="px-1.5 py-1 hover:bg-[#EF4444]/20 transition-colors"
              data-testid={`delete-msg-${message.id}`}
            >
              <Trash size={14} className="text-[#EF4444]" />
            </button>
          </>
        )}
        <button
          onClick={() => onTogglePin(message)}
          data-testid={`pin-msg-${message.id}`}
          className={`px-1.5 py-1 hover:bg-[#27272A] transition-colors ${message.is_pinned ? "text-[#F59E0B]" : "text-[#A1A1AA]"}`}
        >
          {message.is_pinned ? <PushPinSlash size={14} /> : <PushPin size={14} />}
        </button>
      </div>

      {showReactions && (
        <div className="absolute right-2 top-6 bg-zinc-950/90 border border-white/10 rounded-xl p-2 flex gap-1 flex-wrap w-48 z-20 shadow-xl backdrop-blur-xl">
          {REACTIONS.map((reaction) => (
            <button
              key={reaction}
              onClick={() => onReact(message.id, reaction)}
              className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#27272A] text-base transition-colors"
            >
              {reaction}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
