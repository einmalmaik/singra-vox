/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { observeVideoReadiness } from "../videoReadiness";

function createMockVideo(overrides = {}) {
  const listeners = new Map();

  return {
    videoWidth: 0,
    videoHeight: 0,
    readyState: 0,
    currentTime: 0,
    requestVideoFrameCallback: undefined,
    cancelVideoFrameCallback: jest.fn(),
    addEventListener: jest.fn((eventName, handler) => {
      listeners.set(eventName, handler);
    }),
    removeEventListener: jest.fn((eventName) => {
      listeners.delete(eventName);
    }),
    emit(eventName) {
      listeners.get(eventName)?.();
    },
    ...overrides,
  };
}

describe("observeVideoReadiness", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it("marks the video as ready when media events arrive with frame data", () => {
    const onReady = jest.fn();
    const video = createMockVideo();

    observeVideoReadiness(video, onReady, { pollIntervalMs: 100 });

    video.videoWidth = 1920;
    video.videoHeight = 1080;
    video.readyState = 3;
    video.emit("loadeddata");

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("falls back to polling when no media event fires", () => {
    const onReady = jest.fn();
    const video = createMockVideo();

    observeVideoReadiness(video, onReady, { pollIntervalMs: 100 });

    video.videoWidth = 1280;
    video.videoHeight = 720;
    video.readyState = 2;

    jest.advanceTimersByTime(120);

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("treats requestVideoFrameCallback as a definitive rendered-frame signal", () => {
    const onReady = jest.fn();
    let frameCallback = null;
    const video = createMockVideo({
      requestVideoFrameCallback: jest.fn((callback) => {
        frameCallback = callback;
        return 1;
      }),
    });

    observeVideoReadiness(video, onReady, { pollIntervalMs: 100 });
    frameCallback?.();

    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
