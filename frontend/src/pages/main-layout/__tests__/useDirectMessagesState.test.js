/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useDirectMessagesState } from "../hooks/useDirectMessagesState";
import { getCachedDmMessages, setCachedDmMessages } from "@/lib/chatPersistence";
import { fetchMessageHistoryPage, fetchMessageHistoryWindow, mergeTimelineMessages } from "@/lib/messageHistory";

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => Promise.resolve({ data: [] })),
  },
}), { virtual: true });

jest.mock("@/lib/chatPersistence", () => ({
  getCachedDmMessages: jest.fn(() => []),
  getPersistedWorkspaceState: jest.fn(() => ({
    view: "server",
    serverId: null,
    channelId: null,
    dmUserId: null,
  })),
  setCachedDmMessages: jest.fn(),
}), { virtual: true });

jest.mock("@/lib/messageHistory", () => ({
  fetchMessageHistoryPage: jest.fn(),
  fetchMessageHistoryWindow: jest.fn(),
  mergeTimelineMessages: (previous = [], next = []) => (
    [...previous, ...next].sort((left, right) => (
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
    ))
  ),
}), { virtual: true });

describe("useDirectMessagesState", () => {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads cached and remote history when selecting a dm user", async () => {
    getCachedDmMessages.mockReturnValueOnce([
      { id: "message-1", created_at: "2026-04-10T09:59:00.000Z", content: "cached" },
    ]);
    fetchMessageHistoryWindow.mockResolvedValueOnce({
      messages: [
        { id: "message-2", created_at: "2026-04-10T10:00:00.000Z", content: "remote" },
      ],
      nextBefore: "cursor-1",
      hasMoreBefore: true,
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const snapshots = [];

    function Probe() {
      const value = useDirectMessagesState({
        userId: "user-1",
        view: "dm",
        e2eeReady: false,
        fetchDmRecipients: jest.fn(),
        inspectRecipientTrust: jest.fn(),
      });

      useEffect(() => {
        snapshots.push(value);
      }, [value]);

      return null;
    }

    try {
      await act(async () => {
        root.render(<Probe />);
      });

      await act(async () => {
        await snapshots.at(-1).actions.selectDmUser({
          id: "user-2",
          username: "alice",
          display_name: "Alice",
        });
      });

      const latest = snapshots.at(-1);
      expect(latest.state.currentDmUser).toEqual({
        id: "user-2",
        username: "alice",
        display_name: "Alice",
      });
      expect(latest.state.dmMessages).toEqual(mergeTimelineMessages([
        { id: "message-1", created_at: "2026-04-10T09:59:00.000Z", content: "cached" },
      ], [
        { id: "message-2", created_at: "2026-04-10T10:00:00.000Z", content: "remote" },
      ]));
      expect(latest.state.dmHasOlderMessages).toBe(true);

      await act(async () => {
        root.unmount();
      });

      expect(setCachedDmMessages).toHaveBeenCalled();
      expect(fetchMessageHistoryPage).not.toHaveBeenCalled();
    } finally {
      container.remove();
    }
  });

  it("keeps action and mutator bags stable across parent rerenders", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const snapshots = [];

    const fetchDmRecipients = jest.fn();
    const inspectRecipientTrust = jest.fn();

    function Probe({ tick }) {
      const value = useDirectMessagesState({
        userId: "user-1",
        view: "dm",
        e2eeReady: false,
        fetchDmRecipients,
        inspectRecipientTrust,
      });

      useEffect(() => {
        snapshots.push({
          tick,
          actions: value.actions,
          mutators: value.mutators,
          refs: value.refs,
        });
      });

      return null;
    }

    try {
      await act(async () => {
        root.render(<Probe tick={0} />);
      });

      await act(async () => {
        root.render(<Probe tick={1} />);
      });

      const baseline = snapshots[0];
      const latest = snapshots[snapshots.length - 1];

      expect(snapshots.length).toBeGreaterThanOrEqual(2);
      expect(latest.actions).toBe(baseline.actions);
      expect(latest.mutators).toBe(baseline.mutators);
      expect(latest.refs).toBe(baseline.refs);
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
