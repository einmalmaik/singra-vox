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

// ── localStorage fallback (when OS keychain is unavailable) ──

function lsGet(key) {
  try { return localStorage.getItem(key) || null; } catch { return null; }
}

function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage full / blocked */ }
}

function lsRemove(key) {
  try { localStorage.removeItem(key); } catch { /* noop */ }
}

async function safeGetSecret(key) {
  try {
    const val = await getDesktopSecret(key);
    if (val) return val;
  } catch { /* keychain unavailable */ }
  return lsGet(key);
}

async function safeSetSecret(key, value) {
  // Write to both: keychain (primary) + localStorage (fallback)
  lsSet(key, value);
  try {
    await setDesktopSecret(key, value);
  } catch { /* keychain unavailable – localStorage is the backup */ }
}

async function safeDeleteSecret(key) {
  lsRemove(key);
  try {
    await deleteDesktopSecret(key);
  } catch { /* noop */ }
}

// ── Public API ──

export async function loadStoredSession(config) {
  if (!config?.isDesktop || !isDesktopApp()) {
    return { accessToken: null, refreshToken: null };
  }

  const [accessToken, refreshToken] = await Promise.all([
    safeGetSecret(ACCESS_TOKEN_KEY),
    safeGetSecret(REFRESH_TOKEN_KEY),
  ]);

  return {
    accessToken: accessToken || null,
    refreshToken: refreshToken || null,
  };
}

export async function saveStoredSession(config, session) {
  if (!config?.isDesktop || !isDesktopApp()) return;

  const ops = [];
  if (session?.accessToken)  ops.push(safeSetSecret(ACCESS_TOKEN_KEY, session.accessToken));
  if (session?.refreshToken) ops.push(safeSetSecret(REFRESH_TOKEN_KEY, session.refreshToken));
  await Promise.all(ops);
}

export async function clearStoredSession(config) {
  if (!config?.isDesktop || !isDesktopApp()) return;

  await Promise.all([
    safeDeleteSecret(ACCESS_TOKEN_KEY),
    safeDeleteSecret(REFRESH_TOKEN_KEY),
  ]);
}
