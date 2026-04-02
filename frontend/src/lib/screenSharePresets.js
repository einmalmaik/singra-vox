export const SCREEN_SHARE_PRESETS = {
  "480p30": {
    id: "480p30",
    label: "480p / 30 FPS",
    resolution: {
      width: 854,
      height: 480,
      frameRate: 30,
    },
    publish: {
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 1_200_000,
        maxFramerate: 30,
        priority: "high",
      },
    },
  },
  "720p30": {
    id: "720p30",
    label: "720p / 30 FPS",
    resolution: {
      width: 1280,
      height: 720,
      frameRate: 30,
    },
    publish: {
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 2_500_000,
        maxFramerate: 30,
        priority: "high",
      },
    },
  },
  "1080p30": {
    id: "1080p30",
    label: "1080p / 30 FPS",
    resolution: {
      width: 1920,
      height: 1080,
      frameRate: 30,
    },
    publish: {
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 5_500_000,
        maxFramerate: 30,
        priority: "high",
      },
    },
  },
  "1080p60": {
    id: "1080p60",
    label: "1080p / 60 FPS",
    resolution: {
      width: 1920,
      height: 1080,
      frameRate: 60,
    },
    publish: {
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 9_000_000,
        maxFramerate: 60,
        priority: "high",
      },
    },
  },
};

export const SCREEN_SHARE_PRESET_OPTIONS = Object.values(SCREEN_SHARE_PRESETS).map((preset) => ({
  id: preset.id,
  label: preset.label,
}));

export const DEFAULT_SCREEN_SHARE_PRESET_ID = "1080p30";

export function getScreenSharePreset(presetId) {
  return SCREEN_SHARE_PRESETS[presetId] || SCREEN_SHARE_PRESETS[DEFAULT_SCREEN_SHARE_PRESET_ID];
}

export function buildScreenSharePublishOptions(presetId) {
  const preset = getScreenSharePreset(presetId);
  return {
    simulcast: preset.publish.simulcast,
    degradationPreference: preset.publish.degradationPreference,
    screenShareEncoding: {
      ...preset.publish.screenShareEncoding,
    },
  };
}
