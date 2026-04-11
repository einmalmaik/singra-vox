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
import { useVoiceChannelState } from "../useVoiceChannelState";

var mockApi = {
  post: jest.fn(),
  put: jest.fn(),
};

var mockToast = {
  success: jest.fn(),
  error: jest.fn(),
};

var mockVoiceEngineFactory = jest.fn();

jest.mock("sonner", () => ({
  toast: {
    success: (...args) => mockToast.success(...args),
    error: (...args) => mockToast.error(...args),
  },
}), { virtual: true });

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    post: (...args) => mockApi.post(...args),
    put: (...args) => mockApi.put(...args),
  },
}), { virtual: true });

jest.mock("@/lib/appErrors", () => ({
  formatAppError: () => "error",
}), { virtual: true });

jest.mock("@/hooks/useDesktopPtt", () => ({
  useDesktopPtt: () => null,
}), { virtual: true });

jest.mock("@/hooks/useVoiceCleanup", () => ({
  useVoiceCleanup: () => {},
}), { virtual: true });

jest.mock("@/lib/voicePreferences", () => ({
  loadVoicePreferences: () => ({
    selfMuteEnabled: false,
    selfDeafenEnabled: false,
    pttEnabled: false,
    pttKey: null,
  }),
  saveVoicePreferences: (_userId, update) => ({
    selfMuteEnabled: Boolean(update?.selfMuteEnabled),
    selfDeafenEnabled: Boolean(update?.selfDeafenEnabled),
    pttEnabled: false,
    pttKey: null,
  }),
  subscribeVoicePreferences: () => () => {},
}), { virtual: true });

jest.mock("@/lib/videoTrackRefs", () => ({
  EMPTY_LOCAL_MEDIA_STATE: {
    audioEnabled: false,
    cameraEnabled: false,
    screenShareEnabled: false,
    hasScreenShareAudio: false,
  },
}), { virtual: true });

jest.mock("../../../../../lib/voice/voiceDebug", () => ({
  attachVoiceDebugEngine: () => () => {},
}), { virtual: true });

jest.mock("@/lib/voiceEngine", () => ({
  VoiceEngine: function VoiceEngine(...args) {
    return mockVoiceEngineFactory(...args);
  },
}), { virtual: true });

describe("useVoiceChannelState", () => {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const baseChannel = { id: "voice-1", name: "Talk", type: "voice", voice_states: [] };
  const user = { id: "user-1" };

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createHarness(initialChannels = [baseChannel]) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const voiceEngineRef = { current: null };
    const onRefreshChannels = jest.fn();
    let latestValue = null;

    function Probe({ channels }) {
      const value = useVoiceChannelState({
        serverId: "server-1",
        channels,
        user,
        config: { isDesktop: false },
        isDesktop: false,
        e2eeReady: true,
        voiceEngineRef,
        onRefreshChannels,
        t: (key) => key,
      });

      useEffect(() => {
        latestValue = value;
      });

      return null;
    }

    return {
      container,
      root,
      voiceEngineRef,
      onRefreshChannels,
      get value() {
        return latestValue;
      },
      render: async (channels) => {
        await act(async () => {
          root.render(<Probe channels={channels} />);
        });
      },
      cleanup: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      },
      initialChannels,
    };
  }

  function createEngine() {
    return {
      room: {},
      init: jest.fn(() => Promise.resolve()),
      addStateListener: jest.fn(() => () => {}),
      setMuted: jest.fn(),
      setDeafened: jest.fn(),
      setPreferences: jest.fn(() => Promise.resolve()),
      joinChannel: jest.fn(() => Promise.resolve()),
      disconnect: jest.fn(() => Promise.resolve()),
    };
  }

  it("keeps the local voice channel hydrated until the server snapshot confirms the join", async () => {
    const engine = createEngine();
    mockVoiceEngineFactory.mockReturnValue(engine);
    mockApi.post.mockResolvedValueOnce({ data: {} });
    mockApi.put.mockResolvedValueOnce({ data: { is_muted: false, is_deafened: false } });
    const harness = createHarness();

    try {
      await harness.render(harness.initialChannels);

      await act(async () => {
        await harness.value.joinVoice(baseChannel);
      });

      expect(harness.value.voiceChannel?.id).toBe("voice-1");
      expect(harness.voiceEngineRef.current).toBe(engine);

      await harness.render([baseChannel]);
      expect(harness.value.voiceChannel?.id).toBe("voice-1");

      await harness.render([{
        ...baseChannel,
        voice_states: [{ user_id: "user-1", is_muted: false, is_deafened: false }],
      }]);
      expect(harness.value.voiceChannel?.id).toBe("voice-1");
    } finally {
      await harness.cleanup();
    }
  });

  it("clears the local engine and hydration state after a failed join", async () => {
    const engine = createEngine();
    mockVoiceEngineFactory.mockReturnValue(engine);
    mockApi.post.mockRejectedValueOnce(new Error("join failed"));
    const harness = createHarness();

    try {
      await harness.render(harness.initialChannels);

      await act(async () => {
        await harness.value.joinVoice(baseChannel);
      });

      expect(harness.voiceEngineRef.current).toBeNull();
      expect(harness.value.voiceChannel).toBeNull();
      expect(engine.disconnect).toHaveBeenCalledTimes(1);
      expect(mockToast.error).toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });

  it("clears the hydrated voice state immediately on an explicit leave", async () => {
    const engine = createEngine();
    mockVoiceEngineFactory.mockReturnValue(engine);
    mockApi.post
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: {} });
    mockApi.put.mockResolvedValueOnce({ data: { is_muted: false, is_deafened: false } });
    const harness = createHarness();

    try {
      await harness.render(harness.initialChannels);

      await act(async () => {
        await harness.value.joinVoice(baseChannel);
      });

      await act(async () => {
        await harness.value.leaveVoice();
      });

      expect(harness.value.voiceChannel).toBeNull();
      expect(harness.voiceEngineRef.current).toBeNull();
      expect(engine.disconnect).toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });
});
