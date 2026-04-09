/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
const BROWSER_SCREEN_SHARE_CAPABILITIES = Object.freeze({
  supportsNativeCapture: false,
  supportsSystemAudio: true,
  supportsAudioVolumeControl: true,
  supportsWindowAudio: false,
});

const DESKTOP_NATIVE_SCREEN_SHARE_CAPABILITIES = Object.freeze({
  supportsNativeCapture: true,
  supportsSystemAudio: true,
  supportsAudioVolumeControl: true,
  supportsWindowAudio: false,
});

export function getScreenShareCapabilities({ isDesktop = false, runtimeInfo = null } = {}) {
  if (!isDesktop) {
    return BROWSER_SCREEN_SHARE_CAPABILITIES;
  }

  return {
    ...DESKTOP_NATIVE_SCREEN_SHARE_CAPABILITIES,
    ...(runtimeInfo?.screenShareCapabilities || {}),
  };
}
