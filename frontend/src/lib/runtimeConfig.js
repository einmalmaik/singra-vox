/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { isDesktopApp } from "@/lib/desktop";
import {
  clearActiveInstanceUrl,
  getActiveInstanceUrl,
  getReconnectInstanceUrl,
  normalizeInstanceUrl,
  rememberConnectedInstance,
  requiresManualInstanceSelection,
  setActiveInstanceUrl,
  setManualInstanceSelectionRequired,
} from "./instanceManager";

function buildConfig(instanceUrl, platform) {
  const normalizedUrl = normalizeInstanceUrl(instanceUrl);
  return {
    platform,
    isDesktop: platform === "desktop",
    needsConnection: !normalizedUrl,
    instanceUrl: normalizedUrl,
    apiBase: normalizedUrl ? `${normalizedUrl}/api` : "",
    wsBase: normalizedUrl ? normalizedUrl.replace(/^http/, "ws") : "",
    assetBase: normalizedUrl,
    authMode: platform === "desktop" ? "token" : "cookie",
  };
}

export async function loadRuntimeConfig() {
  if (isDesktopApp()) {
    let instanceUrl = getActiveInstanceUrl();
    if (!instanceUrl && !requiresManualInstanceSelection()) {
      instanceUrl = getReconnectInstanceUrl();
      if (instanceUrl) {
        setActiveInstanceUrl(instanceUrl);
        setManualInstanceSelectionRequired(false);
      }
    }
    return buildConfig(instanceUrl, "desktop");
  }
  return buildConfig(window.location.origin, "web");
}

export async function saveDesktopInstanceUrl(instanceUrl) {
  const normalizedUrl = normalizeInstanceUrl(instanceUrl);
  rememberConnectedInstance(normalizedUrl);
  return buildConfig(normalizedUrl, "desktop");
}

export async function clearDesktopInstanceUrl() {
  clearActiveInstanceUrl();
  setManualInstanceSelectionRequired(true);
}

