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
  startNativeScreenShare: jest.fn(),
  stopDesktopCapture: jest.fn(() => Promise.resolve(true)),
  stopNativeScreenShare: jest.fn(() => Promise.resolve(true)),
  updateNativeScreenShareKey: jest.fn(() => Promise.resolve(true)),
}), { virtual: true });

jest.mock("@/lib/screenSharePresets", () => ({
  DEFAULT_SCREEN_SHARE_PRESET_ID: "balanced",
  buildScreenSharePublishOptions: jest.fn(() => ({})),
}), { virtual: true });

jest.mock("@/lib/AudioAnalyzer", () => ({
  AudioAnalyzer: jest.fn(),
}), { virtual: true });

import { stopNativeScreenShare } from "@/lib/desktop";
import { VoiceEngine } from "../voiceEngine";

function createNativeShare() {
  return {
    keySubscriptionCleanup: jest.fn(),
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
    const disconnectRoom = jest.fn().mockResolvedValue(undefined);

    engine.room = {
      localParticipant: { unpublishTrack: jest.fn() },
      disconnect: disconnectRoom,
    };
    engine.nativeScreenShare = createNativeShare();

    await Promise.all([engine.disconnect(), engine.disconnect()]);

    expect(stopNativeScreenShare).toHaveBeenCalledTimes(1);
    expect(disconnectRoom).toHaveBeenCalledTimes(1);
    expect(engine.nativeScreenShare).toBeNull();
  });

  it("stops the native publisher even when no room exists anymore", async () => {
    const engine = new VoiceEngine();
    engine.room = null;
    engine.nativeScreenShare = createNativeShare();

    await expect(engine.stopScreenShare()).resolves.toBeUndefined();

    expect(stopNativeScreenShare).toHaveBeenCalledTimes(1);
    expect(engine.nativeScreenShare).toBeNull();
    expect(engine.screenShareTracks).toEqual([]);
  });

  it("attaches a native proxy video track via owner_user_id for the local stage", () => {
    const engine = new VoiceEngine();
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
    engine.remoteVideoTracks.set("user-1:screen_share", {
      track,
      participantId: "user-1",
      participantIdentity: "screen-share:channel:user-1",
      source: "screen_share",
    });

    const detach = engine.attachParticipantMediaElement("user-1", "screen_share", element);

    expect(typeof detach).toBe("function");
    expect(track.attach).toHaveBeenCalledWith(element);
    expect(element.muted).toBe(true);
  });
});
