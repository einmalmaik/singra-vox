const DEFAULT_VOICE_PREFERENCES = {
  inputDeviceId: "",
  outputDeviceId: "",
  inputVolume: 100,
  outputVolume: 100,
  perUserVolumes: {},
  locallyMutedParticipants: {},
  pttEnabled: false,
  pttKey: "Space",
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
  return nextPreferences;
}

export function clearVoicePreferences(userId = "default") {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getStorageKey(userId));
}
