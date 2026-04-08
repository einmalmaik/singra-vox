/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { verifyCanvasStreamPullMode } from "../nativeCaptureProbe";

describe("verifyCanvasStreamPullMode", () => {
  it("returns false when requestFrame is present but no frame ever arrives", async () => {
    const track = { requestFrame: jest.fn() };
    const video = {
      play: jest.fn().mockResolvedValue(undefined),
      pause: jest.fn(),
      requestVideoFrameCallback: jest.fn(),
      srcObject: null,
      onloadeddata: null,
      onerror: null,
    };

    const result = await verifyCanvasStreamPullMode({
      stream: { id: "stream-1" },
      track,
      timeoutMs: 20,
      createVideo: () => video,
    });

    expect(result).toBe(false);
    expect(track.requestFrame).toHaveBeenCalledTimes(1);
    expect(video.pause).toHaveBeenCalledTimes(1);
  });

  it("returns true once the probe video renders a frame", async () => {
    const track = { requestFrame: jest.fn() };
    let videoRef = null;
    const createVideo = () => {
      const video = {
        play: jest.fn().mockImplementation(async () => {
          setTimeout(() => {
            video.onloadeddata?.();
          }, 0);
        }),
        pause: jest.fn(),
        requestVideoFrameCallback: jest.fn((callback) => {
          setTimeout(() => callback(0, {}), 0);
        }),
        srcObject: null,
        onloadeddata: null,
        onerror: null,
      };
      videoRef = video;
      return video;
    };

    const result = await verifyCanvasStreamPullMode({
      stream: { id: "stream-2" },
      track,
      timeoutMs: 100,
      createVideo,
    });

    expect(result).toBe(true);
    expect(track.requestFrame).toHaveBeenCalledTimes(1);
    expect(videoRef.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
  });
});
