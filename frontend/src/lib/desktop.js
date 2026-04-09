/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
const DESKTOP_SECRET_SERVICE = "com.singravox.desktop";
let registeredDesktopPttShortcut = null;
let desktopPttEventUnlisten = null;
let desktopPttEventHandler = null;

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

async function getEventApi() {
  if (!isDesktopApp()) return null;
  try {
    return await import("@tauri-apps/api/event");
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

async function ensureDesktopPttEventBridge() {
  if (desktopPttEventUnlisten) {
    return desktopPttEventUnlisten;
  }

  const eventApi = await getEventApi();
  if (!eventApi?.listen) {
    return null;
  }

  desktopPttEventUnlisten = await eventApi.listen("desktop-ptt", (event) => {
    desktopPttEventHandler?.(event?.payload || null);
  });
  return desktopPttEventUnlisten;
}

export async function getDesktopRuntimeInfo() {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return await invoke("get_desktop_runtime_info");
  } catch {
    return null;
  }
}

export async function configureDesktopPttListener(shortcut, enabled, handler) {
  const invoke = await getInvoke();
  if (!invoke) return null;
  const runtimeInfo = await getDesktopRuntimeInfo();
  if (!runtimeInfo || runtimeInfo.pttMode !== "low-level-hook") {
    return null;
  }

  await ensureDesktopPttEventBridge();
  desktopPttEventHandler = typeof handler === "function" ? handler : null;
  return invoke("configure_ptt_listener", {
    shortcut: shortcut || null,
    enabled: Boolean(enabled),
  });
}

export async function clearDesktopPttListener() {
  const invoke = await getInvoke();
  if (!invoke) return null;
  desktopPttEventHandler = null;
  try {
    return await invoke("clear_ptt_listener");
  } catch {
    return null;
  }
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

export async function listDesktopCaptureSources() {
  const invoke = await getInvoke();
  if (!invoke) return [];
  return invoke("list_capture_sources");
}

export async function getNativeScreenShareSession() {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return invoke("get_native_screen_share_session");
}

export async function startNativeScreenShare(input) {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return invoke("start_native_screen_share", { input });
}

export async function stopNativeScreenShare() {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return invoke("stop_native_screen_share");
}

export async function updateNativeScreenShareKey(sharedMediaKeyB64, keyIndex = 0) {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return invoke("update_native_screen_share_key", {
    sharedMediaKeyB64,
    keyIndex,
  });
}

export async function updateNativeScreenShareAudioVolume(volume) {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return invoke("update_native_screen_share_audio_volume", { volume });
}

export async function openExternalUrl(url) {
  if (!url) return;
  if (isDesktopApp()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_url", { url });
      return;
    } catch (err) {
      // Wenn der IPC-Call fehlschlägt, loggen wir den Fehler und fallen
      // NICHT auf window.open zurück – das ist in WebView2 ebenfalls blockiert.
      console.error("[desktop] open_url IPC fehlgeschlagen:", err);
      return;
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

// ── Update-Helpers ───────────────────────────────────────────────────────────

/** Ruft einen Tauri-Befehl auf (invoke shorthand für Komponenten) */
export async function invokeTauri(command, args = {}) {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("Not a desktop app");
  return invoke(command, args);
}

/** Lauscht auf ein Tauri-Event (listen shorthand für Komponenten) */
export async function listenTauri(event, handler) {
  const eventApi = await getEventApi();
  if (!eventApi?.listen) return () => {};
  return eventApi.listen(event, handler);
}
