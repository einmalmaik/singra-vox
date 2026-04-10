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
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    TrackUnpublished: "trackUnpublished",
    TrackPublished: "trackPublished",
    TrackMuted: "trackMuted",
    TrackUnmuted: "trackUnmuted",
    ParticipantAttributesChanged: "participantAttributesChanged",
    TrackStreamStateChanged: "trackStreamStateChanged",
    TrackSubscriptionStatusChanged: "trackSubscriptionStatusChanged",
    Reconnected: "reconnected",
    ActiveSpeakersChanged: "activeSpeakersChanged",
    Disconnected: "disconnected",
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
  isE2EESupported: jest.fn(() => true),
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

jest.mock("@/lib/e2ee/media", () => ({
  createEncryptedMediaController: jest.fn(),
}), { virtual: true });

jest.mock("../e2ee/mediaSupport", () => ({
  getEncryptedVoiceSupport: jest.fn(() => ({ supported: true, reason: null })),
}));

jest.mock("@/lib/asyncControl", () => jest.requireActual("../asyncControl"), { virtual: true });
jest.mock("@/lib/videoTrackRefs", () => jest.requireActual("../videoTrackRefs"), { virtual: true });

jest.mock("@/lib/desktop", () => ({
  getNativeScreenShareSession: jest.fn(() => Promise.resolve(null)),
  startNativeScreenShare: jest.fn(),
  stopNativeScreenShare: jest.fn(() => Promise.resolve(true)),
  updateNativeScreenShareAudioVolume: jest.fn(() => Promise.resolve(true)),
  updateNativeScreenShareKey: jest.fn(() => Promise.resolve(true)),
  sendDesktopVoiceLog: jest.fn(() => Promise.resolve(false)),
}), { virtual: true });

jest.mock("@/lib/screenSharePresets", () => ({
  DEFAULT_SCREEN_SHARE_PRESET_ID: "balanced",
  buildScreenSharePublishOptions: jest.fn(() => ({})),
}), { virtual: true });

jest.mock("@/lib/AudioAnalyzer", () => ({
  AudioAnalyzer: jest.fn(),
}), { virtual: true });

import api from "@/lib/api";
import { createEncryptedMediaController } from "@/lib/e2ee/media";
import {
  getNativeScreenShareSession,
  startNativeScreenShare,
  stopNativeScreenShare,
  updateNativeScreenShareAudioVolume,
} from "@/lib/desktop";
import { createLocalScreenTracks, Room } from "livekit-client";
import { getEncryptedVoiceSupport } from "../e2ee/mediaSupport";
import { VoiceEngine } from "../voiceEngine";

function createNativeShare() {
  return {
    keySubscriptionCleanup: jest.fn(),
  };
}

function createVideoPublication(track = null, extra = {}) {
  const nextTrack = track ? {
    ...track,
    streamState: track.streamState ?? extra.streamState ?? "active",
  } : null;
  return {
    kind: "video",
    source: "screen_share",
    track: nextTrack,
    subscriptionStatus: "subscribed",
    isSubscribed: Boolean(nextTrack),
    isMuted: false,
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
    getEncryptedVoiceSupport.mockReturnValue({ supported: true, reason: null });
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    Room.mockReset();
    createEncryptedMediaController.mockReset();
    getEncryptedVoiceSupport.mockReset();
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

  it("enables encrypted voice for supported web clients when the server requires it", async () => {
    Object.defineProperty(window, "isSecureContext", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(global, "Worker", {
      configurable: true,
      value: jest.fn(),
    });
    Object.defineProperty(window, "crypto", {
      configurable: true,
      value: { subtle: {} },
    });

    const connect = jest.fn().mockResolvedValue(undefined);
    const startAudio = jest.fn().mockResolvedValue(undefined);
    const setE2EEEnabled = jest.fn().mockResolvedValue(undefined);
    const room = {
      on: jest.fn(),
      connect,
      startAudio,
      setE2EEEnabled,
    };

    Room.mockImplementation(() => room);
    createEncryptedMediaController.mockResolvedValue({
      encryption: { keyProvider: "provider", worker: "worker" },
      syncParticipantSet: jest.fn(),
    });
    api.post.mockResolvedValue({
      data: {
        server_url: "wss://livekit.example.test",
        participant_token: "participant-token",
        e2ee_required: true,
      },
    });

    const engine = new VoiceEngine();
    engine.serverId = "server-1";
    engine.channelId = "channel-1";
    engine.userId = "user-1";
    engine.runtimeConfig = { isDesktop: false, platform: "web" };
    engine._collectCurrentVoiceParticipantUserIds = jest.fn(() => ["user-1", "user-2"]);
    engine.syncEncryptedMediaParticipants = jest.fn().mockResolvedValue({
      rotated: false,
      keyVersion: "key-version",
      participantUserIds: ["user-1", "user-2"],
    });
    engine._ensureAudioContext = jest.fn();
    engine._publishLocalTrack = jest.fn();
    engine._applyOutputDevice = jest.fn();
    engine._applyRemoteAudioState = jest.fn();
    engine._syncExistingRemoteVideoPublications = jest.fn();
    engine._applyMuteState = jest.fn();
    engine._rehydrateNativeScreenShareSession = jest.fn();

    await engine.joinChannel();

    expect(createEncryptedMediaController).toHaveBeenCalledWith(engine.runtimeConfig, "channel-1");
    expect(Room).toHaveBeenCalledWith(expect.objectContaining({
      encryption: { keyProvider: "provider", worker: "worker" },
    }));
    expect(connect).toHaveBeenCalledWith("wss://livekit.example.test", "participant-token");
    expect(setE2EEEnabled).toHaveBeenCalledWith(true);
    expect(engine.syncEncryptedMediaParticipants).toHaveBeenCalledWith(
      ["user-1", "user-2"],
      "join-initial",
    );
  });

  it("rejects encrypted voice joins in unsupported browser contexts before connecting", async () => {
    getEncryptedVoiceSupport.mockReturnValueOnce({
      supported: false,
      reason: "Encrypted voice in the browser requires a secure context (HTTPS or localhost).",
    });

    api.post.mockResolvedValue({
      data: {
        server_url: "wss://livekit.example.test",
        participant_token: "participant-token",
        e2ee_required: true,
      },
    });

    const engine = new VoiceEngine();
    engine.serverId = "server-1";
    engine.channelId = "channel-1";
    engine.runtimeConfig = { isDesktop: false, platform: "web" };

    await expect(engine.joinChannel()).rejects.toThrow(
      "Encrypted voice in the browser requires a secure context",
    );
    expect(Room).not.toHaveBeenCalled();
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
      }),
    }));

    participant.trackPublications.get("pub-1").track = {
      kind: "video",
      source: "screen_share",
      streamState: "active",
    };
    participant.trackPublications.get("pub-1").isSubscribed = true;

    engine._emitRemoteMediaUpdate();

    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "media_tracks_update",
      local: expect.objectContaining({
        hasScreenShare: true,
      }),
    }));
  });

  it("keeps local native screen-share availability driven by the current proxy track", () => {
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
      streamState: "active",
    };
    publication.isSubscribed = true;
    engine._emitRemoteMediaUpdate();

    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "media_tracks_update",
      local: expect.objectContaining({
        hasScreenShare: true,
      }),
    }));
  });

  it("keeps local native screen-share unavailable until the proxy track exists", () => {
    const engine = new VoiceEngine();
    const publication = createVideoPublication(null, {
      isDesired: false,
      subscriptionStatus: "unsubscribed",
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

    expect(engine.listVideoTrackRefs()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        participantId: "user-1",
        source: "screen_share",
        isLocal: true,
        isAvailable: false,
      }),
    ]));
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

  it("syncs encrypted participants before browser screen-share publish", async () => {
    const engine = new VoiceEngine();
    const videoTrack = {
      kind: "video",
      source: "screen_share",
      mediaStreamTrack: {
        addEventListener: jest.fn(),
        getSettings: jest.fn(() => ({ width: 1280, height: 720, frameRate: 30 })),
        contentHint: "",
      },
    };
    const publishTrack = jest.fn().mockResolvedValue({});

    engine.userId = "user-1";
    engine.room = {
      remoteParticipants: new Map(),
      localParticipant: { publishTrack },
    };
    engine.mediaE2EEController = { encryption: {} };
    engine.syncEncryptedMediaParticipants = jest.fn().mockResolvedValue({
      rotated: false,
      keyVersion: "key-version",
      participantUserIds: ["user-1"],
    });

    createLocalScreenTracks.mockResolvedValue([videoTrack]);

    await engine.startScreenShare({
      audio: false,
      displaySurface: "monitor",
      resolution: { width: 1280, height: 720, frameRate: 30 },
      qualityPreset: "balanced",
    });

    expect(engine.syncEncryptedMediaParticipants).toHaveBeenCalledWith(
      ["user-1"],
      "browser-screen-share-start",
    );
    expect(createLocalScreenTracks).toHaveBeenCalled();
    expect(publishTrack).toHaveBeenCalled();
  });

  it("forwards native desktop audio volume updates to the desktop bridge", () => {
    const engine = new VoiceEngine();

    engine.nativeScreenShare = {
      audioRequested: true,
    };

    engine.setScreenShareAudioVolume(135);

    expect(updateNativeScreenShareAudioVolume).toHaveBeenCalledWith(135);
  });

  it("marks remote screen-share publications as unavailable before the track arrives", () => {
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
        isAvailable: false,
      }),
    ]));
  });

  it("refreshes remote video availability on track unmute without waiting for unrelated room events", () => {
    const engine = new VoiceEngine();
    const listeners = {};
    const publication = createVideoPublication({
      kind: "video",
      source: "screen_share",
      streamState: "active",
    }, {
      isMuted: true,
    });
    const participant = createRemoteParticipant("screen-share:channel:user-2", "user-2", publication);
    const listener = jest.fn();

    engine.userId = "user-1";
    engine.room = {
      remoteParticipants: new Map([[participant.identity, participant]]),
      on: jest.fn((event, handler) => {
        listeners[event] = handler;
      }),
    };
    engine.addStateListener(listener);

    engine._bindRoomEvents();
    publication.isMuted = false;
    listeners.trackUnmuted?.(publication, participant);

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      type: "media_tracks_update",
      trackRefs: expect.arrayContaining([
        expect.objectContaining({
          participantId: "user-2",
          source: "screen_share",
          isAvailable: true,
        }),
      ]),
    }));
  });

  it("does not expose transport-only fields in public video track refs", () => {
    const engine = new VoiceEngine();
    const publication = createVideoPublication({
      kind: "video",
      source: "screen_share",
      attach: jest.fn(),
      detach: jest.fn(),
    });
    const participant = createRemoteParticipant("screen-share:channel:user-2", "user-2", publication);

    engine.userId = "user-1";
    engine.room = {
      remoteParticipants: new Map([[participant.identity, participant]]),
    };

    const trackRef = engine.listVideoTrackRefs().find((candidate) => candidate.participantId === "user-2");

    expect(trackRef).toEqual(expect.objectContaining({
      participantId: "user-2",
      participantIdentity: "screen-share:channel:user-2",
      source: "screen_share",
      isAvailable: true,
    }));
    expect(trackRef).not.toHaveProperty("track");
    expect(trackRef).not.toHaveProperty("publication");
    expect(trackRef).not.toHaveProperty("subscriptionStatus");
    expect(trackRef).not.toHaveProperty("streamState");
    expect(trackRef).not.toHaveProperty("revision");
  });

  it("keeps a subscribed video track attachable while adaptive stream is paused", () => {
    const engine = new VoiceEngine();
    const publication = createVideoPublication({
      kind: "video",
      source: "screen_share",
      sid: "track-1",
      attach: jest.fn(),
      detach: jest.fn(),
    }, {
      sid: "pub-1",
      trackSid: "pub-1",
    });
    const participant = createRemoteParticipant("screen-share:channel:user-2", "user-2", publication);

    engine.userId = "user-1";
    engine.room = {
      remoteParticipants: new Map([[participant.identity, participant]]),
    };

    const firstTrackRef = engine.listVideoTrackRefs().find((candidate) => candidate.participantId === "user-2");
    const secondTrackRef = engine.listVideoTrackRefs().find((candidate) => candidate.participantId === "user-2");

    expect(secondTrackRef).toBe(firstTrackRef);

    publication.track.streamState = "paused";

    const thirdTrackRef = engine.listVideoTrackRefs().find((candidate) => candidate.participantId === "user-2");

    expect(thirdTrackRef).toBe(firstTrackRef);
    expect(thirdTrackRef).toEqual(expect.objectContaining({
      isAvailable: true,
    }));
  });

  it("attaches a remote video publication without mutating video subscription state", () => {
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
      subscriptionStatus: "subscribed",
      isSubscribed: true,
      streamState: "active",
      isMuted: false,
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

    expect(typeof detach).toBe("function");
    expect(track.attach).toHaveBeenCalledWith(element);
    expect(publication.setEnabled).not.toHaveBeenCalled();
  });

  it("requests playback subscription for the actively viewed remote video track when no video is attached yet", () => {
    const engine = new VoiceEngine();
    const publication = {
      kind: "video",
      source: "screen_share",
      track: null,
      isDesired: true,
      subscriptionStatus: "desired",
      isSubscribed: false,
      streamState: "paused",
      isMuted: false,
      setSubscribed: jest.fn(),
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

    const trackRefId = engine.getVideoTrackRefId("user-2", "screen_share");
    const result = engine.ensureTrackRefPlayback(trackRefId);

    expect(typeof result).toBe("boolean");
    expect(publication.setSubscribed).toHaveBeenCalledWith(true);
  });

  it("does not resubscribe an already attached remote video track just because adaptive stream is paused", () => {
    const engine = new VoiceEngine();
    const track = {
      kind: "video",
      source: "screen_share",
      attach: jest.fn(),
      detach: jest.fn(),
      streamState: "paused",
    };
    const publication = {
      kind: "video",
      source: "screen_share",
      track,
      isDesired: true,
      subscriptionStatus: "subscribed",
      isSubscribed: true,
      isMuted: false,
      setSubscribed: jest.fn(),
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

    const trackRefId = engine.getVideoTrackRefId("user-2", "screen_share");
    const result = engine.ensureTrackRefPlayback(trackRefId);

    expect(result).toBe(true);
    expect(publication.setSubscribed).not.toHaveBeenCalled();
  });

  it("prefers the current room publication over a cached stale video publication", () => {
    const engine = new VoiceEngine();
    const stalePublication = {
      kind: "video",
      source: "screen_share",
      track: null,
      subscriptionStatus: "desired",
      isSubscribed: false,
      streamState: "paused",
      isMuted: false,
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
      subscriptionStatus: "subscribed",
      isSubscribed: true,
      streamState: "active",
      isMuted: false,
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
    const trackRefId = engine.getVideoTrackRefId("user-2", "screen_share");
    const element = {
      play: jest.fn(() => Promise.resolve()),
      pause: jest.fn(),
    };

    engine.attachTrackRefElement(trackRefId, element);

    expect(livePublication.setEnabled).not.toHaveBeenCalled();
    expect(stalePublication.setSubscribed).not.toHaveBeenCalled();
    expect(stalePublication.setEnabled).not.toHaveBeenCalled();
  });

  it("refreshes a stale native self-preview track ref before attach", () => {
    const engine = new VoiceEngine();
    const track = {
      kind: "video",
      source: "screen_share",
      attach: jest.fn(),
      detach: jest.fn(),
    };
    const publication = createVideoPublication(track, {
      subscriptionStatus: "desired",
      isDesired: false,
      setSubscribed: jest.fn(),
    });
    const participant = createRemoteParticipant(
      "screen-share:channel:user-1",
      "user-1",
      publication,
    );
    const element = {
      play: jest.fn(() => Promise.resolve()),
      pause: jest.fn(),
    };

    engine.userId = "user-1";
    engine.room = {
      remoteParticipants: new Map(),
    };
    engine.nativeScreenShare = {
      participantIdentity: "screen-share:channel:user-1",
      keySubscriptionCleanup: jest.fn(),
    };

    engine._emitRemoteMediaUpdate();
    const trackRefId = engine.listVideoTrackRefs().find((trackRef) => (
      trackRef.isLocal && trackRef.source === "screen_share"
    ))?.id;

    engine.room.remoteParticipants.set(participant.identity, participant);

    const detach = engine.attachTrackRefElement(trackRefId, element);

    expect(typeof detach).toBe("function");
    expect(track.attach).toHaveBeenCalledWith(element);
    expect(engine.getVideoTrackRef(trackRefId)).toEqual(expect.objectContaining({
      isAvailable: true,
      participantIdentity: "screen-share:channel:user-1",
    }));
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
      subscriptionStatus: "subscribed",
      isSubscribed: true,
      streamState: "active",
      isMuted: false,
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

  it("replaces a stale remote audio element when the same publication key resubscribes", async () => {
    const engine = new VoiceEngine();
    const firstElement = document.createElement("audio");
    const secondElement = document.createElement("audio");
    const firstTrack = {
      kind: "audio",
      source: "screen_share_audio",
      attach: jest.fn(() => firstElement),
      detach: jest.fn(),
    };
    const secondTrack = {
      kind: "audio",
      source: "screen_share_audio",
      attach: jest.fn(() => secondElement),
      detach: jest.fn(),
    };
    const participantEntry = {
      userId: "user-2",
      participantIdentity: "screen-share:channel:user-2",
    };

    await engine._attachRemoteAudioTrack(
      firstTrack,
      { kind: "audio", source: "screen_share_audio" },
      participantEntry,
      participantEntry.participantIdentity,
      "screen_share_audio",
    );
    await engine._attachRemoteAudioTrack(
      secondTrack,
      { kind: "audio", source: "screen_share_audio" },
      participantEntry,
      participantEntry.participantIdentity,
      "screen_share_audio",
    );

    expect(firstTrack.detach).toHaveBeenCalledWith(firstElement);
    expect(document.body.contains(firstElement)).toBe(false);
    expect(document.body.contains(secondElement)).toBe(true);
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
