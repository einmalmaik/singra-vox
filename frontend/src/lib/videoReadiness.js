/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
const MIN_READY_STATE_WITH_FRAME = 2;

function hasRenderableFrame(video) {
  if (!video) {
    return false;
  }

  const hasDimensions = Number(video.videoWidth) > 0 && Number(video.videoHeight) > 0;
  const hasBufferedData = Number(video.readyState || 0) >= MIN_READY_STATE_WITH_FRAME;
  const hasPlaybackProgress = Number(video.currentTime || 0) > 0;

  return hasDimensions && (hasBufferedData || hasPlaybackProgress);
}

/**
 * Beobachtet ein <video>-Element bis der erste tatsächlich renderbare Frame
 * verfügbar ist.
 *
 * WebView2 liefert für synthetische Streams nicht immer verlässliche
 * `loadeddata`-/`playing`-Events. Deshalb kombinieren wir Event-Listener,
 * `requestVideoFrameCallback()` und ein leichtes Polling.
 */
export function observeVideoReadiness(video, onReady, { pollIntervalMs = 250 } = {}) {
  if (!video || typeof onReady !== "function") {
    return () => {};
  }

  let stopped = false;
  let intervalId = null;
  let frameCallbackId = null;

  const cleanup = () => {
    stopped = true;
    if (intervalId) {
      window.clearInterval(intervalId);
    }
    if (frameCallbackId !== null && typeof video.cancelVideoFrameCallback === "function") {
      video.cancelVideoFrameCallback(frameCallbackId);
    }
    readinessEvents.forEach((eventName) => {
      video.removeEventListener?.(eventName, checkReady);
    });
  };

  const finish = () => {
    if (stopped) {
      return;
    }
    cleanup();
    onReady();
  };

  const checkReady = () => {
    if (stopped) {
      return;
    }
    if (hasRenderableFrame(video)) {
      finish();
    }
  };

  const readinessEvents = ["loadedmetadata", "loadeddata", "canplay", "playing", "timeupdate"];
  readinessEvents.forEach((eventName) => {
    video.addEventListener?.(eventName, checkReady);
  });

  intervalId = window.setInterval(checkReady, Math.max(pollIntervalMs, 50));

  if (typeof video.requestVideoFrameCallback === "function") {
    const watchFrame = () => {
      if (stopped) {
        return;
      }
      frameCallbackId = video.requestVideoFrameCallback(() => {
        checkReady();
        watchFrame();
      });
    };
    watchFrame();
  }

  checkReady();
  return cleanup;
}
