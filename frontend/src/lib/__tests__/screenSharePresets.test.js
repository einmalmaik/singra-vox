/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import {
  AUTO_SCREEN_SHARE_PRESET_ID,
  DEFAULT_SCREEN_SHARE_PRESET_ID,
  buildScreenSharePublishOptions,
  getScreenSharePresetOptions,
  resolveScreenSharePreset,
} from "../screenSharePresets";

describe("screenSharePresets", () => {
  it("exposes auto as a desktop-only preset option", () => {
    expect(getScreenSharePresetOptions({ isDesktop: true })[0]).toEqual({
      id: AUTO_SCREEN_SHARE_PRESET_ID,
      label: "Auto (source-based)",
    });
    expect(
      getScreenSharePresetOptions({ isDesktop: false }).some((option) => option.id === AUTO_SCREEN_SHARE_PRESET_ID),
    ).toBe(false);
  });

  it("maps large desktop sources to a higher preset in auto mode", () => {
    expect(resolveScreenSharePreset(AUTO_SCREEN_SHARE_PRESET_ID, {
      isDesktop: true,
      source: { width: 3840, height: 2160 },
    }).id).toBe("2160p30");

    expect(resolveScreenSharePreset(AUTO_SCREEN_SHARE_PRESET_ID, {
      isDesktop: true,
      source: { width: 2560, height: 1440 },
    }).id).toBe("1440p60");
  });

  it("falls back to the global default preset when auto has no source metadata", () => {
    expect(resolveScreenSharePreset(AUTO_SCREEN_SHARE_PRESET_ID, {
      isDesktop: true,
      source: null,
    }).id).toBe(DEFAULT_SCREEN_SHARE_PRESET_ID);
  });

  it("builds publish options from the resolved preset", () => {
    expect(buildScreenSharePublishOptions(AUTO_SCREEN_SHARE_PRESET_ID, {
      isDesktop: true,
      source: { width: 1920, height: 1080 },
    })).toEqual({
      simulcast: false,
      degradationPreference: "maintain-resolution",
      screenShareEncoding: {
        maxBitrate: 12_000_000,
        maxFramerate: 60,
        priority: "high",
      },
    });
  });
});
