/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { getScreenShareCapabilities } from "../screenShareCapabilities";

describe("screenShareCapabilities", () => {
  it("exposes native desktop capture defaults", () => {
    expect(getScreenShareCapabilities({ isDesktop: true })).toEqual({
      supportsNativeCapture: true,
      supportsSystemAudio: true,
      supportsAudioVolumeControl: true,
      supportsWindowAudio: false,
    });
  });

  it("keeps browser audio controls enabled for web screen share", () => {
    expect(getScreenShareCapabilities({ isDesktop: false })).toEqual({
      supportsNativeCapture: false,
      supportsSystemAudio: true,
      supportsAudioVolumeControl: true,
      supportsWindowAudio: false,
    });
  });

  it("merges runtime overrides from the desktop bridge", () => {
    expect(getScreenShareCapabilities({
      isDesktop: true,
      runtimeInfo: {
        screenShareCapabilities: {
          supportsSystemAudio: false,
          supportsWindowAudio: true,
        },
      },
    })).toEqual({
      supportsNativeCapture: true,
      supportsSystemAudio: false,
      supportsAudioVolumeControl: true,
      supportsWindowAudio: true,
    });
  });
});
