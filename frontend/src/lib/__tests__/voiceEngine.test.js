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
    ParticipantConnected: "participantConnected",
    TrackPublished: "trackPublished",
    ParticipantAttributesChanged: "participantAttributesChanged",
    TrackStreamStateChanged: "trackStreamStateChanged",
    TrackSubscriptionStatusChanged: "trackSubscriptionStatusChanged",
    Reconnected: "reconnected",
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
jest.mock("@/lib/videoTrackRefs", () => jest.requireActual("../videoTrackRefs"), { virtual: true });

jest.mock("@/lib/desktop", () => ({
  getNativeScreenShareSession: jest.fn(() => Promise.resolve(null)),
  startNativeScreenShare: jest.fn(),
  stopNativeScreenShare: jest.fn(() => Promise.resolve(true)),
  updateNativeScreenShareAudioVolume: jest.fn(() => Promise.resolve(true)),
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
  updateNativeScreenShareAudioVolume,
} from "@/lib/desktop";
import { VoiceEngine } from "../voiceEngine";

function createNativeShare() {
  return {
    keySubscriptionCleanup: jest.fn(),
  };
}

function createVideoPublication(track = null, extra = {}) {
  return {
    kind: "video",
    source: "screen_share",
    track,
    subscriptionStatus: "desired",
    isDesired: true,
    setSubscribed: jest.fn(),
    ...extra,
  };
}

function createRemoteParticipant(identity, userId, publication) {
  return {
    identity,
    attributes: { owner_user_id: userId },
    trackPublications: new Map([["pub-1", publication]]),
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
    const publication = createVideoPublication(track);
    const participant = createRemoteParticipant("screen-share:channel:user-1", "user-1", publication);
    engine.room = {
      remoteParticipants: new Map([[participant.identity, participant]]),
    };
    engine.nativeScreenShare = {
      participantIdentity: "screen-share:channel:user-1",
      keySubscriptionCleanup: jest.fn(),
    };

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
    const localParticipant = createRemoteParticipant(
      "screen-share:channel:user-1",
      "user-1",
      createVideoPublication(localProxyVideoTrack),
    );
    const remoteParticipant = createRemoteParticipant(
      "screen-share:channel:user-2",
      "user-2",
      createVideoPublication(remoteVideoTrack),
    );
    engine.room = {
      remoteParticipants: new Map([
        [localParticipant.identity, localParticipant],
        [remoteParticipant.identity, remoteParticipant],
      ]),
    };

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
    const participant = createRemoteParticipant(
      "screen-share:channel:user-1",
      "user-1",
      createVideoPublication(null),
    );

    engine.userId = "user-1";
    engine.room = {
      remoteParticipants: new Map([[participant.identity, participant]]),
    };
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

    participant.trackPublications.get("pub-1").track = {
      kind: "video",
      source: "screen_share",
    };

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
    const publication = createVideoPublication({
      kind: "video",
      source: "screen_share",
      id: "track-a",
    });
    const participant = createRemoteParticipant("screen-share:channel:user-1", "user-1", publication);

    engine.userId = "user-1";
    engine.room = {
      remoteParticipants: new Map([[participant.identity, participant]]),
    };
    engine.nativeScreenShare = {
      participantIdentity: "screen-share:channel:user-1",
      keySubscriptionCleanup: jest.fn(),
    };
    engine.addStateListener(listener);

    engine._emitRemoteMediaUpdate();

    publication.track = {
      kind: "video",
      source: "screen_share",
      id: "track-b",
    };
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
      hasAudio: true,
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
      hasAudio: true,
      audioRequested: true,
    }));
  });

  it("forwards native desktop audio volume updates to the desktop bridge", () => {
    const engine = new VoiceEngine();

    engine.nativeScreenShare = {
      audioRequested: true,
    };

    engine.setScreenShareAudioVolume(135);

    expect(updateNativeScreenShareAudioVolume).toHaveBeenCalledWith(135);
  });

  it("marks remote screen-share publications as pending before the track arrives", () => {
    const engine = new VoiceEngine();
    const publication = createVideoPublication(null);
    const participant = createRemoteParticipant("screen-share:channel:user-2", "user-2", publication);

    engine.userId = "user-1";
    engine.room = {
      remoteParticipants: new Map([[participant.identity, participant]]),
    };
    engine._syncRemoteVideoPublication(participant, publication);

    expect(engine.listVideoTrackRefs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        participantId: "user-2",
        participantIdentity: "screen-share:channel:user-2",
        source: "screen_share",
        state: "pending",
      }),
    ]));
  });

  it("ensures remote video publications stay subscribed before attach", () => {
    const engine = new VoiceEngine();
    const track = {
      kind: "video",
      source: "screen_share",
      attach: jest.fn(),
      detach: jest.fn(),
    };
    const publication = {
      kind: "video",
      source: "screen_share",
      track,
      subscriptionStatus: "desired",
      isDesired: false,
      isEnabled: false,
      setSubscribed: jest.fn(),
      setEnabled: jest.fn(),
    };
    const participant = {
      identity: "screen-share:channel:user-2",
      attributes: { owner_user_id: "user-2" },
      trackPublications: new Map([["pub-1", publication]]),
    };

    engine.userId = "user-1";
    engine.room = {
      remoteParticipants: new Map([[participant.identity, participant]]),
    };
    engine._syncRemoteVideoPublication(participant, publication);
    const trackRefId = engine.getVideoTrackRefId("user-2", "screen_share");
    const element = {
      play: jest.fn(() => Promise.resolve()),
      pause: jest.fn(),
    };

    const detach = engine.attachTrackRefElement(trackRefId, element);

    expect(publication.setSubscribed).toHaveBeenCalledWith(true);
    expect(typeof detach).toBe("function");
    expect(track.attach).toHaveBeenCalledWith(element);
    expect(publication.setEnabled).not.toHaveBeenCalled();
  });

  it("prefers the current room publication over a cached stale video publication", () => {
    const engine = new VoiceEngine();
    const stalePublication = {
      kind: "video",
      source: "screen_share",
      track: null,
      subscriptionStatus: "desired",
      isDesired: false,
      isEnabled: false,
      setSubscribed: jest.fn(),
      setEnabled: jest.fn(),
      setVideoDimensions: jest.fn(),
    };
    const livePublication = {
      kind: "video",
      source: "screen_share",
      track: {
        kind: "video",
        source: "screen_share",
        attach: jest.fn(),
        detach: jest.fn(),
      },
      subscriptionStatus: "desired",
      isDesired: false,
      isEnabled: false,
      setSubscribed: jest.fn(),
      setEnabled: jest.fn(),
    };
    const participant = {
      identity: "screen-share:channel:user-2",
      attributes: { owner_user_id: "user-2" },
      trackPublications: new Map([["pub-live", livePublication]]),
    };

    engine.userId = "user-1";
    engine.room = {
      remoteParticipants: new Map([[participant.identity, participant]]),
    };
    engine._syncRemoteVideoPublication(participant, stalePublication);
    const trackRefId = engine.getVideoTrackRefId("user-2", "screen_share");
    const element = {
      play: jest.fn(() => Promise.resolve()),
      pause: jest.fn(),
    };

    engine.attachTrackRefElement(trackRefId, element);

    expect(livePublication.setSubscribed).toHaveBeenCalledWith(true);
    expect(livePublication.setEnabled).not.toHaveBeenCalled();
    expect(stalePublication.setSubscribed).not.toHaveBeenCalled();
    expect(stalePublication.setEnabled).not.toHaveBeenCalled();
  });

  it("does not manually disable remote publications when the stage closes", () => {
    const engine = new VoiceEngine();
    const track = {
      kind: "video",
      source: "screen_share",
      attach: jest.fn(),
      detach: jest.fn(),
    };
    const publication = {
      kind: "video",
      source: "screen_share",
      track,
      subscriptionStatus: "desired",
      isDesired: true,
      isEnabled: true,
      setSubscribed: jest.fn(),
      setEnabled: jest.fn(),
    };
    const participant = {
      identity: "screen-share:channel:user-2",
      attributes: { owner_user_id: "user-2" },
      trackPublications: new Map([["pub-1", publication]]),
    };

    engine.userId = "user-1";
    engine.room = {
      remoteParticipants: new Map([[participant.identity, participant]]),
    };
    engine._syncRemoteVideoPublication(participant, publication);
    const trackRefId = engine.getVideoTrackRefId("user-2", "screen_share");
    const element = {
      play: jest.fn(() => Promise.resolve()),
      pause: jest.fn(),
    };

    const detach = engine.attachTrackRefElement(trackRefId, element);
    detach?.();

    expect(track.detach).toHaveBeenCalledWith(element);
    expect(publication.setEnabled).not.toHaveBeenCalled();
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
