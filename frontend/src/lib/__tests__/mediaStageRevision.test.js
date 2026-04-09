/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { buildMediaStageRevision, EMPTY_LOCAL_MEDIA_STATE } from "../mediaStageRevision";

describe("mediaStageRevision", () => {
  it("changes when the local native screen-share proxy track becomes attachable", () => {
    const baseInput = {
      cameraEnabled: false,
      screenShareEnabled: true,
      mediaParticipants: [],
    };

    const beforeTrackReady = buildMediaStageRevision({
      ...baseInput,
      localMediaState: EMPTY_LOCAL_MEDIA_STATE,
    });
    const afterTrackReady = buildMediaStageRevision({
      ...baseInput,
      localMediaState: {
        ...EMPTY_LOCAL_MEDIA_STATE,
        hasScreenShareTrack: true,
      },
    });

    expect(afterTrackReady).not.toBe(beforeTrackReady);
  });

  it("stays stable for identical remote participant sets regardless of order", () => {
    const revisionA = buildMediaStageRevision({
      mediaParticipants: [
        {
          userId: "user-2",
          hasCamera: false,
          hasScreenShare: true,
          hasScreenShareAudio: false,
          cameraTrackRevision: 0,
          screenShareTrackRevision: 1,
        },
        {
          userId: "user-3",
          hasCamera: true,
          hasScreenShare: false,
          hasScreenShareAudio: false,
          cameraTrackRevision: 1,
          screenShareTrackRevision: 0,
        },
      ],
    });
    const revisionB = buildMediaStageRevision({
      mediaParticipants: [
        {
          userId: "user-3",
          hasCamera: true,
          hasScreenShare: false,
          hasScreenShareAudio: false,
          cameraTrackRevision: 1,
          screenShareTrackRevision: 0,
        },
        {
          userId: "user-2",
          hasCamera: false,
          hasScreenShare: true,
          hasScreenShareAudio: false,
          cameraTrackRevision: 0,
          screenShareTrackRevision: 1,
        },
      ],
    });

    expect(revisionA).toBe(revisionB);
  });

  it("changes when a remote participant replaces the screen-share track without changing availability", () => {
    const beforeReplacement = buildMediaStageRevision({
      mediaParticipants: [
        {
          userId: "user-2",
          hasCamera: false,
          hasScreenShare: true,
          hasScreenShareAudio: false,
          cameraTrackRevision: 0,
          screenShareTrackRevision: 1,
        },
      ],
    });
    const afterReplacement = buildMediaStageRevision({
      mediaParticipants: [
        {
          userId: "user-2",
          hasCamera: false,
          hasScreenShare: true,
          hasScreenShareAudio: false,
          cameraTrackRevision: 0,
          screenShareTrackRevision: 2,
        },
      ],
    });

    expect(afterReplacement).not.toBe(beforeReplacement);
  });
});
