/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
jest.mock("livekit-client", () => ({
  Room: jest.fn(),
  RoomEvent: {},
  Track: {
    Kind: { Audio: "audio", Video: "video" },
    Source: {
      Unknown: "unknown",
      Microphone: "microphone",
      Camera: "camera",
      ScreenShare: "screen_share",
      ScreenShareAudio: "screen_share_audio",
    },
  },
  DisconnectReason: {
    CLIENT_INITIATED: 1,
    DUPLICATE_IDENTITY: 2,
  },
  createLocalScreenTracks: jest.fn(),
  createLocalVideoTrack: jest.fn(),
}));

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
  },
}), { virtual: true });

jest.mock("@/lib/voicePreferences", () => ({
  getDefaultVoicePreferences: () => ({
    perUserVolumes: {},
    locallyMutedParticipants: {},
  }),
}), { virtual: true });

jest.mock("@/lib/asyncControl", () => jest.requireActual("../asyncControl"), { virtual: true });
jest.mock("@/lib/nativeCaptureProbe", () => jest.requireActual("../nativeCaptureProbe"), { virtual: true });

jest.mock("@/lib/desktop", () => ({
  getDesktopCaptureFrame: jest.fn(),
  startDesktopCapture: jest.fn(),
  stopDesktopCapture: jest.fn(() => Promise.resolve(true)),
}), { virtual: true });

jest.mock("@/lib/screenSharePresets", () => ({
  DEFAULT_SCREEN_SHARE_PRESET_ID: "balanced",
  buildScreenSharePublishOptions: jest.fn(() => ({})),
}), { virtual: true });

jest.mock("@/lib/AudioAnalyzer", () => ({
  AudioAnalyzer: jest.fn(),
}), { virtual: true });

import { stopDesktopCapture } from "@/lib/desktop";
import { VoiceEngine } from "../voiceEngine";

function createNativeShare(captureMode = "pull") {
  const mediaTrack = { stop: jest.fn() };
  const descriptor = { stop: jest.fn() };
  return {
    captureMode,
    pumpTimer: 12,
    mediaStreamTrack: mediaTrack,
    mediaStream: {
      getTracks: () => [mediaTrack],
    },
    descriptor,
  };
}

describe("VoiceEngine native cleanup", () => {
  let warnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("runs native cleanup only once for parallel disconnect calls", async () => {
    const engine = new VoiceEngine();
    const unpublishTrack = jest.fn().mockResolvedValue(undefined);
    const disconnectRoom = jest.fn().mockResolvedValue(undefined);

    engine.room = {
      localParticipant: { unpublishTrack },
      disconnect: disconnectRoom,
    };
    engine.nativeScreenShare = createNativeShare();
    engine.screenShareTracks = [engine.nativeScreenShare.descriptor];

    await Promise.all([engine.disconnect(), engine.disconnect()]);

    expect(stopDesktopCapture).toHaveBeenCalledTimes(1);
    expect(unpublishTrack).toHaveBeenCalledTimes(1);
    expect(disconnectRoom).toHaveBeenCalledTimes(1);
    expect(engine.nativeScreenShare).toBeNull();
  });

  it("stops native capture even when LiveKit unpublish fails", async () => {
    const engine = new VoiceEngine();
    const unpublishTrack = jest.fn().mockRejectedValue(new Error("boom"));

    engine.room = {
      localParticipant: { unpublishTrack },
    };
    engine.nativeScreenShare = createNativeShare("fps");
    engine.screenShareTracks = [engine.nativeScreenShare.descriptor];

    await expect(engine.stopScreenShare()).resolves.toBeUndefined();

    expect(stopDesktopCapture).toHaveBeenCalledTimes(1);
    expect(engine.nativeScreenShare).toBeNull();
    expect(engine.screenShareTracks).toEqual([]);
  });

  it("stops native capture even when no room exists anymore", async () => {
    const engine = new VoiceEngine();

    engine.room = null;
    engine.nativeScreenShare = createNativeShare("fps");
    engine.screenShareTracks = [engine.nativeScreenShare.descriptor];

    await expect(engine.stopScreenShare()).resolves.toBeUndefined();

    expect(stopDesktopCapture).toHaveBeenCalledTimes(1);
    expect(engine.nativeScreenShare).toBeNull();
    expect(engine.screenShareTracks).toEqual([]);
  });

  it("replays the last native frame when no fresh desktop frame arrives", async () => {
    const engine = new VoiceEngine();
    const cachedFrame = { width: 2, height: 1 };
    const putImageData = jest.fn();
    const clearRect = jest.fn();
    const requestFrame = jest.fn();

    engine.nativeScreenShare = {
      drawInFlight: false,
      frameId: 42,
      lastFrameImageData: cachedFrame,
      lastReplayAt: 0,
      canvas: { width: 2, height: 1 },
      context: { putImageData, clearRect, drawImage: jest.fn() },
      mediaStreamTrack: { requestFrame },
      usePullMode: true,
    };

    const { getDesktopCaptureFrame } = require("@/lib/desktop");
    getDesktopCaptureFrame.mockResolvedValue(null);

    await expect(engine._pumpNativeDesktopFrame()).resolves.toBe(true);

    expect(putImageData).toHaveBeenCalledWith(cachedFrame, 0, 0);
    expect(clearRect).toHaveBeenCalledWith(0, 0, 2, 1);
    expect(requestFrame).toHaveBeenCalledTimes(1);
  });

  it("forces a native frame replay when attaching the local screen-share preview", () => {
    const engine = new VoiceEngine();
    const cachedFrame = { width: 1, height: 1 };
    const putImageData = jest.fn();
    const clearRect = jest.fn();
    const requestFrame = jest.fn();
    const track = {
      attach: jest.fn(),
      detach: jest.fn(),
      kind: "video",
      source: "screen_share",
    };
    const element = {
      play: jest.fn(() => Promise.resolve()),
      pause: jest.fn(),
    };

    engine.userId = "user-1";
    engine.nativeScreenShare = {
      lastFrameImageData: cachedFrame,
      lastReplayAt: 0,
      canvas: { width: 1, height: 1 },
      context: { putImageData, clearRect, drawImage: jest.fn() },
      mediaStreamTrack: { requestFrame },
      usePullMode: true,
    };
    engine.screenShareTracks = [track];

    const detach = engine.attachParticipantMediaElement("user-1", "screen_share", element);

    expect(typeof detach).toBe("function");
    expect(track.attach).toHaveBeenCalledWith(element);
    expect(putImageData).toHaveBeenCalledWith(cachedFrame, 0, 0);
    expect(clearRect).toHaveBeenCalledWith(0, 0, 1, 1);
    expect(requestFrame).toHaveBeenCalledTimes(1);
  });
});
