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
  it("disables browser-only audio controls for native desktop capture", () => {
    expect(getScreenShareCapabilities({ isDesktop: true })).toEqual({
      supportsSystemAudio: false,
      supportsAudioVolumeControl: false,
    });
  });

  it("keeps browser audio controls enabled for web screen share", () => {
    expect(getScreenShareCapabilities({ isDesktop: false })).toEqual({
      supportsSystemAudio: true,
      supportsAudioVolumeControl: true,
    });
  });
});
