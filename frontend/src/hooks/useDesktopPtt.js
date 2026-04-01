import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  clearDesktopPttListener,
  configureDesktopPttListener,
  getDesktopRuntimeInfo,
  isDesktopApp,
  registerDesktopPttHotkey,
  unregisterDesktopPttHotkey,
} from "@/lib/desktop";
import { matchesPttShortcut, normalizePttShortcut } from "@/lib/pttShortcut";

export function useDesktopPtt({
  enabled,
  shortcut,
  voiceEngineRef,
  active = true,
}) {
  const [debugState, setDebugState] = useState({
    enabled: false,
    registered: false,
    active: false,
    source: "idle",
    lastEventState: "",
    lastShortcut: "",
    error: "",
  });

  useEffect(() => {
    const engine = voiceEngineRef?.current;
    const normalizedShortcut = normalizePttShortcut(shortcut);
    let desktopBackend = null;
    let cancelled = false;
    if (engine) {
      engine.setPTT(Boolean(enabled && active));
      if (!enabled || !active) {
        engine.setPTTActive(false);
      }
    }

    if (!enabled || !active || !normalizedShortcut) {
      setDebugState({
        enabled: Boolean(enabled && active),
        registered: false,
        active: false,
        source: "idle",
        lastEventState: "",
        lastShortcut: normalizedShortcut,
        error: "",
      });
      if (isDesktopApp()) {
        void clearDesktopPttListener();
        void unregisterDesktopPttHotkey();
      }
      return undefined;
    }

    setDebugState({
      enabled: true,
      registered: false,
      active: false,
      source: isDesktopApp() ? "desktop" : "window",
      lastEventState: "",
      lastShortcut: normalizedShortcut,
      error: "",
    });

    const keyDown = (event) => {
      if (!event.repeat && matchesPttShortcut(event, normalizedShortcut)) {
        voiceEngineRef?.current?.setPTTActive(true);
        setDebugState((current) => ({
          ...current,
          active: true,
          source: "window",
          lastEventState: "Pressed",
        }));
      }
    };
    const keyUp = (event) => {
      if (matchesPttShortcut(event, normalizedShortcut)) {
        voiceEngineRef?.current?.setPTTActive(false);
        setDebugState((current) => ({
          ...current,
          active: false,
          source: "window",
          lastEventState: "Released",
        }));
      }
    };

    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp, true);

    if (isDesktopApp()) {
      void (async () => {
        const runtimeInfo = await getDesktopRuntimeInfo();
        if (cancelled) {
          return;
        }
        if (runtimeInfo?.pttMode === "low-level-hook") {
          desktopBackend = "low-level-hook";
          try {
            const registration = await configureDesktopPttListener(normalizedShortcut, true, (payload) => {
              if (cancelled) {
                return;
              }
              if (!payload) {
                return;
              }
              const isPressed = payload.state === "Pressed";
              voiceEngineRef?.current?.setPTTActive(isPressed);
              setDebugState((current) => ({
                ...current,
                active: isPressed,
                registered: true,
                source: payload.source || "desktop-hook",
                lastEventState: payload.state || "",
                lastShortcut: normalizePttShortcut(payload.shortcut) || normalizedShortcut,
                error: "",
              }));
            });
            setDebugState((current) => ({
              ...current,
              registered: Boolean(registration?.registered),
              source: "desktop-hook",
              lastShortcut: normalizePttShortcut(registration?.shortcut) || normalizedShortcut,
              error: registration?.lastError || "",
            }));
            return;
          } catch (error) {
            if (cancelled) {
              return;
            }
            console.error("Desktop PTT low-level hook failed", error);
            setDebugState((current) => ({
              ...current,
              registered: false,
              error: error?.message || "Push-to-Talk shortcut could not be registered.",
            }));
            toast.error(error?.message || "Push-to-Talk shortcut could not be registered.");
            return;
          }
        }

        desktopBackend = "global-shortcut";
        await registerDesktopPttHotkey(normalizedShortcut, (payload) => {
          if (cancelled || !payload) {
            return;
          }
          const isPressed = payload.state === "Pressed";

          // Tauri emits canonical shortcut strings such as `control+KeyJ`. We
          // only ever register one desktop PTT binding at a time, so the source
          // shortcut is tracked for diagnostics but must not gate the mic update.
          voiceEngineRef?.current?.setPTTActive(isPressed);
          setDebugState((current) => ({
            ...current,
            active: isPressed,
            registered: true,
            source: "desktop",
            lastEventState: payload.state || "",
            lastShortcut: normalizePttShortcut(payload.shortcut) || normalizedShortcut,
            error: "",
          }));
        }).catch((error) => {
          if (cancelled) {
            return;
          }
          console.error("Desktop PTT registration failed", error);
          setDebugState((current) => ({
            ...current,
            registered: false,
            error: error?.message || "Push-to-Talk shortcut could not be registered.",
          }));
          toast.error(error?.message || "Push-to-Talk shortcut could not be registered.");
        });
      })();
    } else {
      setDebugState((current) => ({
        ...current,
        registered: true,
      }));
    }

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp, true);
      engine?.setPTTActive(false);
      setDebugState((current) => ({
        ...current,
        active: false,
      }));
      if (isDesktopApp()) {
        if (desktopBackend === "low-level-hook") {
          void clearDesktopPttListener();
        } else {
          void unregisterDesktopPttHotkey(normalizedShortcut).catch(() => {});
        }
      }
    };
  }, [active, enabled, shortcut, voiceEngineRef]);

  return debugState;
}
