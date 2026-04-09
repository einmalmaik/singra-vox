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
  RoomEvent: {
    ParticipantAttributesChanged: "participantAttributesChanged",
  },
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
jest.mock("@/lib/participantMediaRegistry", () => jest.requireActual("../participantMediaRegistry"), { virtual: true });

jest.mock("@/lib/desktop", () => ({
  getNativeScreenShareSession: jest.fn(() => Promise.resolve(null)),
  startNativeScreenShare: jest.fn(),
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

import api from "@/lib/api";
import {
  getNativeScreenShareSession,
  startNativeScreenShare,
  stopNativeScreenShare,
} from "@/lib/desktop";
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
    engine.nativeScreenShare = {
      participantIdentity: "screen-share:channel:user-1",
      keySubscriptionCleanup: jest.fn(),
    };
    engine.participantMediaRegistry.upsertVideoTrack({
      participant: {
        identity: "screen-share:channel:user-1",
        attributes: { owner_user_id: "user-1" },
      },
      track,
      source: "screen_share",
    });

    const detach = engine.attachParticipantMediaElement("user-1", "screen_share", element);

    expect(typeof detach).toBe("function");
    expect(track.attach).toHaveBeenCalledWith(element);
    expect(element.muted).toBe(true);
  });

  it("does not report the local native proxy as a remote live-media participant", () => {
    const engine = new VoiceEngine();
    const localProxyVideoTrack = {
      kind: "video",
      source: "screen_share",
    };
    const remoteVideoTrack = {
      kind: "video",
      source: "screen_share",
    };

    engine.userId = "user-1";
    engine.participantMediaRegistry.upsertVideoTrack({
      participant: {
        identity: "screen-share:channel:user-1",
        attributes: { owner_user_id: "user-1" },
      },
      track: localProxyVideoTrack,
      source: "screen_share",
    });
    engine.participantMediaRegistry.upsertVideoTrack({
      participant: {
        identity: "screen-share:channel:user-2",
        attributes: { owner_user_id: "user-2" },
      },
      track: remoteVideoTrack,
      source: "screen_share",
    });

    expect(engine._buildRemoteMediaParticipants()).toEqual([
      {
        userId: "user-2",
        hasCamera: false,
        hasScreenShare: true,
        hasScreenShareAudio: false,
        cameraTrackRevision: 0,
        screenShareTrackRevision: 1,
      },
    ]);
  });

  it("reports native screen-share readiness only after the proxy track is attached", () => {
    const engine = new VoiceEngine();
    const listener = jest.fn();

    engine.userId = "user-1";
    engine.nativeScreenShare = {
      participantIdentity: "screen-share:channel:user-1",
      keySubscriptionCleanup: jest.fn(),
    };
    engine.addStateListener(listener);

    engine._emitRemoteMediaUpdate();

    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "media_tracks_update",
      local: expect.objectContaining({
        hasScreenShare: true,
        hasScreenShareTrack: false,
      }),
    }));

    engine.participantMediaRegistry.upsertVideoTrack({
      participant: {
        identity: "screen-share:channel:user-1",
        attributes: { owner_user_id: "user-1" },
      },
      track: {
        kind: "video",
        source: "screen_share",
      },
      source: "screen_share",
    });

    engine._emitRemoteMediaUpdate();

    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "media_tracks_update",
      local: expect.objectContaining({
        hasScreenShare: true,
        hasScreenShareTrack: true,
        screenShareTrackRevision: 1,
      }),
    }));
  });

  it("increments the local native screen-share revision when the proxy track is replaced", () => {
    const engine = new VoiceEngine();
    const listener = jest.fn();

    engine.userId = "user-1";
    engine.nativeScreenShare = {
      participantIdentity: "screen-share:channel:user-1",
      keySubscriptionCleanup: jest.fn(),
    };
    engine.addStateListener(listener);

    engine.participantMediaRegistry.upsertVideoTrack({
      participant: {
        identity: "screen-share:channel:user-1",
        attributes: { owner_user_id: "user-1" },
      },
      track: {
        kind: "video",
        source: "screen_share",
        id: "track-a",
      },
      source: "screen_share",
    });
    engine._emitRemoteMediaUpdate();

    engine.participantMediaRegistry.upsertVideoTrack({
      participant: {
        identity: "screen-share:channel:user-1",
        attributes: { owner_user_id: "user-1" },
      },
      track: {
        kind: "video",
        source: "screen_share",
        id: "track-b",
      },
      source: "screen_share",
    });
    engine._emitRemoteMediaUpdate();

    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "media_tracks_update",
      local: expect.objectContaining({
        hasScreenShareTrack: true,
        screenShareTrackRevision: 2,
      }),
    }));
  });

  it("emits the effective native capture settings returned by the desktop publisher", async () => {
    const engine = new VoiceEngine();
    const listener = jest.fn();

    engine.userId = "user-1";
    engine.serverId = "server-1";
    engine.channelId = "channel-1";
    engine.runtimeConfig = { isDesktop: true };
    engine.room = { localParticipant: { unpublishTrack: jest.fn() } };
    engine.addStateListener(listener);

    api.post.mockResolvedValue({
      data: {
        server_url: "wss://livekit.example.test",
        participant_token: "token",
        room_name: "room-1",
        participant_identity: "screen-share:channel-1:user-1",
        e2ee_required: false,
      },
    });
    startNativeScreenShare.mockResolvedValue({
      participantIdentity: "screen-share:channel-1:user-1",
      requestedWidth: 1280,
      requestedHeight: 718,
      requestedFrameRate: 30,
      sourceKind: "display",
      sourceLabel: "Display 2560x1440",
    });

    await engine.startScreenShare({
      nativeCapture: true,
      sourceId: "display:0",
      sourceKind: "display",
      sourceLabel: "Display 1",
      resolution: { width: 1280, height: 720, frameRate: 30 },
      qualityPreset: "balanced",
    });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: "screen_share_change",
      actualCaptureSettings: {
        width: 1280,
        height: 718,
        frameRate: 30,
      },
    }));
  });

  it("rehydrates an active native desktop screen share after a desktop reconnect", async () => {
    const engine = new VoiceEngine();
    const listener = jest.fn();

    engine.userId = "user-1";
    engine.serverId = "server-1";
    engine.channelId = "channel-1";
    engine.runtimeConfig = { isDesktop: true };
    engine.room = { name: "server-server-1-channel-channel-1" };
    engine.addStateListener(listener);

    getNativeScreenShareSession.mockResolvedValue({
      provider: "tauri-native-livekit",
      roomName: "server-server-1-channel-channel-1",
      participantIdentity: "screen-share:channel-1:user-1",
      sourceId: "display:0",
      sourceKind: "display",
      sourceLabel: "Display 2560x1440",
      requestedWidth: 1280,
      requestedHeight: 720,
      requestedFrameRate: 30,
    });

    await engine._rehydrateNativeScreenShareSession();

    expect(engine.nativeScreenShare).toEqual(expect.objectContaining({
      participantIdentity: "screen-share:channel-1:user-1",
      sourceId: "display:0",
    }));
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: "screen_share_change",
      enabled: true,
      actualCaptureSettings: {
        width: 1280,
        height: 720,
        frameRate: 30,
      },
    }));
  });
});
