/*
 * Singra Vox - Pure ChatArea state helpers
 *
 * Keeps timeline derivation and list transforms out of the controller so the
 * chat workspace stays testable without React or network mocking.
 */

export const REACTIONS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F525}", "\u{1F440}", "\u{2705}", "\u{1F602}", "\u{1F914}"];
export const MESSAGE_HIGHLIGHT_DURATION = 2200;

export function mergeMessageIntoTimeline(previousMessages, nextMessage) {
  if (!nextMessage) {
    return previousMessages;
  }

  const mergedMessages = previousMessages.some((message) => message.id === nextMessage.id)
    ? previousMessages.map((message) => (message.id === nextMessage.id ? { ...message, ...nextMessage } : message))
    : [...previousMessages, nextMessage];

  return mergedMessages.slice().sort((left, right) => (
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  ));
}

export function getPinRefreshKey(messages = []) {
  return messages
    .filter((message) => message.is_pinned)
    .map((message) => message.id)
    .sort()
    .join(":");
}

export function getTypingNames(typingUsers = {}) {
  return Object.values(typingUsers || {});
}

export function getReplyTarget({ replyToId, messages = [], replyTargets = {} }) {
  if (!replyToId) {
    return null;
  }

  return messages.find((entry) => entry.id === replyToId) || replyTargets[replyToId] || null;
}

export function buildMessageItems({
  messages = [],
  decryptedPayloads = {},
  replyTargets = {},
  highlightedMessageId = null,
}) {
  return messages.map((message, index) => {
    const previousMessage = messages[index - 1];
    const sameAuthor = previousMessage?.author_id === message.author_id;
    const timeDiffMinutes = previousMessage
      ? (new Date(message.created_at).getTime() - new Date(previousMessage.created_at).getTime()) / 60000
      : Number.POSITIVE_INFINITY;
    const compact = sameAuthor && timeDiffMinutes < 5;
    const decryptedPayload = message.is_e2ee ? decryptedPayloads[message.id] : null;
    const decryptedAttachments = decryptedPayload?.attachments || [];
    const hasDecryptedText = typeof decryptedPayload?.text === "string" && decryptedPayload.text.length > 0;
    const hasDecryptedAttachments = decryptedAttachments.length > 0;

    return {
      ...message,
      compact,
      isHighlighted: highlightedMessageId === message.id,
      replyTarget: getReplyTarget({
        replyToId: message.reply_to_id,
        messages,
        replyTargets,
      }),
      displayContent: message.is_e2ee
        ? (hasDecryptedText ? decryptedPayload.text : (hasDecryptedAttachments ? "" : "Encrypted message"))
        : message.content,
      displayAttachments: message.is_e2ee
        ? decryptedAttachments
        : (message.attachments || []),
    };
  });
}
