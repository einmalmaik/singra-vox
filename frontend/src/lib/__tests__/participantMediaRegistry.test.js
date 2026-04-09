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

import { Track } from "livekit-client";
import { createParticipantMediaRegistry } from "../participantMediaRegistry";

describe("ParticipantMediaRegistry", () => {
  it("resolves local proxy ownership from the stable proxy identity before attributes arrive", () => {
    const registry = createParticipantMediaRegistry();

    registry.upsertVideoTrack({
      participant: {
        identity: "screen-share:channel-1:user-1",
        attributes: {},
      },
      track: { id: "track-1" },
      source: Track.Source.ScreenShare,
    });

    expect(
      registry.findVideoTrackByUserId("user-1", Track.Source.ScreenShare)?.participantIdentity,
    ).toBe("screen-share:channel-1:user-1");
    expect(
      registry.listRemoteMediaParticipants({ localUserId: "user-1" }),
    ).toEqual([]);
  });

  it("keeps video-track removal stable when participant attributes arrive after subscribe", () => {
    const registry = createParticipantMediaRegistry();

    registry.upsertVideoTrack({
      participant: {
        identity: "screen-share:channel-1:proxy-user",
      },
      track: { id: "track-2" },
      source: Track.Source.ScreenShare,
    });

    registry.upsertParticipant({
      identity: "screen-share:channel-1:proxy-user",
      attributes: {
        owner_user_id: "user-2",
      },
    });

    expect(
      registry.findVideoTrackByUserId("user-2", Track.Source.ScreenShare)?.participantIdentity,
    ).toBe("screen-share:channel-1:proxy-user");
    expect(
      registry.removeVideoTrack("screen-share:channel-1:proxy-user", Track.Source.ScreenShare),
    ).toBe(true);
    expect(
      registry.findVideoTrackByUserId("user-2", Track.Source.ScreenShare),
    ).toBeNull();
  });

  it("increments the remote screen-share revision when the track object is replaced", () => {
    const registry = createParticipantMediaRegistry();

    registry.upsertVideoTrack({
      participant: {
        identity: "screen-share:channel-1:user-2",
        attributes: { owner_user_id: "user-2" },
      },
      track: { id: "track-a" },
      source: Track.Source.ScreenShare,
    });

    const firstRevision = registry.listRemoteMediaParticipants({ localUserId: "user-1" })[0];

    registry.upsertVideoTrack({
      participant: {
        identity: "screen-share:channel-1:user-2",
        attributes: { owner_user_id: "user-2" },
      },
      track: { id: "track-b" },
      source: Track.Source.ScreenShare,
    });

    const secondRevision = registry.listRemoteMediaParticipants({ localUserId: "user-1" })[0];

    expect(firstRevision.screenShareTrackRevision).toBe(1);
    expect(secondRevision.screenShareTrackRevision).toBe(2);
    expect(secondRevision.hasScreenShare).toBe(true);
  });
});
