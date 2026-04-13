/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
export const NATIVE_CAPTURE_MODE = {
  FPS: "fps",
  PULL: "pull",
};

/**
 * Verifiziert, dass ein Canvas-Track im Pull-Mode auch wirklich Frames liefert.
 *
 * In WebView2 kann `requestFrame()` vorhanden sein, ohne zuverlässig Frames
 * weiterzureichen. Wir behandeln Pull-Mode deshalb erst als gültig, wenn ein
 * Probe-Video tatsächlich ein Frame empfängt.
 */
export async function verifyCanvasStreamPullMode({
  stream,
  track,
  timeoutMs = 400,
  createVideo = () => document.createElement("video"),
}) {
  if (!stream || !track || typeof track.requestFrame !== "function") {
    return false;
  }

  const video = createVideo();
  if (!video) {
    return false;
  }

  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      video.onloadeddata = null;
      video.onerror = null;
      try {
        video.pause?.();
      } catch {
        // Ignore teardown races in probe-only elements.
      }
      video.srcObject = null;
      resolve(result);
    };

    const confirmFrame = () => {
      if (typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback(() => finish(true));
        return;
      }
      window.setTimeout(() => finish(true), 0);
    };

    const timeoutId = window.setTimeout(() => finish(false), timeoutMs);
    video.onloadeddata = confirmFrame;
    video.onerror = () => finish(false);

    Promise.resolve(video.play?.()).catch(() => null).finally(() => {
      try {
        track.requestFrame();
      } catch {
        finish(false);
      }
    });
  });
}
