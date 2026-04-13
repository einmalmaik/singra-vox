import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }) => <div>{children}</div>,
  Tooltip: ({ children }) => <div>{children}</div>,
  TooltipTrigger: ({ children }) => <div>{children}</div>,
  TooltipContent: ({ children }) => <div>{children}</div>,
}), { virtual: true });

jest.mock("@/components/chat/NotificationPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="notification-panel-mock" />,
}), { virtual: true });

jest.mock("@/components/modals/SearchDialog", () => ({
  __esModule: true,
  default: () => <div data-testid="search-dialog-mock" />,
}), { virtual: true });

jest.mock("@/components/security/E2EEStatus", () => ({
  __esModule: true,
  default: ({ variant }) => <div data-testid={`e2ee-status-${variant}`} />,
}), { virtual: true });

jest.mock("@/components/chat/chat-area/ChatMessageItem", () => ({
  __esModule: true,
  default: ({ message }) => <div data-testid={`message-item-${message.id}`}>{message.displayContent}</div>,
}), { virtual: true });

jest.mock("@/components/chat/chat-area/ChatComposer", () => ({
  __esModule: true,
  default: () => <div data-testid="chat-composer-shell-mock" />,
}), { virtual: true });

jest.mock("@/components/chat/chat-area/ChatHeader", () => ({
  __esModule: true,
  default: () => <div data-testid="chat-header-shell-mock" />,
}), { virtual: true });

jest.mock("@/components/chat/chat-area/ChatTimeline", () => ({
  __esModule: true,
  default: () => <div data-testid="chat-timeline-shell-mock" />,
}), { virtual: true });

jest.mock("@/components/chat/PinnedMessagesPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="pins-panel-mock" />,
}), { virtual: true });

jest.mock("@/components/chat/ThreadPanel", () => ({
  __esModule: true,
  default: () => <div data-testid="thread-panel-mock" />,
}), { virtual: true });

import ChatAreaShell from "../ChatAreaShell";
import ChatComposer from "../ChatComposer";
import ChatHeader from "../ChatHeader";
import ChatTimeline from "../ChatTimeline";

describe("ChatArea presentational views", () => {
  const t = (key, values) => {
    if (key === "chat.messagePlaceholder") {
      return `Message #${values.name}`;
    }
    if (key === "chat.welcomeToChannel") {
      return `Welcome ${values.name}`;
    }
    if (key === "chat.typing") {
      return `${values.names} typing`;
    }
    return key;
  };

  it("renders the chat header controls with stable ids", () => {
    const markup = renderToStaticMarkup(
      <ChatHeader
        channel={{ id: "channel-1", name: "general", topic: "Roadmap" }}
        serverId="server-1"
        isE2EEChannel={false}
        editingTopic={false}
        topicDraft="Roadmap"
        showPins={false}
        onTopicDraftChange={() => {}}
        onBeginTopicEdit={() => {}}
        onCancelTopicEdit={() => {}}
        onSaveTopic={() => {}}
        onTogglePins={() => {}}
        t={t}
      />,
    );

    expect(markup).toContain("chat-header");
    expect(markup).toContain("topic-display");
    expect(markup).toContain("pins-button");
    expect(markup).toContain("notification-panel-mock");
    expect(markup).toContain("search-dialog-mock");
  });

  it("renders the composer with attachments and mention suggestions", () => {
    const markup = renderToStaticMarkup(
      <ChatComposer
        channel={{ id: "channel-1", name: "general" }}
        canUseE2EEChannel
        content="@ali"
        pendingAttachments={[{ id: "attachment-1", name: "brief.pdf" }]}
        sending={false}
        activeMention={{ query: "ali" }}
        activeMentionIndex={0}
        mentionSuggestions={[{
          key: "user:user-1",
          label: "alice",
          description: "Member",
          type: "user",
        }]}
        composerInputRef={{ current: null }}
        fileInputRef={{ current: null }}
        onSubmit={() => {}}
        onFileUpload={() => {}}
        onRemoveAttachment={() => {}}
        onContentChange={() => {}}
        onInputClick={() => {}}
        onInputBlur={() => {}}
        onInputKeyDown={() => {}}
        onSelectMention={() => {}}
        t={t}
      />,
    );

    expect(markup).toContain("message-form");
    expect(markup).toContain("file-upload-button");
    expect(markup).toContain("message-input");
    expect(markup).toContain("remove-attachment-attachment-1");
    expect(markup).toContain("@alice");
  });

  it("renders the timeline and typing indicator from prepared props", () => {
    const markup = renderToStaticMarkup(
      <ChatTimeline
        channel={{ id: "channel-1", name: "general" }}
        isE2EEChannel={false}
        canUseE2EEChannel
        isDesktopCapable={false}
        e2eeReady
        trustNoticeVisible={false}
        hasOlderMessages
        loadingOlderMessages={false}
        onLoadOlderMessages={() => {}}
        messages={[{
          id: "message-1",
          displayContent: "Hello world",
          created_at: "2026-04-11T10:00:00.000Z",
          author: { display_name: "Alice" },
          author_id: "user-1",
          attachments: [],
          displayAttachments: [],
          reactions: {},
          compact: false,
          isHighlighted: false,
          is_pinned: false,
          thread_count: 0,
        }]}
        typingNames={["Alice"]}
        user={{ id: "user-1" }}
        config={{ assetBase: "" }}
        messagesEndRef={{ current: null }}
        messageRefs={{ current: {} }}
        showReactions={null}
        editingId={null}
        editContent=""
        resolveAvatarUrl={(value) => value}
        onSetEditContent={() => {}}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onSaveEdit={() => {}}
        onDeleteMessage={() => {}}
        onToggleReactionPicker={() => {}}
        onReact={() => {}}
        onOpenThread={() => {}}
        onTogglePin={() => {}}
        onRevealMessage={() => {}}
        onDownloadEncryptedAttachment={() => {}}
        t={t}
      />,
    );

    expect(markup).toContain("messages-list");
    expect(markup).toContain("message-item-message-1");
    expect(markup).toContain("typing-indicator");
    expect(markup).toContain("chat.loadOlderMessages");
  });

  it("renders the shell empty state and auxiliary panels with stable contracts", () => {
    const emptyMarkup = renderToStaticMarkup(
      <ChatAreaShell
        channel={null}
        header={{}}
        timeline={{}}
        composer={{}}
        pinsPanel={{ open: false }}
        threadPanel={{ open: false }}
        t={t}
      />,
    );

    expect(emptyMarkup).toContain("no-channel-selected");

    const activeMarkup = renderToStaticMarkup(
      <ChatAreaShell
        channel={{ id: "channel-1", name: "general" }}
        header={{
          channel: { id: "channel-1", name: "general" },
          serverId: "server-1",
          isE2EEChannel: false,
          editingTopic: false,
          topicDraft: "",
          showPins: true,
          onTopicDraftChange: () => {},
          onBeginTopicEdit: () => {},
          onCancelTopicEdit: () => {},
          onSaveTopic: () => {},
          onTogglePins: () => {},
          t,
        }}
        timeline={{
          channel: { id: "channel-1", name: "general" },
          isE2EEChannel: false,
          canUseE2EEChannel: true,
          isDesktopCapable: false,
          e2eeReady: true,
          trustNoticeVisible: false,
          hasOlderMessages: false,
          loadingOlderMessages: false,
          onLoadOlderMessages: () => {},
          messages: [],
          typingNames: [],
          user: { id: "user-1" },
          config: {},
          messagesEndRef: { current: null },
          messageRefs: { current: {} },
          showReactions: null,
          editingId: null,
          editContent: "",
          resolveAvatarUrl: (value) => value,
          onSetEditContent: () => {},
          onStartEdit: () => {},
          onCancelEdit: () => {},
          onSaveEdit: () => {},
          onDeleteMessage: () => {},
          onToggleReactionPicker: () => {},
          onReact: () => {},
          onOpenThread: () => {},
          onTogglePin: () => {},
          onRevealMessage: () => {},
          onDownloadEncryptedAttachment: () => {},
          t,
        }}
        composer={{
          channel: { id: "channel-1", name: "general" },
          canUseE2EEChannel: true,
          content: "",
          pendingAttachments: [],
          sending: false,
          activeMention: null,
          activeMentionIndex: 0,
          mentionSuggestions: [],
          composerInputRef: { current: null },
          fileInputRef: { current: null },
          onSubmit: () => {},
          onFileUpload: () => {},
          onRemoveAttachment: () => {},
          onContentChange: () => {},
          onInputClick: () => {},
          onInputBlur: () => {},
          onInputKeyDown: () => {},
          onSelectMention: () => {},
          t,
        }}
        pinsPanel={{
          open: true,
          channel: { id: "channel-1" },
          onClose: () => {},
          onJumpToMessage: () => {},
          refreshKey: "pin-1",
        }}
        threadPanel={{
          open: true,
          threadMsgId: "message-1",
          channel: { id: "channel-1" },
          onClose: () => {},
          onReplySent: () => {},
        }}
        t={t}
      />,
    );

    expect(activeMarkup).toContain("chat-area");
    expect(activeMarkup).toContain("chat-header-shell-mock");
    expect(activeMarkup).toContain("chat-timeline-shell-mock");
    expect(activeMarkup).toContain("chat-composer-shell-mock");
    expect(activeMarkup).toContain("pins-panel-mock");
    expect(activeMarkup).toContain("thread-panel-mock");
  });
});
