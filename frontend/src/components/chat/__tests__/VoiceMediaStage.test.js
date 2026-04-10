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

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, options = {}) => options.defaultValue || key,
  }),
}), { virtual: true });

jest.mock("@/contexts/RuntimeContext", () => ({
  useRuntime: () => ({
    config: { isDesktop: false },
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
          voiceEngineRef={{ current: { attachTrackRefElement, logger } }}
          trackRefId="local:user-1:screen_share"
          selectedTrackRef={{
            id: "local:user-1:screen_share",
            participantId: "user-1",
            source: "screen_share",
            isAvailable: true,
          }}
          participantName="Alice"
          source="screen_share"
        />,
      );
    });

    expect(attachTrackRefElement).toHaveBeenCalledWith(
      "local:user-1:screen_share",
      expect.any(HTMLVideoElement),
    );
    expect(container.querySelector("[data-testid='media-stage-loading']")).toBeNull();
    expect(container.querySelector("[data-testid='media-stage-unavailable']")).toBeNull();
    expect(container.querySelector("[data-testid='media-stage-video']")).not.toBeNull();
  });

  it("marks the stage as unavailable after bounded attach retries", async () => {
    jest.useFakeTimers();
    const attachTrackRefElement = jest.fn(() => null);
    const logger = { debug: jest.fn(), warn: jest.fn() };

    observeVideoReadiness.mockImplementation(() => jest.fn());

    await act(async () => {
      root.render(
        <VoiceMediaStage
          open
          onClose={() => {}}
          voiceEngineRef={{ current: { attachTrackRefElement, logger } }}
          trackRefId="remote:user-2:screen_share"
          selectedTrackRef={{
            id: "remote:user-2:screen_share",
            participantId: "user-2",
            source: "screen_share",
            isAvailable: false,
          }}
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
});
