/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import {
  mergeMessages,
  removeMember,
  removeVoiceUser,
  upsertById,
  upsertMember,
  upsertVoiceState,
} from "../mainLayoutState";

describe("mainLayoutState helpers", () => {
  it("upserts generic entries by id", () => {
    expect(upsertById([{ id: "1", name: "Alpha" }], { id: "1", name: "Beta" })).toEqual([
      { id: "1", name: "Beta" },
    ]);
    expect(upsertById([], { id: "2", name: "Gamma" })).toEqual([
      { id: "2", name: "Gamma" },
    ]);
  });

  it("merges member user payloads without dropping nested fields", () => {
    expect(upsertMember([
      { user_id: "user-1", user: { username: "alice", status: "offline" } },
    ], {
      user_id: "user-1",
      nickname: "Ali",
      user: { status: "online" },
    })).toEqual([
      {
        user_id: "user-1",
        nickname: "Ali",
        user: {
          username: "alice",
          status: "online",
        },
      },
    ]);
  });

  it("removes members and voice states by user id", () => {
    expect(removeMember([
      { user_id: "user-1" },
      { user_id: "user-2" },
    ], "user-1")).toEqual([
      { user_id: "user-2" },
    ]);

    expect(removeVoiceUser([
      { id: "text-1", type: "text" },
      { id: "voice-1", type: "voice", voice_states: [{ user_id: "user-1" }, { user_id: "user-2" }] },
    ], "user-1")).toEqual([
      { id: "text-1", type: "text" },
      { id: "voice-1", type: "voice", voice_states: [{ user_id: "user-2" }] },
    ]);
  });

  it("moves a voice state into the active channel and evicts stale duplicates", () => {
    expect(upsertVoiceState([
      { id: "voice-1", type: "voice", voice_states: [{ user_id: "user-1", muted: false }] },
      { id: "voice-2", type: "voice", voice_states: [{ user_id: "user-1", muted: true }] },
    ], "voice-2", {
      user_id: "user-1",
      muted: false,
    })).toEqual([
      { id: "voice-1", type: "voice", voice_states: [] },
      { id: "voice-2", type: "voice", voice_states: [{ user_id: "user-1", muted: false }] },
    ]);
  });

  it("merges messages by id and keeps ascending time order", () => {
    const initial = [
      { id: "message-2", created_at: "2026-04-10T10:00:02.000Z", content: "later" },
    ];

    expect(mergeMessages(initial, {
      id: "message-1",
      created_at: "2026-04-10T10:00:01.000Z",
      content: "earlier",
    })).toEqual([
      { id: "message-1", created_at: "2026-04-10T10:00:01.000Z", content: "earlier" },
      { id: "message-2", created_at: "2026-04-10T10:00:02.000Z", content: "later" },
    ]);

    expect(mergeMessages(initial, {
      id: "message-2",
      created_at: "2026-04-10T10:00:02.000Z",
      content: "updated",
    })).toEqual([
      { id: "message-2", created_at: "2026-04-10T10:00:02.000Z", content: "updated" },
    ]);
  });
});
