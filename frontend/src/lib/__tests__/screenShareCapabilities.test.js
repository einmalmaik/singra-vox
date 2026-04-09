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
  it("keeps desktop defaults conservative until the runtime bridge reports capabilities", () => {
    expect(getScreenShareCapabilities({ isDesktop: true })).toEqual({
      supportsNativeCapture: false,
      supportsSystemAudio: false,
      supportsAudioVolumeControl: false,
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
          supportsNativeCapture: true,
          supportsSystemAudio: false,
          supportsAudioVolumeControl: false,
          supportsWindowAudio: true,
        },
      },
    })).toEqual({
      supportsNativeCapture: true,
      supportsSystemAudio: false,
      supportsAudioVolumeControl: false,
      supportsWindowAudio: true,
    });
  });

  it("uses the runtime bridge as the only desktop truth source for Windows", () => {
    expect(getScreenShareCapabilities({
      isDesktop: true,
      runtimeInfo: {
        screenShareCapabilities: {
          supportsNativeCapture: true,
          supportsSystemAudio: true,
          supportsAudioVolumeControl: true,
          supportsWindowAudio: false,
        },
      },
    })).toEqual({
      supportsNativeCapture: true,
      supportsSystemAudio: true,
      supportsAudioVolumeControl: true,
      supportsWindowAudio: false,
    });
  });

  it("keeps unsupported Linux options disabled when the runtime bridge says so", () => {
    expect(getScreenShareCapabilities({
      isDesktop: true,
      runtimeInfo: {
        screenShareCapabilities: {
          supportsNativeCapture: false,
          supportsSystemAudio: false,
          supportsAudioVolumeControl: false,
          supportsWindowAudio: false,
        },
      },
    })).toEqual({
      supportsNativeCapture: false,
      supportsSystemAudio: false,
      supportsAudioVolumeControl: false,
      supportsWindowAudio: false,
    });
  });
});
