/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { isDesktopApp, listenTauri } from "@/lib/desktop";

const STARTUP_GATE_TIMEOUT_MS = 20_000;
const UP_TO_DATE_DISPLAY_MS = 900;
const ERROR_DISPLAY_MS = 2_200;

const DesktopUpdateContext = createContext({
  isDesktop: false,
  phase: "idle",
  progress: 0,
  update: null,
  errorMsg: null,
  startupResolved: true,
});

function buildInitialState(desktopRuntime) {
  return {
    phase: desktopRuntime ? "checking" : "idle",
    progress: 0,
    update: null,
    errorMsg: null,
    startupResolved: !desktopRuntime,
  };
}

function reduceToIdle(previousState) {
  return {
    ...previousState,
    phase: "idle",
    errorMsg: null,
    startupResolved: true,
  };
}

export function DesktopUpdateProvider({ children }) {
  const desktopRuntime = isDesktopApp();
  const [state, setState] = useState(() => buildInitialState(desktopRuntime));
  const downloadedRef = useRef(0);
  const transitionTimerRef = useRef(null);
  const startupTimeoutRef = useRef(null);

  useEffect(() => {
    if (!desktopRuntime) {
      return undefined;
    }

    let disposed = false;
    const unlisteners = [];

    const clearTimers = () => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
        transitionTimerRef.current = null;
      }
      if (startupTimeoutRef.current) {
        clearTimeout(startupTimeoutRef.current);
        startupTimeoutRef.current = null;
      }
    };

    const scheduleTransition = (delayMs, reducer) => {
      if (transitionTimerRef.current) {
        clearTimeout(transitionTimerRef.current);
      }
      transitionTimerRef.current = setTimeout(() => {
        if (!disposed) {
          setState((previousState) => reducer(previousState));
        }
      }, delayMs);
    };

    const attachListener = async (eventName, handler) => {
      const unlisten = await listenTauri(eventName, (event) => {
        if (!disposed) {
          handler(event);
        }
      });
      if (disposed) {
        unlisten?.();
        return;
      }
      unlisteners.push(unlisten);
    };

    startupTimeoutRef.current = setTimeout(() => {
      if (!disposed) {
        setState((previousState) => reduceToIdle(previousState));
      }
    }, STARTUP_GATE_TIMEOUT_MS);

    void (async () => {
      await attachListener("update-checking", (event) => {
        if (transitionTimerRef.current) {
          clearTimeout(transitionTimerRef.current);
          transitionTimerRef.current = null;
        }
        downloadedRef.current = 0;
        setState((previousState) => ({
          ...previousState,
          phase: "checking",
          progress: 0,
          errorMsg: null,
          update: previousState.update || { currentVersion: event.payload?.currentVersion },
        }));
      });

      await attachListener("update-available", (event) => {
        if (transitionTimerRef.current) {
          clearTimeout(transitionTimerRef.current);
          transitionTimerRef.current = null;
        }
        setState((previousState) => ({
          ...previousState,
          phase: "available",
          update: event.payload || previousState.update,
          errorMsg: null,
        }));
      });

      await attachListener("update-not-available", () => {
        setState((previousState) => ({
          ...previousState,
          phase: "up-to-date",
          errorMsg: null,
        }));
        scheduleTransition(UP_TO_DATE_DISPLAY_MS, (previousState) => (
          previousState.startupResolved
            ? { ...previousState, phase: "idle" }
            : reduceToIdle(previousState)
        ));
      });

      await attachListener("update-download-progress", (event) => {
        const chunkLength = Number(event.payload?.chunkLength || 0);
        const contentLength = Number(event.payload?.contentLength || 0);
        if (contentLength > 0) {
          downloadedRef.current += chunkLength;
        }
        setState((previousState) => ({
          ...previousState,
          phase: "downloading",
          progress: contentLength > 0
            ? Math.min(99, Math.round((downloadedRef.current / contentLength) * 100))
            : previousState.progress,
        }));
      });

      await attachListener("update-install-started", () => {
        setState((previousState) => ({
          ...previousState,
          phase: "installing",
          progress: 100,
        }));
      });

      await attachListener("update-error", (event) => {
        setState((previousState) => ({
          ...previousState,
          phase: "error",
          errorMsg: event.payload?.error || null,
        }));
        scheduleTransition(ERROR_DISPLAY_MS, (previousState) => (
          previousState.startupResolved
            ? { ...previousState, phase: "idle", errorMsg: null }
            : reduceToIdle(previousState)
        ));
      });
    })();

    return () => {
      disposed = true;
      clearTimers();
      unlisteners.forEach((unlisten) => unlisten?.());
    };
  }, [desktopRuntime]);

  const value = useMemo(() => ({
    ...state,
    isDesktop: desktopRuntime,
    showStartupGate: desktopRuntime && !state.startupResolved,
  }), [desktopRuntime, state]);

  return (
    <DesktopUpdateContext.Provider value={value}>
      {children}
    </DesktopUpdateContext.Provider>
  );
}

export function useDesktopUpdateState() {
  return useContext(DesktopUpdateContext);
}
