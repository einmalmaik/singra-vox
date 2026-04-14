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

let mockDesktopUpdateState = {
  isDesktop: true,
  phase: "checking",
  progress: 0,
  update: null,
  errorMsg: null,
  showStartupGate: true,
};

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, options = {}) => {
      if (key === "updater.versionTransition") {
        return `${options.current} -> ${options.next}`;
      }
      return key;
    },
  }),
}), { virtual: true });

jest.mock("../DesktopUpdateState", () => ({
  DesktopUpdateProvider: ({ children }) => children,
  useDesktopUpdateState: () => mockDesktopUpdateState,
}), { virtual: true });

import de from "../../../i18n/locales/de/index.js";
import en from "../../../i18n/locales/en/index.js";
import {
  DesktopStartupUpdateGate,
  UpdateNotification,
} from "../UpdateNotification";
import {
  UPDATE_EVENT_NAMES,
  formatUpdateVersion,
  getUpdatePhaseLabel,
  registerUpdateListeners,
} from "../updateHelpers";

function resolveKey(locale, key) {
  return key.split(".").reduce((value, part) => value?.[part], locale);
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("UpdateNotification helpers", () => {
  it("returns localized update labels from the central locale registry", () => {
    expect(getUpdatePhaseLabel("checking", (key) => resolveKey(de, key))).toBe("Prüfe auf Updates…");
    expect(getUpdatePhaseLabel("available", (key) => resolveKey(en, key))).toBe("Update found. Download starts automatically.");
    expect(getUpdatePhaseLabel("error", (key) => resolveKey(de, key))).toBe("Die Update-Prüfung ist fehlgeschlagen.");
  });

  it("formats version transitions through locale-backed copy", () => {
    expect(formatUpdateVersion({
      currentVersion: "0.5.6",
      version: "0.5.7",
    }, (key, options) => resolveKey(en, key).replace("{{current}}", options.current).replace("{{next}}", options.next)))
      .toBe("0.5.6 -> 0.5.7");

    expect(formatUpdateVersion({
      current_version: "0.5.6",
      version: "0.5.7",
    }, (key, options) => resolveKey(en, key).replace("{{current}}", options.current).replace("{{next}}", options.next)))
      .toBe("0.5.6 -> 0.5.7");
  });

  it("cleans up listeners that resolve after the updater state has already disposed", async () => {
    const deferredListeners = new Map();
    const listen = jest.fn((eventName) => new Promise((resolve) => {
      const unlisten = jest.fn();
      deferredListeners.set(eventName, { resolve, unlisten });
    }));

    let disposed = false;
    const cleanup = registerUpdateListeners({
      listen,
      isDisposed: () => disposed,
      handlers: {
        onChecking: jest.fn(),
        onAvailable: jest.fn(),
        onNotAvailable: jest.fn(),
        onDownloadProgress: jest.fn(),
        onInstallStarted: jest.fn(),
        onError: jest.fn(),
      },
    });

    expect(listen).toHaveBeenCalledTimes(UPDATE_EVENT_NAMES.length);

    const checkingListener = deferredListeners.get("update-checking");
    checkingListener.resolve(checkingListener.unlisten);
    await Promise.resolve();

    disposed = true;
    cleanup();
    expect(checkingListener.unlisten).toHaveBeenCalledTimes(1);

    for (const eventName of UPDATE_EVENT_NAMES.filter((name) => name !== "update-checking")) {
      const deferred = deferredListeners.get(eventName);
      deferred.resolve(deferred.unlisten);
    }

    await Promise.resolve();

    for (const eventName of UPDATE_EVENT_NAMES.filter((name) => name !== "update-checking")) {
      expect(deferredListeners.get(eventName).unlisten).toHaveBeenCalledTimes(1);
    }
  });
});

describe("UpdateNotification rendering", () => {
  let container;
  let root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders the startup gate before the workspace is shown", async () => {
    mockDesktopUpdateState = {
      isDesktop: true,
      phase: "checking",
      progress: 0,
      update: { currentVersion: "0.5.8" },
      errorMsg: null,
      showStartupGate: true,
    };

    await act(async () => {
      root.render(<DesktopStartupUpdateGate />);
    });

    expect(container.querySelector("[data-testid='desktop-update-startup-gate']")).not.toBeNull();
    expect(container.textContent).toContain("updater.checking");
  });

  it("renders the compact banner once startup has finished", async () => {
    mockDesktopUpdateState = {
      isDesktop: true,
      phase: "downloading",
      progress: 42,
      update: { currentVersion: "0.5.8", version: "0.5.9" },
      errorMsg: null,
      showStartupGate: false,
    };

    await act(async () => {
      root.render(<UpdateNotification />);
    });

    expect(container.querySelector("[data-testid='desktop-update-startup-gate']")).toBeNull();
    expect(container.querySelector("[data-testid='update-notification']")).not.toBeNull();
    expect(container.textContent).toContain("0.5.8 -> 0.5.9");
    expect(container.textContent).toContain("42%");
  });
});
