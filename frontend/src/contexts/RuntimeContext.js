/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api, { configureApi } from "@/lib/api";
import { clearDesktopInstanceUrl, loadRuntimeConfig, saveDesktopInstanceUrl } from "@/lib/runtimeConfig";

const RuntimeContext = createContext(null);

const EMPTY_SETUP_STATUS = {
  initialized: false,
  setup_required: true,
  allow_open_signup: false,
  server_count: 0,
  instance_name: "",
};

// ── Setup-Status-Cache (verhindert Setup-Screen nach Neustart/Update) ────────
const SETUP_CACHE_KEY = "singravox.setup_status_cache";

function loadCachedSetupStatus() {
  try {
    const raw = window.localStorage.getItem(SETUP_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function cacheSetupStatus(status) {
  try {
    if (status?.initialized) {
      window.localStorage.setItem(SETUP_CACHE_KEY, JSON.stringify(status));
    }
  } catch { /* ignore */ }
}

function clearSetupCache() {
  try { window.localStorage.removeItem(SETUP_CACHE_KEY); } catch { /* ignore */ }
}

export function RuntimeProvider({ children }) {
  const [config, setConfig] = useState(null);
  const [setupStatus, setSetupStatus] = useState(EMPTY_SETUP_STATUS);
  const [ready, setReady] = useState(false);

  const fetchSetupStatus = useCallback(async (targetConfig) => {
    if (!targetConfig || targetConfig.needsConnection) {
      setSetupStatus(EMPTY_SETUP_STATUS);
      return EMPTY_SETUP_STATUS;
    }

    configureApi(targetConfig);
    try {
      const res = await api.get("/setup/status");
      const normalizedStatus = {
        ...res.data,
        server_count: res.data?.server_count ?? res.data?.community_count ?? 0,
      };
      setSetupStatus(normalizedStatus);
      cacheSetupStatus(normalizedStatus);       // Cache für Neustart/Update
      return normalizedStatus;
    } catch {
      // Netzwerk- oder Server-Fehler: gecachten Status verwenden damit
      // nach einem Update / Neustart nicht der Setup-Screen erscheint.
      const cached = loadCachedSetupStatus();
      if (cached) {
        setSetupStatus(cached);
        return cached;
      }
      setSetupStatus(EMPTY_SETUP_STATUS);
      return EMPTY_SETUP_STATUS;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const loadedConfig = await loadRuntimeConfig();
      if (cancelled) return;

      setConfig(loadedConfig);
      if (!loadedConfig.needsConnection) {
        try {
          await fetchSetupStatus(loadedConfig);
        } catch {
          setSetupStatus(EMPTY_SETUP_STATUS);
        }
      } else {
        setSetupStatus(EMPTY_SETUP_STATUS);
      }

      if (!cancelled) {
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchSetupStatus]);

  const connectToInstance = useCallback(async (instanceUrl) => {
    const nextConfig = await saveDesktopInstanceUrl(instanceUrl);
    setConfig(nextConfig);
    const status = await fetchSetupStatus(nextConfig);
    return { config: nextConfig, status };
  }, [fetchSetupStatus]);

  const disconnectFromInstance = useCallback(async () => {
    await clearDesktopInstanceUrl();
    clearSetupCache();                               // Cache löschen beim Disconnect
    const emptyConfig = await loadRuntimeConfig(); // liest localStorage neu → needsConnection: true
    setConfig(emptyConfig);
    setSetupStatus(EMPTY_SETUP_STATUS);
  }, []);

  const value = useMemo(() => ({
    ready,
    config,
    setupStatus,
    connectToInstance,
    disconnectFromInstance,
    refreshSetupStatus: () => fetchSetupStatus(config),
    setSetupStatus,
  }), [config, connectToInstance, disconnectFromInstance, fetchSetupStatus, ready, setupStatus]);

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntime() {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error("useRuntime must be used inside RuntimeProvider");
  return ctx;
}
