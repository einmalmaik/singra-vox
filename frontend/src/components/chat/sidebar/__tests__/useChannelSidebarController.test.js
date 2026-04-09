/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { buildChannelParticipantEntries } from "../channelSidebarUtils";

describe("useChannelSidebarController helpers", () => {
  const t = (key) => key;

  it("projects voice participant entries with local and remote media state", () => {
    const entries = buildChannelParticipantEntries({
      channels: [
        {
          id: "voice-1",
          type: "voice",
          voice_states: [
            { user_id: "user-1", user: { display_name: "Alice" }, is_muted: false, is_deafened: false },
            { user_id: "user-2", user: { display_name: "Bob" }, is_muted: true, is_deafened: false },
          ],
        },
      ],
      user: { id: "user-1" },
      server: { owner_id: "user-2" },
      localVoicePreferences: {
        locallyMutedParticipants: { "user-2": true },
        perUserVolumes: { "user-2": 45 },
      },
      isDeafened: false,
      voiceActivity: {
        localSpeaking: true,
        activeSpeakerIds: ["user-2"],
      },
      mediaByUserId: new Map([
        ["user-2", { hasCamera: true, hasScreenShare: false }],
      ]),
      cameraEnabled: false,
      screenShareEnabled: true,
      t,
    });

    expect(entries["voice-1"]).toEqual([
      expect.objectContaining({
        id: "user-1",
        speaking: true,
        hasCamera: false,
        hasScreenShare: true,
      }),
      expect.objectContaining({
        id: "user-2",
        locallyMuted: true,
        volume: 45,
        hasCamera: true,
        hasScreenShare: false,
        isMuted: true,
        isServerOwner: true,
      }),
    ]);
  });
});
