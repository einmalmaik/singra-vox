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
import { useMainLayoutSocket } from "../hooks/useMainLayoutSocket";

function MockWebSocket(url) {
  this.url = url;
  this.readyState = MockWebSocket.OPEN;
  this.send = jest.fn();
  this.close = jest.fn((code, reason) => {
    this.readyState = MockWebSocket.CLOSING;
    if (this.onclose) {
      this.onclose({ code, reason });
    }
  });
  MockWebSocket.instances.push(this);
}

MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.instances = [];

MockWebSocket.prototype.emitOpen = function emitOpen() {
  if (this.onopen) {
    this.onopen();
  }
};

MockWebSocket.prototype.emitMessage = function emitMessage(payload) {
  if (this.onmessage) {
    this.onmessage({ data: JSON.stringify(payload) });
  }
};

MockWebSocket.prototype.emitClose = function emitClose() {
  this.readyState = MockWebSocket.CLOSING;
  if (this.onclose) {
    this.onclose();
  }
};

describe("useMainLayoutSocket", () => {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const originalWebSocket = global.WebSocket;

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    global.WebSocket = originalWebSocket;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    MockWebSocket.instances = [];
    global.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function mountSocketHook(overrides) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const snapshots = [];
    const props = {
      token: "token-1",
      wsBase: "ws://localhost:8001",
      isDesktop: false,
      currentServerRef: { current: { id: "server-1" } },
      currentDmUserRef: { current: { id: "dm-1" } },
      onRefreshCurrentServer: jest.fn(),
      onRefreshDmConversations: jest.fn(),
      onEvent: jest.fn(),
      onSessionRevoked: jest.fn(),
      ...(overrides || {}),
    };

    function Probe() {
      const value = useMainLayoutSocket(props);

      useEffect(() => {
        snapshots.push(value);
      }, [value]);

      return null;
    }

    await act(async () => {
      root.render(<Probe />);
    });

    return {
      props,
      latest() {
        return snapshots[snapshots.length - 1];
      },
      cleanup: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      },
    };
  }

  it("does not reconnect after a manual close", async () => {
    const harness = await mountSocketHook();

    try {
      const socket = MockWebSocket.instances[0];
      await act(async () => {
        socket.emitOpen();
      });

      await act(async () => {
        harness.latest().closeConnection(4000, "manual");
      });

      await act(async () => {
        jest.advanceTimersByTime(30000);
      });

      expect(MockWebSocket.instances).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("reconnects with backoff after a normal close", async () => {
    const harness = await mountSocketHook();

    try {
      const socket = MockWebSocket.instances[0];
      await act(async () => {
        socket.emitOpen();
        socket.emitClose();
      });

      await act(async () => {
        jest.advanceTimersByTime(999);
      });
      expect(MockWebSocket.instances).toHaveLength(1);

      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(MockWebSocket.instances).toHaveLength(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("stops reconnecting after session_revoked", async () => {
    const onSessionRevoked = jest.fn();
    const harness = await mountSocketHook({ onSessionRevoked });

    try {
      const socket = MockWebSocket.instances[0];
      await act(async () => {
        socket.emitOpen();
        socket.emitMessage({ type: "session_revoked" });
      });

      expect(onSessionRevoked).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(30000);
      });
      expect(MockWebSocket.instances).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("dispatches non-control events and refreshes active workspace state on open", async () => {
    const onEvent = jest.fn();
    const onRefreshCurrentServer = jest.fn();
    const onRefreshDmConversations = jest.fn();
    const harness = await mountSocketHook({
      onEvent,
      onRefreshCurrentServer,
      onRefreshDmConversations,
    });

    try {
      const socket = MockWebSocket.instances[0];
      await act(async () => {
        socket.emitOpen();
      });

      expect(onRefreshCurrentServer).toHaveBeenCalledWith("server-1");
      expect(onRefreshDmConversations).toHaveBeenCalledTimes(1);

      await act(async () => {
        socket.emitMessage({ type: "voice_join", channel_id: "voice-1" });
        socket.emitMessage({ type: "dm_message", message: { id: "message-1" } });
      });

      expect(onEvent).toHaveBeenCalledTimes(2);
      expect(onEvent).toHaveBeenNthCalledWith(1, { type: "voice_join", channel_id: "voice-1" });
      expect(onEvent).toHaveBeenNthCalledWith(2, { type: "dm_message", message: { id: "message-1" } });
    } finally {
      await harness.cleanup();
    }
  });
});
