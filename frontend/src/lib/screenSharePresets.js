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
 * screenSharePresets.js – Qualitätsprofile für Bildschirmfreigabe
 *
 * Jedes Preset definiert:
 *   - resolution: Breite, Höhe und Framerate für getDisplayMedia / native capture
 *   - publish:    LiveKit-PublishOptions (Bitrate, Simulcast, Degradation)
 *
 * Bitrates sind bewusst großzügig gewählt (≥ 10 Mbps bei Full HD),
 * damit Screen-Share-Inhalte (Text, UI, Spiele) scharf bleiben.
 *
 * Neue Presets einfach hier eintragen – UI und Engine lesen automatisch daraus.
 */

// ─── Preset-Definitionen ───────────────────────────────────────────────────────

export const SCREEN_SHARE_PRESETS = {
  "480p30": {
    id: "480p30",
    label: "480p / 30 FPS",
    resolution: { width: 854, height: 480, frameRate: 30 },
    publish: {
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 1_500_000,   // 1.5 Mbps – ausreichend für 480p
        maxFramerate: 30,
        priority: "high",
      },
    },
  },
  "720p30": {
    id: "720p30",
    label: "720p / 30 FPS",
    resolution: { width: 1280, height: 720, frameRate: 30 },
    publish: {
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 3_000_000,   // 3 Mbps
        maxFramerate: 30,
        priority: "high",
      },
    },
  },
  "720p60": {
    id: "720p60",
    label: "720p / 60 FPS",
    resolution: { width: 1280, height: 720, frameRate: 60 },
    publish: {
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 5_000_000,   // 5 Mbps
        maxFramerate: 60,
        priority: "high",
      },
    },
  },
  "1080p30": {
    id: "1080p30",
    label: "1080p / 30 FPS",
    resolution: { width: 1920, height: 1080, frameRate: 30 },
    publish: {
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 8_000_000,   // 8 Mbps
        maxFramerate: 30,
        priority: "high",
      },
    },
  },
  "1080p60": {
    id: "1080p60",
    label: "1080p / 60 FPS",
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    publish: {
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 12_000_000,  // 12 Mbps – scharf genug für Text + Spiele
        maxFramerate: 60,
        priority: "high",
      },
    },
  },
  "1440p30": {
    id: "1440p30",
    label: "1440p / 30 FPS",
    resolution: { width: 2560, height: 1440, frameRate: 30 },
    publish: {
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 14_000_000,  // 14 Mbps
        maxFramerate: 30,
        priority: "high",
      },
    },
  },
  "1440p60": {
    id: "1440p60",
    label: "1440p / 60 FPS",
    resolution: { width: 2560, height: 1440, frameRate: 60 },
    publish: {
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 18_000_000,  // 18 Mbps – für 2K@60 braucht man Bandbreite
        maxFramerate: 60,
        priority: "high",
      },
    },
  },
};

// ─── Abgeleitete Hilfswerte ────────────────────────────────────────────────────

/** Flache Liste für UI-Dropdowns (id + label) */
export const SCREEN_SHARE_PRESET_OPTIONS = Object.values(SCREEN_SHARE_PRESETS).map((preset) => ({
  id: preset.id,
  label: preset.label,
}));

/** Standard-Preset wenn der Nutzer nichts explizit wählt */
export const DEFAULT_SCREEN_SHARE_PRESET_ID = "1080p60";

/**
 * Der native Desktop-Pfad veröffentlicht Frames direkt über den nativen
 * LiveKit-Publisher. Trotzdem starten wir auf Desktop konservativer, damit
 * CPU- und Bandbreitenbudget auch auf schwächeren Systemen stabil bleiben.
 * Nutzer können das Preset weiterhin manuell erhöhen.
 */
export const DEFAULT_NATIVE_SCREEN_SHARE_PRESET_ID = "720p30";

/**
 * Gibt das vollständige Preset-Objekt zurück.
 * Fällt auf den Default zurück, wenn die ID ungültig ist.
 */
export function getScreenSharePreset(presetId) {
  return SCREEN_SHARE_PRESETS[presetId] || SCREEN_SHARE_PRESETS[DEFAULT_SCREEN_SHARE_PRESET_ID];
}

/**
 * Extrahiert die LiveKit-PublishOptions aus einem Preset.
 * Wird direkt an `room.localParticipant.publishTrack()` übergeben.
 */
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
