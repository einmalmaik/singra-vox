/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { deleteDesktopSecret, getDesktopSecret, isDesktopApp, setDesktopSecret } from "./desktop";

const ACCESS_TOKEN_KEY = "auth.access_token";
const REFRESH_TOKEN_KEY = "auth.refresh_token";

function usesDesktopKeychain(config) {
  return Boolean(config?.isDesktop && isDesktopApp());
}

// Older desktop builds mirrored auth tokens into localStorage. Remove those
// legacy copies, but never read or write them again for desktop sessions.
function purgeLegacyLocalStorageSession() {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Ignore restricted or unavailable web storage in desktop shells.
  }
}

async function loadDesktopSecret(key) {
  try {
    return (await getDesktopSecret(key)) || null;
  } catch {
    return null;
  }
}

async function saveDesktopSecret(key, value) {
  try {
    await setDesktopSecret(key, value);
    return true;
  } catch {
    return false;
  }
}

async function clearDesktopSecret(key) {
  try {
    await deleteDesktopSecret(key);
    return true;
  } catch {
    return false;
  }
}

export async function loadStoredSession(config) {
  if (!usesDesktopKeychain(config)) {
    return { accessToken: null, refreshToken: null };
  }

  purgeLegacyLocalStorageSession();

  const [accessToken, refreshToken] = await Promise.all([
    loadDesktopSecret(ACCESS_TOKEN_KEY),
    loadDesktopSecret(REFRESH_TOKEN_KEY),
  ]);

  return {
    accessToken: accessToken || null,
    refreshToken: refreshToken || null,
  };
}

export async function saveStoredSession(config, session) {
  if (!usesDesktopKeychain(config)) return false;

  const ops = [];
  if (session?.accessToken) ops.push(saveDesktopSecret(ACCESS_TOKEN_KEY, session.accessToken));
  if (session?.refreshToken) ops.push(saveDesktopSecret(REFRESH_TOKEN_KEY, session.refreshToken));

  const results = await Promise.all(ops);
  purgeLegacyLocalStorageSession();
  return results.every(Boolean);
}

export async function clearStoredSession(config) {
  if (!usesDesktopKeychain(config)) return false;

  const results = await Promise.all([
    clearDesktopSecret(ACCESS_TOKEN_KEY),
    clearDesktopSecret(REFRESH_TOKEN_KEY),
  ]);
  purgeLegacyLocalStorageSession();
  return results.every(Boolean);
}
