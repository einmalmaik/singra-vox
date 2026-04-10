/*
 * Singra Vox - Presentational chat composer
 */
import { At, Paperclip, PaperPlaneRight, X } from "@phosphor-icons/react";

export default function ChatComposer({
  channel,
  canUseE2EEChannel,
  content,
  pendingAttachments,
  sending,
  activeMention,
  activeMentionIndex,
  mentionSuggestions,
  composerInputRef,
  fileInputRef,
  onSubmit,
  onFileUpload,
  onRemoveAttachment,
  onContentChange,
  onInputClick,
  onInputBlur,
  onInputKeyDown,
  onSelectMention,
  t,
}) {
  return (
    <form onSubmit={onSubmit} className="p-4 pt-2" data-testid="message-form">
      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pendingAttachments.map((attachment) => (
            <div key={attachment.id} className="flex items-center gap-2 rounded-md border border-[#27272A] bg-[#121212] px-3 py-2 text-xs text-[#E4E4E7]">
              <Paperclip size={14} className="text-[#71717A]" />
              <span className="max-w-[240px] truncate">{attachment.name}</span>
              <button
                type="button"
                onClick={() => onRemoveAttachment(attachment.id)}
                className="text-[#71717A] transition-colors hover:text-white"
                data-testid={`remove-attachment-${attachment.id}`}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="workspace-input-shell flex items-center gap-2 px-4 py-3">
        <input
          type="file"
          ref={fileInputRef}
          onChange={onFileUpload}
          className="hidden"
          accept="image/*,.pdf,.txt,.zip,.doc,.docx"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          data-testid="file-upload-button"
          disabled={!canUseE2EEChannel}
          className="workspace-icon-button h-10 w-10 shrink-0 disabled:text-[#3F3F46]"
        >
          <Paperclip size={18} />
        </button>
        <input
          ref={composerInputRef}
          value={content}
          onChange={onContentChange}
          onClick={onInputClick}
          onBlur={onInputBlur}
          onKeyDown={onInputKeyDown}
          placeholder={t("chat.messagePlaceholder", { name: channel.name })}
          disabled={!canUseE2EEChannel}
          data-testid="message-input"
          className="flex-1 bg-transparent text-sm text-white placeholder:text-[#52525B] outline-none disabled:text-[#52525B]"
        />
        <button
          type="submit"
          disabled={!canUseE2EEChannel || (!content.trim() && pendingAttachments.length === 0) || sending}
          data-testid="send-message-button"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500 text-zinc-950 transition-colors hover:bg-cyan-400 disabled:bg-zinc-800 disabled:text-[#52525B]"
        >
          <PaperPlaneRight size={20} weight="fill" />
        </button>
      </div>
      {activeMention && mentionSuggestions.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/90 shadow-xl backdrop-blur-xl">
          {mentionSuggestions.map((suggestion, index) => (
            <button
              key={suggestion.key}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelectMention(suggestion)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                index === activeMentionIndex ? "bg-cyan-500/12" : "hover:bg-white/5"
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm text-white">
                  <At size={13} className="text-[#818CF8]" />
                  <span className="truncate">@{suggestion.label}</span>
                </div>
                <div className="truncate text-[11px] text-[#71717A]">{suggestion.description}</div>
              </div>
              {suggestion.type === "role" && (
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: suggestion.color }} />
              )}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
