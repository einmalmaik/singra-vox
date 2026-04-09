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
        { userId: "user-2", hasCamera: false, hasScreenShare: true, hasScreenShareAudio: false },
        { userId: "user-3", hasCamera: true, hasScreenShare: false, hasScreenShareAudio: false },
      ],
    });
    const revisionB = buildMediaStageRevision({
      mediaParticipants: [
        { userId: "user-3", hasCamera: true, hasScreenShare: false, hasScreenShareAudio: false },
        { userId: "user-2", hasCamera: false, hasScreenShare: true, hasScreenShareAudio: false },
      ],
    });

    expect(revisionA).toBe(revisionB);
  });
});
