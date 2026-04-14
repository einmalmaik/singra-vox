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
import { formatUpdateVersion, getUpdatePhaseLabel } from "../UpdateNotification";

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
});
