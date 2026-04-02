const STORAGE_PREFIX = "singravox.chat";
const MAX_CACHED_MESSAGES = 250;

function getStorage() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function getScopedKey(userId, suffix) {
  return `${STORAGE_PREFIX}.${userId}.${suffix}`;
}

function readJson(key, fallback) {
  const storage = getStorage();
  if (!storage) {
    return fallback;
  }

  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // Local cache is only a resilience layer. If storage is full or blocked,
    // the live backend timeline still remains the source of truth.
  }
}

function trimMessages(messages = []) {
  if (!Array.isArray(messages)) {
    return [];
  }

  // Keep a recent window locally so reloads and transient fetch failures restore
  // a useful timeline without exhausting localStorage on large communities.
  return messages.slice(-MAX_CACHED_MESSAGES);
}

export function getPersistedWorkspaceState(userId) {
  if (!userId) {
    return {
      view: "server",
      serverId: null,
      channelId: null,
      dmUserId: null,
    };
  }

  return {
    view: "server",
    serverId: null,
    channelId: null,
    dmUserId: null,
    ...readJson(getScopedKey(userId, "workspace"), {}),
  };
}

export function setPersistedWorkspaceState(userId, nextState) {
  if (!userId) {
    return;
  }
  writeJson(getScopedKey(userId, "workspace"), nextState);
}

export function getCachedChannelMessages(userId, channelId) {
  if (!userId || !channelId) {
    return [];
  }
  return readJson(getScopedKey(userId, `channel.${channelId}`), []);
}

export function setCachedChannelMessages(userId, channelId, messages) {
  if (!userId || !channelId) {
    return;
  }
  writeJson(getScopedKey(userId, `channel.${channelId}`), trimMessages(messages));
}

export function getCachedDmMessages(userId, dmUserId) {
  if (!userId || !dmUserId) {
    return [];
  }
  return readJson(getScopedKey(userId, `dm.${dmUserId}`), []);
}

export function setCachedDmMessages(userId, dmUserId, messages) {
  if (!userId || !dmUserId) {
    return;
  }
  writeJson(getScopedKey(userId, `dm.${dmUserId}`), trimMessages(messages));
}
