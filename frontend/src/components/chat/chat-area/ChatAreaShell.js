/*
 * Singra Vox - Chat area shell
 */
import PinnedMessagesPanel from "@/components/chat/PinnedMessagesPanel";
import ThreadPanel from "@/components/chat/ThreadPanel";
import ChatComposer from "@/components/chat/chat-area/ChatComposer";
import ChatHeader from "@/components/chat/chat-area/ChatHeader";
import ChatTimeline from "@/components/chat/chat-area/ChatTimeline";

export default function ChatAreaShell({ channel, header, timeline, composer, pinsPanel, threadPanel, t }) {
  if (!channel) {
    return (
      <div className="flex-1 flex items-center justify-center bg-transparent text-[#71717A]" data-testid="no-channel-selected">
        <p>{t("chat.selectChannel")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-w-0 min-h-0" data-testid="chat-area">
      <div className="flex-1 flex flex-col bg-transparent min-w-0 min-h-0">
        <ChatHeader {...header} />
        <ChatTimeline {...timeline} />
        <ChatComposer {...composer} />
      </div>

      {pinsPanel.open && (
        <PinnedMessagesPanel
          channel={pinsPanel.channel}
          channelId={pinsPanel.channel.id}
          onClose={pinsPanel.onClose}
          onJumpToMessage={pinsPanel.onJumpToMessage}
          refreshKey={pinsPanel.refreshKey}
        />
      )}

      {threadPanel.open && (
        <ThreadPanel
          messageId={threadPanel.threadMsgId}
          channelId={threadPanel.channel.id}
          channel={threadPanel.channel}
          onClose={threadPanel.onClose}
          onReplySent={threadPanel.onReplySent}
        />
      )}
    </div>
  );
}
