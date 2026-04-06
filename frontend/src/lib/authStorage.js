/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { deleteDesktopSecret, getDesktopSecret, isDesktopApp, setDesktopSecret } from "@/lib/desktop";

const ACCESS_TOKEN_KEY = "auth.access_token";
const REFRESH_TOKEN_KEY = "auth.refresh_token";

export async function loadStoredSession(config) {
  if (!config?.isDesktop || !isDesktopApp()) {
    return { accessToken: null, refreshToken: null };
  }

  const [accessToken, refreshToken] = await Promise.all([
    getDesktopSecret(ACCESS_TOKEN_KEY),
    getDesktopSecret(REFRESH_TOKEN_KEY),
  ]);

  return {
    accessToken: accessToken || null,
    refreshToken: refreshToken || null,
  };
}

export async function saveStoredSession(config, session) {
  if (!config?.isDesktop || !isDesktopApp()) return;

  if (session?.accessToken) {
    await setDesktopSecret(ACCESS_TOKEN_KEY, session.accessToken);
  }
  if (session?.refreshToken) {
    await setDesktopSecret(REFRESH_TOKEN_KEY, session.refreshToken);
  }
}

export async function clearStoredSession(config) {
  if (!config?.isDesktop || !isDesktopApp()) return;

  await Promise.all([
    deleteDesktopSecret(ACCESS_TOKEN_KEY),
    deleteDesktopSecret(REFRESH_TOKEN_KEY),
  ]);
}

