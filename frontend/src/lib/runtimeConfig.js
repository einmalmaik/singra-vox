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

