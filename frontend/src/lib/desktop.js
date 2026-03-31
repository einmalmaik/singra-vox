const DESKTOP_SECRET_SERVICE = "com.singravox.desktop";

export function isDesktopApp() {
  return typeof window !== "undefined" && Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__);
}

async function getInvoke() {
  if (!isDesktopApp()) return null;
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke;
}

async function getDeepLinkPlugin() {
  if (!isDesktopApp()) return null;
  try {
    return await import("@tauri-apps/plugin-deep-link");
  } catch {
    return null;
  }
}

export async function getDesktopSecret(key) {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return await invoke("get_secret", { service: DESKTOP_SECRET_SERVICE, key });
  } catch {
    return null;
  }
}

export async function setDesktopSecret(key, value) {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return invoke("store_secret", { service: DESKTOP_SECRET_SERVICE, key, value });
}

export async function deleteDesktopSecret(key) {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return await invoke("delete_secret", { service: DESKTOP_SECRET_SERVICE, key });
  } catch {
    return null;
  }
}

export async function getCurrentDeepLinks() {
  const plugin = await getDeepLinkPlugin();
  if (!plugin?.getCurrent) return [];
  try {
    return (await plugin.getCurrent()) || [];
  } catch {
    return [];
  }
}

export async function onDesktopDeepLinkOpen(handler) {
  const plugin = await getDeepLinkPlugin();
  if (!plugin?.onOpenUrl) return null;
  return plugin.onOpenUrl((urls) => handler(urls || []));
}
