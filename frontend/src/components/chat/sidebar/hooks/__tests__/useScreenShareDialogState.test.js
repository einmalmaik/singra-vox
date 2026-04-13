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
import { useScreenShareDialogState } from "../useScreenShareDialogState";

const mockUseDesktopCaptureSources = jest.fn();

jest.mock("sonner", () => ({
  toast: {
    error: jest.fn(),
  },
}), { virtual: true });

jest.mock("@/lib/appErrors", () => ({
  formatAppError: () => "error",
}), { virtual: true });

jest.mock("@/lib/screenSharePresets", () => ({
  DEFAULT_NATIVE_SCREEN_SHARE_PRESET_ID: "native-auto",
  DEFAULT_SCREEN_SHARE_PRESET_ID: "auto",
  getScreenSharePresetOptions: ({ isDesktop }) => (
    isDesktop ? [{ id: "native-auto", label: "Auto" }] : [{ id: "auto", label: "Auto" }]
  ),
  resolveScreenSharePreset: (presetId) => ({
    id: presetId,
    resolution: { width: 1920, height: 1080 },
  }),
}), { virtual: true });

jest.mock("@/hooks/useDesktopCaptureSources", () => ({
  useDesktopCaptureSources: (...args) => mockUseDesktopCaptureSources(...args),
}), { virtual: true });

describe("useScreenShareDialogState", () => {
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

  function createHarness() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let latestValue = null;

    function Probe() {
      const value = useScreenShareDialogState({
        isDesktop: true,
        useNativeScreenShare: true,
        screenShareCapabilities: { supportsSystemAudio: true },
        voiceChannel: { id: "voice-1" },
        voiceEngineRef: { current: { setScreenShareAudioVolume: jest.fn() } },
        screenShareEnabled: false,
        screenShareMeta: { sourceLabel: null, actualCaptureSettings: null },
        t: (key) => key,
      });

      useEffect(() => {
        latestValue = value;
      });

      return null;
    }

    return {
      get value() {
        return latestValue;
      },
      render: async () => {
        await act(async () => {
          root.render(<Probe />);
        });
      },
      cleanup: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      },
    };
  }

  it("wires the capture-source tabs to the desktop-capture hook state", async () => {
    mockUseDesktopCaptureSources.mockImplementation(({ enabled }) => (
      enabled
        ? {
          captureSourcesStatus: "ready",
          captureSources: [{ id: "window-1", kind: "window", label: "Window 1" }],
          captureSourceType: "window",
          selectedCaptureSourceId: "window-1",
          filteredCaptureSources: [{ id: "window-1", kind: "window", label: "Window 1" }],
          setCaptureSourceType: jest.fn(),
          setSelectedCaptureSourceId: jest.fn(),
        }
        : {
          captureSourcesStatus: "idle",
          captureSources: [],
          captureSourceType: "display",
          selectedCaptureSourceId: null,
          filteredCaptureSources: [],
          setCaptureSourceType: jest.fn(),
          setSelectedCaptureSourceId: jest.fn(),
        }
    ));
    const harness = createHarness();

    try {
      await harness.render();

      expect(harness.value.dialogProps.captureSourceType).toBe("display");
      expect(harness.value.dialogProps.filteredCaptureSources).toEqual([]);
      expect(mockUseDesktopCaptureSources).toHaveBeenLastCalledWith(expect.objectContaining({
        enabled: false,
        onError: expect.any(Function),
      }));
      expect(mockUseDesktopCaptureSources.mock.calls.at(-1)?.[0]?.sourceType).toBeUndefined();

      mockUseDesktopCaptureSources.mockReturnValue({
        captureSourcesStatus: "ready",
        captureSources: [{ id: "window-1", kind: "window", label: "Window 1" }],
        captureSourceType: "window",
        selectedCaptureSourceId: "window-1",
        filteredCaptureSources: [{ id: "window-1", kind: "window", label: "Window 1" }],
        setCaptureSourceType: jest.fn(),
        setSelectedCaptureSourceId: jest.fn(),
      });

      await act(async () => {
        harness.value.setOpen(true);
      });

      expect(harness.value.dialogProps.captureSourceType).toBe("window");
      expect(harness.value.dialogProps.filteredCaptureSources.map((source) => source.id)).toEqual(["window-1"]);
      expect(harness.value.dialogProps.selectedCaptureSourceId).toBe("window-1");
      expect(mockUseDesktopCaptureSources).toHaveBeenLastCalledWith(expect.objectContaining({
        enabled: true,
        onError: expect.any(Function),
      }));
      expect(mockUseDesktopCaptureSources.mock.calls.at(-1)?.[0]?.sourceType).toBeUndefined();
    } finally {
      await harness.cleanup();
    }
  });
});
