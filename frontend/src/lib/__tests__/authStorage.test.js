/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import {
  clearStoredSession,
  loadStoredSession,
  saveStoredSession,
} from "../authStorage";
import {
  deleteDesktopSecret,
  getDesktopSecret,
  isDesktopApp,
  setDesktopSecret,
} from "../desktop";

jest.mock("../desktop", () => ({
  deleteDesktopSecret: jest.fn(),
  getDesktopSecret: jest.fn(),
  isDesktopApp: jest.fn(),
  setDesktopSecret: jest.fn(),
}));

describe("authStorage desktop persistence", () => {
  const desktopConfig = { isDesktop: true };

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    isDesktopApp.mockReturnValue(true);
    getDesktopSecret.mockResolvedValue(null);
    setDesktopSecret.mockResolvedValue("ok");
    deleteDesktopSecret.mockResolvedValue("ok");
  });

  it("persists desktop sessions only into the OS keychain", async () => {
    window.localStorage.setItem("auth.access_token", "legacy-access");
    window.localStorage.setItem("auth.refresh_token", "legacy-refresh");
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");

    const persisted = await saveStoredSession(desktopConfig, {
      accessToken: "next-access",
      refreshToken: "next-refresh",
    });

    expect(persisted).toBe(true);
    expect(setDesktopSecret).toHaveBeenNthCalledWith(1, "auth.access_token", "next-access");
    expect(setDesktopSecret).toHaveBeenNthCalledWith(2, "auth.refresh_token", "next-refresh");
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("auth.access_token")).toBeNull();
    expect(window.localStorage.getItem("auth.refresh_token")).toBeNull();

    setItemSpy.mockRestore();
  });

  it("does not fall back to localStorage when reading desktop sessions", async () => {
    window.localStorage.setItem("auth.access_token", "legacy-access");
    window.localStorage.setItem("auth.refresh_token", "legacy-refresh");
    const getItemSpy = jest.spyOn(Storage.prototype, "getItem");

    const session = await loadStoredSession(desktopConfig);

    expect(session).toEqual({ accessToken: null, refreshToken: null });
    expect(getDesktopSecret).toHaveBeenNthCalledWith(1, "auth.access_token");
    expect(getDesktopSecret).toHaveBeenNthCalledWith(2, "auth.refresh_token");
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("auth.access_token")).toBeNull();
    expect(window.localStorage.getItem("auth.refresh_token")).toBeNull();

    getItemSpy.mockRestore();
  });

  it("clears keychain state and legacy localStorage copies on logout", async () => {
    window.localStorage.setItem("auth.access_token", "legacy-access");
    window.localStorage.setItem("auth.refresh_token", "legacy-refresh");

    const cleared = await clearStoredSession(desktopConfig);

    expect(cleared).toBe(true);
    expect(deleteDesktopSecret).toHaveBeenNthCalledWith(1, "auth.access_token");
    expect(deleteDesktopSecret).toHaveBeenNthCalledWith(2, "auth.refresh_token");
    expect(window.localStorage.getItem("auth.access_token")).toBeNull();
    expect(window.localStorage.getItem("auth.refresh_token")).toBeNull();
  });
});
