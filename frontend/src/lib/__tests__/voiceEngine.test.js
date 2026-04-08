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
});
