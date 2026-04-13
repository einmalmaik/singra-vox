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
import api from "@/lib/api";
import { useServerWorkspaceState } from "../hooks/useServerWorkspaceState";

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
  },
}), { virtual: true });

jest.mock("@/lib/appErrors", () => ({
  formatAppError: () => "error",
}), { virtual: true });

jest.mock("@/lib/chatPersistence", () => ({
  getCachedChannelMessages: jest.fn(() => []),
  setCachedChannelMessages: jest.fn(),
}), { virtual: true });

jest.mock("@/lib/messageHistory", () => ({
  fetchMessageHistoryPage: jest.fn(),
  fetchMessageHistoryWindow: jest.fn(() => Promise.resolve({
    messages: [],
    nextBefore: null,
    hasMoreBefore: false,
  })),
  mergeTimelineMessages: (previous = [], next = []) => [...previous, ...next],
}), { virtual: true });

describe("useServerWorkspaceState", () => {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it("keeps action and mutator bags stable across parent rerenders", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const snapshots = [];

    const navigate = jest.fn();
    const t = (key) => key;

    function Probe({ tick }) {
      const value = useServerWorkspaceState({
        userId: "user-1",
        navigate,
        t,
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

  it("ignores stale channel refresh responses that resolve out of order", async () => {
    const deferred = () => {
      let resolve;
      const promise = new Promise((nextResolve) => {
        resolve = nextResolve;
      });
      return { promise, resolve };
    };

    const firstChannels = deferred();
    const firstViewerContext = deferred();
    const secondChannels = deferred();
    const secondViewerContext = deferred();
    const channelsCalls = [];
    const viewerCalls = [];

    api.get.mockImplementation((url) => {
      if (url.endsWith("/channels")) {
        const next = channelsCalls.length === 0 ? firstChannels : secondChannels;
        channelsCalls.push(url);
        return next.promise;
      }
      if (url.endsWith("/viewer-context")) {
        const next = viewerCalls.length === 0 ? firstViewerContext : secondViewerContext;
        viewerCalls.push(url);
        return next.promise;
      }
      return Promise.resolve({ data: [] });
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let latestValue = null;

    function Probe() {
      const value = useServerWorkspaceState({
        userId: "user-1",
        navigate: jest.fn(),
        t: (key) => key,
      });

      useEffect(() => {
        latestValue = value;
      });

      return null;
    }

    try {
      await act(async () => {
        root.render(<Probe />);
      });

      await act(async () => {
        latestValue.mutators.setCurrentServer({ id: "server-1", name: "Alpha" });
      });

      await act(async () => {
        void latestValue.actions.refreshChannels();
        void latestValue.actions.refreshChannels();
      });

      await act(async () => {
        secondChannels.resolve({ data: [{ id: "voice-2", type: "voice" }] });
        secondViewerContext.resolve({ data: { permissions: ["view_channel"] } });
        await Promise.resolve();
      });

      expect(latestValue.state.channels).toEqual([{ id: "voice-2", type: "voice" }]);

      await act(async () => {
        firstChannels.resolve({ data: [{ id: "voice-1", type: "voice" }] });
        firstViewerContext.resolve({ data: { permissions: ["stale"] } });
        await Promise.resolve();
      });

      expect(latestValue.state.channels).toEqual([{ id: "voice-2", type: "voice" }]);
      expect(latestValue.state.viewerContext).toEqual({ permissions: ["view_channel"] });
    } finally {
      api.get.mockImplementation(() => Promise.resolve({ data: [] }));
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
