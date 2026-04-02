import { describePttShortcut, normalizePttShortcut } from "@/lib/pttShortcut";

const VOICE_PREFERENCES_EVENT = "singravox:voice-preferences-updated";

const DEFAULT_VOICE_PREFERENCES = {
  inputDeviceId: "",
  outputDeviceId: "",
  cameraDeviceId: "",
  inputVolume: 100,
  outputVolume: 100,
  perUserVolumes: {},
  locallyMutedParticipants: {},
  selfMuteEnabled: false,
  selfDeafenEnabled: false,
  pttEnabled: false,
  pttKey: "Space",
  pttLabel: "Space",
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  inputSensitivity: 40,
  autoInputSensitivity: true,
  micTestEnabled: false,
};

function getStorageKey(userId = "default") {
  return `singravox.voice.preferences.${userId}`;
}

function emitVoicePreferencesUpdated(userId, preferences) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(VOICE_PREFERENCES_EVENT, {
    detail: {
      userId: userId || "default",
      preferences,
    },
  }));
}

export function getDefaultVoicePreferences() {
  return {
    ...DEFAULT_VOICE_PREFERENCES,
    perUserVolumes: {},
  };
}

export function normalizeVoicePreferences(preferences = {}, { isDesktop = true } = {}) {
  const normalized = {
    ...getDefaultVoicePreferences(),
    ...preferences,
    perUserVolumes: {
      ...getDefaultVoicePreferences().perUserVolumes,
      ...(preferences?.perUserVolumes || {}),
    },
    locallyMutedParticipants: {
      ...getDefaultVoicePreferences().locallyMutedParticipants,
      ...(preferences?.locallyMutedParticipants || {}),
    },
  };

  normalized.pttKey = normalizePttShortcut(normalized.pttKey) || "Space";
  normalized.pttLabel = normalized.pttLabel || describePttShortcut(normalized.pttKey, {
    locale: typeof document !== "undefined" ? document.documentElement.lang || "en" : "en",
  });

  if (!isDesktop) {
    normalized.pttEnabled = false;
  }

  return normalized;
}

export function loadVoicePreferences(userId = "default", options = {}) {
  if (typeof window === "undefined") {
    return normalizeVoicePreferences({}, options);
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey(userId));
    if (!raw) {
      return normalizeVoicePreferences({}, options);
    }

    const parsed = JSON.parse(raw);
    return normalizeVoicePreferences(parsed, options);
  } catch {
    return normalizeVoicePreferences({}, options);
  }
}

export function saveVoicePreferences(userId = "default", preferences = {}, options = {}) {
  if (typeof window === "undefined") {
    return normalizeVoicePreferences({}, options);
  }

  const currentPreferences = loadVoicePreferences(userId, options);
  const nextPreferences = normalizeVoicePreferences(
    {
      ...currentPreferences,
      ...preferences,
      perUserVolumes: {
        ...currentPreferences.perUserVolumes,
        ...(preferences?.perUserVolumes || {}),
      },
      locallyMutedParticipants: {
        ...currentPreferences.locallyMutedParticipants,
        ...(preferences?.locallyMutedParticipants || {}),
      },
    },
    options,
  );

  window.localStorage.setItem(getStorageKey(userId), JSON.stringify(nextPreferences));
  emitVoicePreferencesUpdated(userId, nextPreferences);
  return nextPreferences;
}

export function clearVoicePreferences(userId = "default") {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getStorageKey(userId));
  emitVoicePreferencesUpdated(userId, normalizeVoicePreferences({}, {}));
}

export function subscribeVoicePreferences(userId = "default", callback) {
  if (typeof window === "undefined" || typeof callback !== "function") {
    return () => {};
  }

  const targetUserId = userId || "default";
  const handler = (event) => {
    if (event?.detail?.userId !== targetUserId) {
      return;
    }
    callback(event.detail.preferences);
  };

  window.addEventListener(VOICE_PREFERENCES_EVENT, handler);
  return () => {
    window.removeEventListener(VOICE_PREFERENCES_EVENT, handler);
  };
}
