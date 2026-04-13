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
import { useEffect } from "react";
import {
  DEFAULT_CAPTURE_SOURCE_TYPE,
  filterDesktopCaptureSources,
  resolveDesktopCaptureSelection,
  useDesktopCaptureSources,
} from "../useDesktopCaptureSources";
import { getNativeScreenShareSession, listDesktopCaptureSources } from "@/lib/desktop";

jest.mock("@/lib/desktop", () => ({
  getNativeScreenShareSession: jest.fn(() => Promise.resolve(null)),
  listDesktopCaptureSources: jest.fn(() => Promise.resolve([])),
}), { virtual: true });

describe("useDesktopCaptureSources helpers", () => {
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const sources = [
    { id: "display-1", kind: "display", label: "Display 1" },
    { id: "window-1", kind: "window", label: "Window 1" },
  ];

  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  it("prefers the active native session source when it is still available", () => {
    expect(resolveDesktopCaptureSelection({
      sources,
      activeSession: {
        sourceId: "window-1",
        sourceKind: "window",
      },
    })).toEqual({
      sources,
      sourceType: "window",
      selectedSourceId: "window-1",
    });
  });

  it("falls back to the first source of the preferred kind", () => {
    expect(resolveDesktopCaptureSelection({
      sources,
      activeSession: {
        sourceKind: "window",
      },
    })).toEqual({
      sources,
      sourceType: "window",
      selectedSourceId: "window-1",
    });
  });

  it("falls back to the default source type when nothing else is available", () => {
    expect(resolveDesktopCaptureSelection({
      sources: [],
      activeSession: null,
    })).toEqual({
      sources: [],
      sourceType: DEFAULT_CAPTURE_SOURCE_TYPE,
      selectedSourceId: null,
    });
  });

  it("filters capture sources by their selected type", () => {
    expect(filterDesktopCaptureSources(sources, "window")).toEqual([
      { id: "window-1", kind: "window", label: "Window 1" },
    ]);
  });

  it("re-filters capture sources when the selected source type changes", async () => {
    listDesktopCaptureSources.mockResolvedValueOnce([
      { id: "display-1", kind: "display", label: "Display 1" },
      { id: "window-1", kind: "window", label: "Window 1" },
    ]);
    getNativeScreenShareSession.mockResolvedValueOnce(null);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const snapshots = [];

    function Probe() {
      const value = useDesktopCaptureSources({ enabled: true });

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
        await Promise.resolve();
      });

      const latestValue = snapshots.at(-1);
      expect(latestValue?.captureSourceType).toBe("display");
      expect(latestValue?.filteredCaptureSources.map((source) => source.id)).toEqual(["display-1"]);
      expect(typeof latestValue?.setSelectedCaptureSourceId).toBe("function");
      expect(typeof latestValue?.setCaptureSourceType).toBe("function");

      await act(async () => {
        latestValue.setCaptureSourceType("window");
      });

      expect(snapshots.at(-1)?.captureSourceType).toBe("window");
      expect(snapshots.at(-1)?.filteredCaptureSources.map((source) => source.id)).toEqual(["window-1"]);

      await act(async () => {
        await Promise.resolve();
      });

      expect(snapshots.at(-1)?.selectedCaptureSourceId).toBe("window-1");
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
