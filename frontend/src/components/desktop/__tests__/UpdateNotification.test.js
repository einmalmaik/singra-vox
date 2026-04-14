/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
jest.mock("@/lib/desktop", () => ({
  isDesktopApp: jest.fn(() => true),
  listenTauri: jest.fn(),
}), { virtual: true });

import de from "../../../i18n/locales/de/index.js";
import en from "../../../i18n/locales/en/index.js";
import {
  formatUpdateVersion,
  getUpdatePhaseLabel,
  registerUpdateListeners,
  UPDATE_EVENT_NAMES,
} from "../UpdateNotification";

function resolveKey(locale, key) {
  return key.split(".").reduce((value, part) => value?.[part], locale);
}

describe("UpdateNotification helpers", () => {
  it("returns localized update labels from the central locale registry", () => {
    expect(getUpdatePhaseLabel("checking", (key) => resolveKey(de, key))).toBe("Pr\u00fcfe auf Updates\u2026");
    expect(getUpdatePhaseLabel("available", (key) => resolveKey(en, key))).toBe("Update found. Downloading automatically\u2026");
    expect(getUpdatePhaseLabel("error", (key) => resolveKey(de, key))).toBe("Update fehlgeschlagen");
  });

  it("formats version transitions for the visible desktop banner", () => {
    expect(formatUpdateVersion({
      currentVersion: "0.5.6",
      version: "0.5.7",
    })).toBe("0.5.6 \u2192 0.5.7");

    expect(formatUpdateVersion({
      current_version: "0.5.6",
      version: "0.5.7",
    })).toBe("0.5.6 \u2192 0.5.7");
  });

  it("cleans up listeners that resolve after the banner has already disposed", async () => {
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
