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

import { buildMediaStageRevision } from "../mediaStageRevision";
import { VIDEO_TRACK_STATE_PENDING, VIDEO_TRACK_STATE_READY } from "../videoTrackRefs";

describe("mediaStageRevision", () => {
  it("handles a missing selected track ref without crashing", () => {
    expect(() => buildMediaStageRevision({
      selectedTrackRefId: "remote:user-2:screen_share",
      trackRefs: [],
    })).not.toThrow();
  });

  it("handles null entries in the track-ref list without crashing", () => {
    expect(() => buildMediaStageRevision({
      selectedTrackRefId: "remote:user-2:screen_share",
      trackRefs: [
        null,
        {
          id: "remote:user-2:screen_share",
          participantId: "user-2",
          source: "screen_share",
          state: VIDEO_TRACK_STATE_PENDING,
          revision: 0,
        },
      ],
    })).not.toThrow();
  });

  it("changes when the selected local screen-share track becomes attachable", () => {
    const beforeTrackReady = buildMediaStageRevision({
      selectedTrackRefId: "local:user-1:screen_share",
      trackRefs: [
        {
          id: "local:user-1:screen_share",
          participantId: "user-1",
          source: "screen_share",
          state: VIDEO_TRACK_STATE_PENDING,
          revision: 0,
        },
      ],
    });
    const afterTrackReady = buildMediaStageRevision({
      selectedTrackRefId: "local:user-1:screen_share",
      trackRefs: [
        {
          id: "local:user-1:screen_share",
          participantId: "user-1",
          source: "screen_share",
          state: VIDEO_TRACK_STATE_READY,
          revision: 1,
        },
      ],
    });

    expect(afterTrackReady).not.toBe(beforeTrackReady);
  });

  it("stays stable for identical track-ref sets regardless of order", () => {
    const revisionA = buildMediaStageRevision({
      selectedTrackRefId: "remote:user-2:screen_share",
      trackRefs: [
        {
          id: "remote:user-2:screen_share",
          participantId: "user-2",
          source: "screen_share",
          state: VIDEO_TRACK_STATE_READY,
          revision: 1,
          hasAudio: false,
        },
        {
          id: "remote:user-3:camera",
          participantId: "user-3",
          source: "camera",
          state: VIDEO_TRACK_STATE_READY,
          revision: 1,
          hasAudio: false,
        },
      ],
    });
    const revisionB = buildMediaStageRevision({
      selectedTrackRefId: "remote:user-2:screen_share",
      trackRefs: [
        {
          id: "remote:user-3:camera",
          participantId: "user-3",
          source: "camera",
          state: VIDEO_TRACK_STATE_READY,
          revision: 1,
          hasAudio: false,
        },
        {
          id: "remote:user-2:screen_share",
          participantId: "user-2",
          source: "screen_share",
          state: VIDEO_TRACK_STATE_READY,
          revision: 1,
          hasAudio: false,
        },
      ],
    });

    expect(revisionA).toBe(revisionB);
  });

  it("changes when a selected remote track is replaced without changing availability", () => {
    const beforeReplacement = buildMediaStageRevision({
      selectedTrackRefId: "remote:user-2:screen_share",
      trackRefs: [
        {
          id: "remote:user-2:screen_share",
          participantId: "user-2",
          source: "screen_share",
          state: VIDEO_TRACK_STATE_READY,
          revision: 1,
          hasAudio: false,
        },
      ],
    });
    const afterReplacement = buildMediaStageRevision({
      selectedTrackRefId: "remote:user-2:screen_share",
      trackRefs: [
        {
          id: "remote:user-2:screen_share",
          participantId: "user-2",
          source: "screen_share",
          state: VIDEO_TRACK_STATE_READY,
          revision: 2,
          hasAudio: false,
        },
      ],
    });

    expect(afterReplacement).not.toBe(beforeReplacement);
  });

  it("changes when a selected pending track updates its subscription status", () => {
    const beforeSubscriptionUpdate = buildMediaStageRevision({
      selectedTrackRefId: "remote:user-2:screen_share",
      trackRefs: [
        {
          id: "remote:user-2:screen_share",
          participantId: "user-2",
          source: "screen_share",
          state: VIDEO_TRACK_STATE_PENDING,
          revision: 0,
          hasAudio: false,
          subscriptionStatus: "desired",
          streamState: "paused",
        },
      ],
    });
    const afterSubscriptionUpdate = buildMediaStageRevision({
      selectedTrackRefId: "remote:user-2:screen_share",
      trackRefs: [
        {
          id: "remote:user-2:screen_share",
          participantId: "user-2",
          source: "screen_share",
          state: VIDEO_TRACK_STATE_PENDING,
          revision: 0,
          hasAudio: false,
          subscriptionStatus: "subscribed",
          streamState: "active",
        },
      ],
    });

    expect(afterSubscriptionUpdate).not.toBe(beforeSubscriptionUpdate);
  });
});
