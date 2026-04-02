import api from "@/lib/api";

export const MESSAGE_HISTORY_PAGE_SIZE = 100;
export const INITIAL_MESSAGE_HISTORY_PAGES = 2;

export function normalizeMessageEnvelope(data) {
  if (Array.isArray(data)) {
    return {
      messages: data,
      nextBefore: data[0]?.created_at || null,
      hasMoreBefore: data.length >= MESSAGE_HISTORY_PAGE_SIZE,
    };
  }

  return {
    messages: Array.isArray(data?.messages) ? data.messages : [],
    nextBefore: data?.next_before || null,
    hasMoreBefore: Boolean(data?.has_more_before),
  };
}

export function mergeTimelineMessages(previousMessages = [], nextMessages = []) {
  const nextById = new Map();
  [...previousMessages, ...nextMessages].forEach((message) => {
    if (message?.id) {
      nextById.set(message.id, message);
    }
  });

  return [...nextById.values()].sort((left, right) => (
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  ));
}

export async function fetchMessageHistoryPage(endpoint, { before = null, limit = MESSAGE_HISTORY_PAGE_SIZE } = {}) {
  const suffix = before
    ? `?before=${encodeURIComponent(before)}&limit=${limit}`
    : `?limit=${limit}`;
  const response = await api.get(`${endpoint}${suffix}`);
  return normalizeMessageEnvelope(response.data);
}

export async function fetchMessageHistoryWindow(
  endpoint,
  {
    before = null,
    limit = MESSAGE_HISTORY_PAGE_SIZE,
    maxPages = INITIAL_MESSAGE_HISTORY_PAGES,
  } = {},
) {
  let cursor = before;
  let messages = [];
  let hasMoreBefore = false;

  for (let page = 0; page < maxPages; page += 1) {
    const envelope = await fetchMessageHistoryPage(endpoint, { before: cursor, limit });
    if (envelope.messages.length === 0) {
      hasMoreBefore = false;
      break;
    }

    messages = mergeTimelineMessages(messages, envelope.messages);
    hasMoreBefore = envelope.hasMoreBefore;
    cursor = envelope.nextBefore || envelope.messages[0]?.created_at || null;

    if (!hasMoreBefore || !cursor) {
      break;
    }
  }

  return {
    messages,
    nextBefore: cursor,
    hasMoreBefore,
  };
}
