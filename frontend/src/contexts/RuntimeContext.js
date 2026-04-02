import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api, { configureApi } from "@/lib/api";
import { loadRuntimeConfig, saveDesktopInstanceUrl } from "@/lib/runtimeConfig";

const RuntimeContext = createContext(null);

const EMPTY_SETUP_STATUS = {
  initialized: false,
  setup_required: true,
  allow_open_signup: false,
  server_count: 0,
  instance_name: "",
};

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
    const res = await api.get("/setup/status");
    const normalizedStatus = {
      ...res.data,
      server_count: res.data?.server_count ?? res.data?.community_count ?? 0,
    };
    setSetupStatus(normalizedStatus);
    return normalizedStatus;
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

  const value = useMemo(() => ({
    ready,
    config,
    setupStatus,
    connectToInstance,
    refreshSetupStatus: () => fetchSetupStatus(config),
    setSetupStatus,
  }), [config, connectToInstance, fetchSetupStatus, ready, setupStatus]);

  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntime() {
  const ctx = useContext(RuntimeContext);
  if (!ctx) throw new Error("useRuntime must be used inside RuntimeProvider");
  return ctx;
}
