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
import { registerUpdateListeners } from "./updateHelpers";

const STARTUP_GATE_TIMEOUT_MS = 20_000;
const UP_TO_DATE_DISPLAY_MS = 900;
const ERROR_DISPLAY_MS = 2_200;

const DEFAULT_STATE = {
  isDesktop: false,
  phase: "idle",
  progress: 0,
  update: null,
  errorMsg: null,
  startupResolved: true,
  showStartupGate: false,
};

const DesktopUpdateContext = createContext(DEFAULT_STATE);

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

function clearTimer(timerRef) {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

export function DesktopUpdateProvider({ children }) {
  const desktopRuntime = isDesktopApp();
  const [state, setState] = useState(() => buildInitialState(desktopRuntime));
  const downloadedRef = useRef(0);
  const transitionTimerRef = useRef(null);
  const startupTimeoutRef = useRef(null);

  useEffect(() => {
    setState(buildInitialState(desktopRuntime));
  }, [desktopRuntime]);

  useEffect(() => {
    if (!desktopRuntime) {
      return undefined;
    }

    let disposed = false;

    const clearTransitionTimer = () => clearTimer(transitionTimerRef);
    const clearStartupTimeout = () => clearTimer(startupTimeoutRef);
    const clearTimers = () => {
      clearTransitionTimer();
      clearStartupTimeout();
    };

    const scheduleTransition = (delayMs, reducer) => {
      clearTransitionTimer();
      transitionTimerRef.current = setTimeout(() => {
        if (!disposed) {
          setState((previousState) => reducer(previousState));
        }
      }, delayMs);
    };

    const markStartupActivity = () => {
      clearStartupTimeout();
    };

    const cleanupListeners = registerUpdateListeners({
      listen: (eventName, handler) => listenTauri(eventName, (event) => {
        if (!disposed) {
          handler(event);
        }
      }),
      isDisposed: () => disposed,
      handlers: {
        onChecking: (event) => {
          markStartupActivity();
          clearTransitionTimer();
          downloadedRef.current = 0;
          setState((previousState) => ({
            ...previousState,
            phase: "checking",
            progress: 0,
            errorMsg: null,
            update: previousState.update || { currentVersion: event.payload?.currentVersion },
          }));
        },
        onAvailable: (event) => {
          markStartupActivity();
          clearTransitionTimer();
          setState((previousState) => ({
            ...previousState,
            phase: "available",
            update: event.payload || previousState.update,
            errorMsg: null,
          }));
        },
        onNotAvailable: () => {
          markStartupActivity();
          setState((previousState) => ({
            ...previousState,
            phase: "up-to-date",
            errorMsg: null,
          }));
          scheduleTransition(UP_TO_DATE_DISPLAY_MS, reduceToIdle);
        },
        onDownloadProgress: (event) => {
          markStartupActivity();
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
        },
        onInstallStarted: () => {
          markStartupActivity();
          setState((previousState) => ({
            ...previousState,
            phase: "installing",
            progress: 100,
          }));
        },
        onError: (event) => {
          markStartupActivity();
          setState((previousState) => ({
            ...previousState,
            phase: "error",
            errorMsg: event.payload?.error || null,
          }));
          scheduleTransition(ERROR_DISPLAY_MS, reduceToIdle);
        },
      },
    });

    startupTimeoutRef.current = setTimeout(() => {
      if (!disposed) {
        setState((previousState) => reduceToIdle(previousState));
      }
    }, STARTUP_GATE_TIMEOUT_MS);

    return () => {
      disposed = true;
      clearTimers();
      cleanupListeners();
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
