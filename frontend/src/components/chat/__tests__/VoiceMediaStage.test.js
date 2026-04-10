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

import { observeVideoReadiness } from "@/lib/videoReadiness";
import VoiceMediaStage from "../VoiceMediaStage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("VoiceMediaStage", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRuntimeConfig = { isDesktop: false };
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
});
