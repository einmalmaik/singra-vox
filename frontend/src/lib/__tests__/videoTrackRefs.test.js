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
  Track: {
    Source: {
      Unknown: "unknown",
      Camera: "camera",
      ScreenShare: "screen_share",
      ScreenShareAudio: "screen_share_audio",
    },
  },
}));

import {
  VIDEO_TRACK_STATE_PENDING,
  VIDEO_TRACK_STATE_READY,
  buildLocalMediaStateFromTrackRefs,
  buildRemoteMediaParticipantsFromTrackRefs,
  findVideoTrackRef,
} from "../videoTrackRefs";

describe("videoTrackRefs", () => {
  it("derives the local media state from unified track refs", () => {
    const localMediaState = buildLocalMediaStateFromTrackRefs([
      {
        id: "local:user-1:camera",
        participantId: "user-1",
        source: "camera",
        state: VIDEO_TRACK_STATE_READY,
        revision: 1,
        isLocal: true,
        hasAudio: false,
      },
      {
        id: "local:user-1:screen_share",
        participantId: "user-1",
        source: "screen_share",
        state: VIDEO_TRACK_STATE_PENDING,
        revision: 0,
        isLocal: true,
        hasAudio: true,
      },
    ], { localUserId: "user-1" });

    expect(localMediaState).toEqual({
      hasCamera: true,
      hasCameraTrack: true,
      cameraTrackRevision: 1,
      hasScreenShare: true,
      hasScreenShareTrack: false,
      screenShareTrackRevision: 0,
      hasScreenShareAudio: true,
    });
  });

  it("aggregates remote participant summaries from track refs", () => {
    const participants = buildRemoteMediaParticipantsFromTrackRefs([
      {
        id: "remote:user-2:screen_share",
        participantId: "user-2",
        source: "screen_share",
        state: VIDEO_TRACK_STATE_READY,
        revision: 2,
        isLocal: false,
        hasAudio: true,
      },
      {
        id: "remote:user-3:camera",
        participantId: "user-3",
        source: "camera",
        state: VIDEO_TRACK_STATE_READY,
        revision: 1,
        isLocal: false,
        hasAudio: false,
      },
    ], { localUserId: "user-1" });

    expect(participants).toEqual([
      {
        userId: "user-2",
        hasCamera: false,
        hasScreenShare: true,
        hasScreenShareAudio: true,
        cameraTrackRevision: 0,
        screenShareTrackRevision: 2,
      },
      {
        userId: "user-3",
        hasCamera: true,
        hasScreenShare: false,
        hasScreenShareAudio: false,
        cameraTrackRevision: 1,
        screenShareTrackRevision: 0,
      },
    ]);
  });

  it("prefers the local slot when resolving a stage track ref", () => {
    const trackRef = findVideoTrackRef([
      {
        id: "remote:user-1:screen_share",
        participantId: "user-1",
        source: "screen_share",
        state: VIDEO_TRACK_STATE_READY,
        revision: 1,
        isLocal: false,
      },
      {
        id: "local:user-1:screen_share",
        participantId: "user-1",
        source: "screen_share",
        state: VIDEO_TRACK_STATE_READY,
        revision: 1,
        isLocal: true,
      },
    ], {
      participantId: "user-1",
      source: "screen_share",
      preferLocal: true,
    });

    expect(trackRef?.id).toBe("local:user-1:screen_share");
  });
});
