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

const INSTANCE_URL_STORAGE_KEY = "singravox.instance_url";

export function normalizeInstanceUrl(value) {
  return (value || "").trim().replace(/\/+$/, "");
}

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
    const instanceUrl = normalizeInstanceUrl(window.localStorage.getItem(INSTANCE_URL_STORAGE_KEY));
    return buildConfig(instanceUrl, "desktop");
  }
  return buildConfig(window.location.origin, "web");
}

export async function saveDesktopInstanceUrl(instanceUrl) {
  const normalizedUrl = normalizeInstanceUrl(instanceUrl);
  window.localStorage.setItem(INSTANCE_URL_STORAGE_KEY, normalizedUrl);
  return buildConfig(normalizedUrl, "desktop");
}

export async function clearDesktopInstanceUrl() {
  window.localStorage.removeItem(INSTANCE_URL_STORAGE_KEY);
}

