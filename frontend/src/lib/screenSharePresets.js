/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
/**
 * Screen-share quality profiles for browser and native desktop publishing.
 *
 * The desktop path treats width/height as an aspect-preserving bounding box.
 * That lets a single preset work for 16:9, ultrawide, 2K and 4K sources
 * without stretching or cropping the output.
 */

function createPreset(id, label, width, height, frameRate, maxBitrate) {
  return Object.freeze({
    id,
    label,
    resolution: Object.freeze({ width, height, frameRate }),
    publish: Object.freeze({
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: Object.freeze({
        maxBitrate,
        maxFramerate: frameRate,
        priority: "high",
      }),
    }),
  });
}

export const AUTO_SCREEN_SHARE_PRESET_ID = "auto";

export const SCREEN_SHARE_PRESETS = Object.freeze({
  "480p30": createPreset("480p30", "480p / 30 FPS", 854, 480, 30, 1_500_000),
  "720p30": createPreset("720p30", "720p / 30 FPS", 1280, 720, 30, 3_000_000),
  "720p60": createPreset("720p60", "720p / 60 FPS", 1280, 720, 60, 5_000_000),
  "1080p30": createPreset("1080p30", "1080p / 30 FPS", 1920, 1080, 30, 8_000_000),
  "1080p60": createPreset("1080p60", "1080p / 60 FPS", 1920, 1080, 60, 12_000_000),
  "1440p30": createPreset("1440p30", "1440p / 30 FPS", 2560, 1440, 30, 14_000_000),
  "1440p60": createPreset("1440p60", "1440p / 60 FPS", 2560, 1440, 60, 18_000_000),
  "2160p30": createPreset("2160p30", "2160p / 30 FPS", 3840, 2160, 30, 24_000_000),
  "2160p60": createPreset("2160p60", "2160p / 60 FPS", 3840, 2160, 60, 32_000_000),
});

const CONCRETE_PRESET_ORDER = Object.freeze([
  "480p30",
  "720p30",
  "720p60",
  "1080p30",
  "1080p60",
  "1440p30",
  "1440p60",
  "2160p30",
  "2160p60",
]);

const DESKTOP_AUTO_PRESET_RULES = Object.freeze([
  { minPixels: 7_500_000, presetId: "2160p30" },
  { minPixels: 3_200_000, presetId: "1440p60" },
  { minPixels: 1_400_000, presetId: "1080p60" },
  { minPixels: 600_000, presetId: "720p60" },
]);

const AUTO_DESKTOP_PRESET_OPTION = Object.freeze({
  id: AUTO_SCREEN_SHARE_PRESET_ID,
  label: "Auto (source-based)",
});

export const DEFAULT_SCREEN_SHARE_PRESET_ID = "1080p60";
export const DEFAULT_NATIVE_SCREEN_SHARE_PRESET_ID = AUTO_SCREEN_SHARE_PRESET_ID;

export const SCREEN_SHARE_PRESET_OPTIONS = Object.freeze(
  CONCRETE_PRESET_ORDER.map((presetId) => ({
    id: presetId,
    label: SCREEN_SHARE_PRESETS[presetId].label,
  })),
);

function isValidSourceDimension(value) {
  return Number.isFinite(value) && value >= 2;
}

function getSourcePixels(source) {
  const width = Number(source?.width);
  const height = Number(source?.height);
  if (!isValidSourceDimension(width) || !isValidSourceDimension(height)) {
    return null;
  }
  return width * height;
}

function getAutoDesktopPresetId(source) {
  const sourcePixels = getSourcePixels(source);
  if (!sourcePixels) {
    return DEFAULT_SCREEN_SHARE_PRESET_ID;
  }

  const matchedRule = DESKTOP_AUTO_PRESET_RULES.find((rule) => sourcePixels >= rule.minPixels);
  return matchedRule?.presetId || "480p30";
}

export function getScreenSharePreset(presetId) {
  return SCREEN_SHARE_PRESETS[presetId] || SCREEN_SHARE_PRESETS[DEFAULT_SCREEN_SHARE_PRESET_ID];
}

export function resolveScreenSharePreset(
  presetId,
  { isDesktop = false, source = null } = {},
) {
  if (presetId === AUTO_SCREEN_SHARE_PRESET_ID) {
    return getScreenSharePreset(
      isDesktop ? getAutoDesktopPresetId(source) : DEFAULT_SCREEN_SHARE_PRESET_ID,
    );
  }

  return getScreenSharePreset(presetId);
}

export function getScreenSharePresetOptions({ isDesktop = false } = {}) {
  return isDesktop
    ? [AUTO_DESKTOP_PRESET_OPTION, ...SCREEN_SHARE_PRESET_OPTIONS]
    : SCREEN_SHARE_PRESET_OPTIONS;
}

export function buildScreenSharePublishOptions(presetId, options = {}) {
  const preset = resolveScreenSharePreset(presetId, options);
  return {
    simulcast: preset.publish.simulcast,
    degradationPreference: preset.publish.degradationPreference,
    screenShareEncoding: {
      ...preset.publish.screenShareEncoding,
    },
  };
}
