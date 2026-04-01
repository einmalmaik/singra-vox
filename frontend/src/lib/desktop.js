const DESKTOP_SECRET_SERVICE = "com.singravox.desktop";
let registeredDesktopPttShortcut = null;

export function isDesktopApp() {
  return typeof window !== "undefined" && Boolean(window.__TAURI__ || window.__TAURI_INTERNALS__);
}

async function getInvoke() {
  if (!isDesktopApp()) return null;
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke;
}

async function getGlobalShortcutApi() {
  if (!isDesktopApp()) return null;
  try {
    return await import("@tauri-apps/plugin-global-shortcut");
  } catch {
    return null;
  }
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

export async function registerDesktopPttHotkey(shortcut, handler) {
  const globalShortcut = await getGlobalShortcutApi();
  if (!globalShortcut) return false;

  if (registeredDesktopPttShortcut) {
    try {
      await globalShortcut.unregister(registeredDesktopPttShortcut);
    } catch {
      // Ignore stale unregister failures before re-registering the next shortcut.
    }
    registeredDesktopPttShortcut = null;
  }

  await globalShortcut.register(shortcut, (event) => {
    handler?.(event || null);
  });

  const isRegistered = await globalShortcut.isRegistered(shortcut);
  if (!isRegistered) {
    throw new Error("The selected shortcut is unavailable. Choose a different key or close the other app using it.");
  }

  registeredDesktopPttShortcut = shortcut;
  return true;
}

export async function unregisterDesktopPttHotkey(shortcut = null) {
  const globalShortcut = await getGlobalShortcutApi();
  if (!globalShortcut) return null;
  const shortcutToUnregister = shortcut || registeredDesktopPttShortcut;
  if (!shortcutToUnregister) return null;
  await globalShortcut.unregister(shortcutToUnregister);
  if (registeredDesktopPttShortcut === shortcutToUnregister) {
    registeredDesktopPttShortcut = null;
  }
  return true;
}
