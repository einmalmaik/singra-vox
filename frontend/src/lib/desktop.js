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

export async function startDesktopCapture({
  sourceId,
  requestedWidth,
  requestedHeight,
  requestedFrameRate,
}) {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return invoke("start_desktop_capture", {
    sourceId,
    requestedWidth,
    requestedHeight,
    requestedFrameRate,
  });
}

export async function stopDesktopCapture() {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return invoke("stop_desktop_capture");
}

export async function getDesktopCaptureFrame(lastFrameId = null) {
  const invoke = await getInvoke();
  if (!invoke) return null;
  const response = await invoke("get_desktop_capture_frame", {
    lastFrameId,
  });
  if (!response) {
    return null;
  }

  const bytes = response instanceof Uint8Array
    ? response
    : response instanceof ArrayBuffer
      ? new Uint8Array(response)
      : Array.isArray(response)
        ? Uint8Array.from(response)
        : null;

  if (!bytes || bytes.byteLength < 16) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frameId = Number(view.getBigUint64(0, true));
  const width = view.getUint32(8, true);
  const height = view.getUint32(12, true);

  return {
    frameId,
    width,
    height,
    pixelFormat: "rgba8",
    data: bytes.subarray(16),
  };
}

export async function getDesktopCaptureSession() {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return invoke("get_desktop_capture_session");
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
