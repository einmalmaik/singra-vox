/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

let mockRuntimeConfig = { isDesktop: false };
var mockGetDesktopWindowFullscreen = jest.fn(() => Promise.resolve(false));
var mockObserveDesktopWindowFullscreen = jest.fn(() => Promise.resolve(jest.fn()));
var mockSetDesktopWindowFullscreen = jest.fn(() => Promise.resolve(true));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, options = {}) => options.defaultValue || key,
  }),
}), { virtual: true });

jest.mock("@/contexts/RuntimeContext", () => ({
  useRuntime: () => ({
    config: mockRuntimeConfig,
  }),
}), { virtual: true });

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogDescription: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogHeader: ({ children, ...props }) => <div {...props}>{children}</div>,
  DialogTitle: ({ children, ...props }) => <div {...props}>{children}</div>,
}), { virtual: true });

jest.mock("@/lib/videoReadiness", () => ({
  observeVideoReadiness: jest.fn(),
}), { virtual: true });

jest.mock("@/lib/desktop", () => ({
  getDesktopWindowFullscreen: (...args) => mockGetDesktopWindowFullscreen(...args),
  observeDesktopWindowFullscreen: (...args) => mockObserveDesktopWindowFullscreen(...args),
  setDesktopWindowFullscreen: (...args) => mockSetDesktopWindowFullscreen(...args),
}), { virtual: true });

import { observeVideoReadiness } from "@/lib/videoReadiness";
import VoiceMediaStage from "../VoiceMediaStage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("VoiceMediaStage", () => {
  let container;
  let root;
  const originalFullscreenDescriptor = Object.getOwnPropertyDescriptor(document, "fullscreenElement");
  const originalExitFullscreen = document.exitFullscreen;
  const originalRequestFullscreen = Element.prototype.requestFullscreen;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRuntimeConfig = { isDesktop: false };
    mockGetDesktopWindowFullscreen.mockResolvedValue(false);
    mockObserveDesktopWindowFullscreen.mockResolvedValue(jest.fn());
    mockSetDesktopWindowFullscreen.mockResolvedValue(true);
    jest.spyOn(window.HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
    jest.spyOn(window.HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    if (originalFullscreenDescriptor) {
      Object.defineProperty(document, "fullscreenElement", originalFullscreenDescriptor);
    } else {
      delete document.fullscreenElement;
    }
    document.exitFullscreen = originalExitFullscreen;
    Element.prototype.requestFullscreen = originalRequestFullscreen;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it("marks the stage as ready after the first renderable frame", async () => {
    const detach = jest.fn();
    const attachTrackRefElement = jest.fn(() => detach);
    const ensureTrackRefPlayback = jest.fn(() => true);
    const logger = { debug: jest.fn(), warn: jest.fn() };

    observeVideoReadiness.mockImplementation((_element, onReady) => {
      onReady();
      return jest.fn();
    });

    await act(async () => {
      root.render(
        <VoiceMediaStage
          open
          onClose={() => {}}
          voiceEngineRef={{ current: { attachTrackRefElement, ensureTrackRefPlayback, logger } }}
          trackRefId="local:user-1:screen_share"
          selectedTrackAvailable
          participantName="Alice"
          source="screen_share"
        />,
      );
    });

    expect(attachTrackRefElement).toHaveBeenCalledWith(
      "local:user-1:screen_share",
      expect.any(HTMLVideoElement),
    );
    expect(ensureTrackRefPlayback).toHaveBeenCalledWith("local:user-1:screen_share");
    expect(container.querySelector("[data-testid='media-stage-loading']")).toBeNull();
    expect(container.querySelector("[data-testid='media-stage-unavailable']")).toBeNull();
    expect(container.querySelector("[data-testid='media-stage-video']")).not.toBeNull();
  });

  it("marks the stage as unavailable after bounded attach retries", async () => {
    jest.useFakeTimers();
    mockRuntimeConfig = { isDesktop: true };
    const attachTrackRefElement = jest.fn(() => null);
    const ensureTrackRefPlayback = jest.fn(() => false);
    const logger = { debug: jest.fn(), warn: jest.fn() };

    observeVideoReadiness.mockImplementation(() => jest.fn());

    await act(async () => {
      root.render(
        <VoiceMediaStage
          open
          onClose={() => {}}
          voiceEngineRef={{ current: { attachTrackRefElement, ensureTrackRefPlayback, logger } }}
          trackRefId="remote:user-2:screen_share"
          selectedTrackAvailable={false}
          participantName="Bob"
          source="screen_share"
        />,
      );
    });

    await act(async () => {
      jest.advanceTimersByTime(8 * 500 + 50);
    });

    expect(container.querySelector("[data-testid='media-stage-unavailable']")).not.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "stage unavailable after bounded attach retries",
      expect.objectContaining({
        event: "stage_unavailable",
        trackRefId: "remote:user-2:screen_share",
      }),
    );
  });

  it("requests a playback recovery wakeup before retrying an attached-but-stalled stream", async () => {
    jest.useFakeTimers();
    const detach = jest.fn();
    const attachTrackRefElement = jest.fn(() => detach);
    const ensureTrackRefPlayback = jest.fn(() => true);
    const recoverTrackRefPlayback = jest.fn(() => true);
    const logger = { debug: jest.fn(), warn: jest.fn() };

    observeVideoReadiness.mockImplementation(() => jest.fn());

    await act(async () => {
      root.render(
        <VoiceMediaStage
          open
          onClose={() => {}}
          voiceEngineRef={{
            current: {
              attachTrackRefElement,
              ensureTrackRefPlayback,
              recoverTrackRefPlayback,
              logger,
            },
          }}
          trackRefId="remote:user-2:screen_share"
          selectedTrackAvailable
          participantName="Bob"
          source="screen_share"
        />,
      );
    });

    await act(async () => {
      jest.advanceTimersByTime(2_260);
    });

    expect(recoverTrackRefPlayback).toHaveBeenCalledWith("remote:user-2:screen_share");
    expect(attachTrackRefElement).toHaveBeenCalledTimes(2);
  });

  it("requests a playback recovery wakeup when the track never becomes attachable on its own", async () => {
    jest.useFakeTimers();
    const attachTrackRefElement = jest.fn(() => null);
    const ensureTrackRefPlayback = jest.fn(() => false);
    const recoverTrackRefPlayback = jest.fn(() => true);
    const logger = { debug: jest.fn(), warn: jest.fn() };

    observeVideoReadiness.mockImplementation(() => jest.fn());

    await act(async () => {
      root.render(
        <VoiceMediaStage
          open
          onClose={() => {}}
          voiceEngineRef={{
            current: {
              attachTrackRefElement,
              ensureTrackRefPlayback,
              recoverTrackRefPlayback,
              logger,
            },
          }}
          trackRefId="remote:user-2:screen_share"
          selectedTrackAvailable={false}
          participantName="Bob"
          source="screen_share"
        />,
      );
    });

    await act(async () => {
      jest.advanceTimersByTime(2_100);
    });

    expect(recoverTrackRefPlayback).toHaveBeenCalledWith("remote:user-2:screen_share");
    expect(attachTrackRefElement).toHaveBeenCalledTimes(5);
  });

  it("keeps issuing bounded pending recoveries in web mode while the stream stays stuck", async () => {
    jest.useFakeTimers();
    const attachTrackRefElement = jest.fn(() => null);
    const ensureTrackRefPlayback = jest.fn(() => false);
    const recoverTrackRefPlayback = jest.fn(() => true);
    const logger = { debug: jest.fn(), warn: jest.fn() };

    observeVideoReadiness.mockImplementation(() => jest.fn());

    await act(async () => {
      root.render(
        <VoiceMediaStage
          open
          onClose={() => {}}
          voiceEngineRef={{
            current: {
              attachTrackRefElement,
              ensureTrackRefPlayback,
              recoverTrackRefPlayback,
              logger,
            },
          }}
          trackRefId="remote:user-2:screen_share"
          selectedTrackAvailable={false}
          participantName="Bob"
          source="screen_share"
        />,
      );
    });

    await act(async () => {
      jest.advanceTimersByTime(3_600);
    });

    expect(recoverTrackRefPlayback).toHaveBeenCalledTimes(3);
  });

  it("keeps the desktop recovery policy unchanged", async () => {
    jest.useFakeTimers();
    mockRuntimeConfig = { isDesktop: true };
    const attachTrackRefElement = jest.fn(() => null);
    const ensureTrackRefPlayback = jest.fn(() => false);
    const recoverTrackRefPlayback = jest.fn(() => true);
    const logger = { debug: jest.fn(), warn: jest.fn() };

    observeVideoReadiness.mockImplementation(() => jest.fn());

    await act(async () => {
      root.render(
        <VoiceMediaStage
          open
          onClose={() => {}}
          voiceEngineRef={{
            current: {
              attachTrackRefElement,
              ensureTrackRefPlayback,
              recoverTrackRefPlayback,
              logger,
            },
          }}
          trackRefId="remote:user-2:screen_share"
          selectedTrackAvailable={false}
          participantName="Bob"
          source="screen_share"
        />,
      );
    });

    await act(async () => {
      jest.advanceTimersByTime(4_500);
    });

    expect(recoverTrackRefPlayback).toHaveBeenCalledTimes(1);
  });

  it("does not restart the attach effect when only the projected track object would have changed", async () => {
    const detach = jest.fn();
    const attachTrackRefElement = jest.fn(() => detach);
    const ensureTrackRefPlayback = jest.fn(() => true);
    const logger = { debug: jest.fn(), warn: jest.fn() };
    const voiceEngineRef = { current: { attachTrackRefElement, ensureTrackRefPlayback, logger } };

    observeVideoReadiness.mockImplementation((_element, onReady) => {
      onReady();
      return jest.fn();
    });

    await act(async () => {
      root.render(
        <VoiceMediaStage
          open
          onClose={() => {}}
          voiceEngineRef={voiceEngineRef}
          trackRefId="remote:user-2:screen_share"
          selectedTrackAvailable
          participantName="Bob"
          source="screen_share"
        />,
      );
    });

    await act(async () => {
      root.render(
        <VoiceMediaStage
          open
          onClose={() => {}}
          voiceEngineRef={voiceEngineRef}
          trackRefId="remote:user-2:screen_share"
          selectedTrackAvailable
          participantName="Bob"
          source="screen_share"
        />,
      );
    });

    expect(attachTrackRefElement).toHaveBeenCalledTimes(1);
  });

  it("uses DOM fullscreen in web mode", async () => {
    let fullscreenElement = null;
    const requestFullscreen = jest.fn(async function requestFullscreenMock() {
      fullscreenElement = this;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    const exitFullscreen = jest.fn(async () => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    document.exitFullscreen = exitFullscreen;
    Element.prototype.requestFullscreen = requestFullscreen;

    observeVideoReadiness.mockImplementation((_element, onReady) => {
      onReady();
      return jest.fn();
    });

    await act(async () => {
      root.render(
        <VoiceMediaStage
          open
          onClose={() => {}}
          voiceEngineRef={{ current: { attachTrackRefElement: jest.fn(() => jest.fn()), ensureTrackRefPlayback: jest.fn(), logger: { debug: jest.fn(), warn: jest.fn() } } }}
          trackRefId="remote:user-2:screen_share"
          selectedTrackAvailable
          participantName="Bob"
          source="screen_share"
        />,
      );
    });

    await act(async () => {
      container.querySelector("[data-testid='media-stage-fullscreen']").click();
    });

    expect(requestFullscreen).toHaveBeenCalled();
    expect(mockSetDesktopWindowFullscreen).not.toHaveBeenCalled();
  });

  it("uses native desktop fullscreen in Tauri mode and exits it on close", async () => {
    mockRuntimeConfig = { isDesktop: true };
    let desktopFullscreenListener = null;
    mockObserveDesktopWindowFullscreen.mockImplementation(async (handler) => {
      desktopFullscreenListener = handler;
      return jest.fn();
    });

    observeVideoReadiness.mockImplementation((_element, onReady) => {
      onReady();
      return jest.fn();
    });

    await act(async () => {
      root.render(
        <VoiceMediaStage
          open
          onClose={() => {}}
          voiceEngineRef={{ current: { attachTrackRefElement: jest.fn(() => jest.fn()), ensureTrackRefPlayback: jest.fn(), logger: { debug: jest.fn(), warn: jest.fn() } } }}
          trackRefId="remote:user-2:screen_share"
          selectedTrackAvailable
          participantName="Bob"
          source="screen_share"
        />,
      );
    });

    await act(async () => {
      container.querySelector("[data-testid='media-stage-fullscreen']").click();
    });

    expect(mockSetDesktopWindowFullscreen).toHaveBeenCalledWith(true);

    await act(async () => {
      desktopFullscreenListener?.(true);
    });

    expect(container.textContent).toContain("Vollbild verlassen");

    await act(async () => {
      root.render(
        <VoiceMediaStage
          open={false}
          onClose={() => {}}
          voiceEngineRef={{ current: null }}
          trackRefId="remote:user-2:screen_share"
          selectedTrackAvailable
          participantName="Bob"
          source="screen_share"
        />,
      );
    });

    expect(mockSetDesktopWindowFullscreen).toHaveBeenCalledWith(false);
  });
});
