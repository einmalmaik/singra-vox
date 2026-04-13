/*
 * Singra Vox - Presentational chat timeline
 */
import { Hash } from "@phosphor-icons/react";
import E2EEStatus from "@/components/security/E2EEStatus";
import ChatMessageItem from "@/components/chat/chat-area/ChatMessageItem";

export default function ChatTimeline({
  channel,
  isE2EEChannel,
  canUseE2EEChannel,
  isDesktopCapable,
  e2eeReady,
  trustNoticeVisible,
  hasOlderMessages,
  loadingOlderMessages,
  onLoadOlderMessages,
  messages,
  typingNames,
  user,
  config,
  messagesEndRef,
  messageRefs,
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
  t,
}) {
  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 py-4" data-testid="messages-list">
        {isE2EEChannel && !canUseE2EEChannel && (
          <E2EEStatus
            variant="guard"
            scope="private_channel"
            ready={e2eeReady}
            isDesktopCapable={isDesktopCapable}
            className="workspace-card mx-auto mt-8 max-w-xl p-6"
          />
        )}
        {isE2EEChannel && canUseE2EEChannel && trustNoticeVisible && (
          <E2EEStatus
            variant="notice"
            messageKey="e2ee.deviceListChanged"
            className="workspace-card mx-auto mt-4 max-w-xl"
          />
        )}
        {canUseE2EEChannel && hasOlderMessages && (
          <div className="mb-4 flex justify-center">
            <button
              type="button"
              onClick={() => void onLoadOlderMessages?.()}
              disabled={loadingOlderMessages}
              className="rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingOlderMessages ? t("common.loading") : t("chat.loadOlderMessages")}
            </button>
          </div>
        )}
        {canUseE2EEChannel && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-[#71717A]">
            <Hash size={48} weight="bold" className="mb-4 opacity-30 text-cyan-400" />
            <p className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("chat.welcomeToChannel", { name: channel.name })}</p>
            <p className="text-sm">{t("chat.startOfChannel")}</p>
          </div>
        )}

        {canUseE2EEChannel && messages.map((message) => (
          <ChatMessageItem
            key={message.id}
            message={message}
            config={config}
            currentUserId={user?.id}
            showReactions={showReactions === message.id}
            editingId={editingId}
            editContent={editContent}
            resolveAvatarUrl={resolveAvatarUrl}
            onSetEditContent={onSetEditContent}
            onStartEdit={onStartEdit}
            onCancelEdit={onCancelEdit}
            onSaveEdit={onSaveEdit}
            onDeleteMessage={onDeleteMessage}
            onToggleReactionPicker={onToggleReactionPicker}
            onReact={onReact}
            onOpenThread={onOpenThread}
            onTogglePin={onTogglePin}
            onRevealMessage={onRevealMessage}
            onDownloadEncryptedAttachment={onDownloadEncryptedAttachment}
            registerMessageRef={(node) => {
              if (node) {
                messageRefs.current[message.id] = node;
              } else {
                delete messageRefs.current[message.id];
              }
            }}
            t={t}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {typingNames.length > 0 && (
        <div className="px-4 py-1 text-xs text-[#71717A]" data-testid="typing-indicator">
          <span className="typing-dot inline-block w-1 h-1 bg-[#71717A] rounded-full mr-0.5" />
          <span className="typing-dot inline-block w-1 h-1 bg-[#71717A] rounded-full mr-0.5" />
          <span className="typing-dot inline-block w-1 h-1 bg-[#71717A] rounded-full mr-2" />
          {t("chat.typing", { names: typingNames.join(", "), count: typingNames.length })}
        </div>
      )}
    </>
  );
}
