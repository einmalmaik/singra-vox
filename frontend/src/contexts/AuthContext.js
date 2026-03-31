import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api, {
  clearApiSession,
  setApiSession,
  setApiSessionChangeHandler,
  setApiUnauthorizedHandler,
} from "@/lib/api";
import { clearStoredSession, loadStoredSession, saveStoredSession } from "@/lib/authStorage";
import { useRuntime } from "@/contexts/RuntimeContext";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { config, ready: runtimeReady, setupStatus, refreshSetupStatus } = useRuntime();
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  const persistSession = useCallback(async (nextSession) => {
    if (!config) return;
    await saveStoredSession(config, nextSession);
  }, [config]);

  const clearSession = useCallback(async () => {
    if (config) {
      await clearStoredSession(config);
    }
    clearApiSession();
    setUser(null);
    setToken(null);
  }, [config]);

  useEffect(() => {
    setApiSessionChangeHandler(async (sessionUpdate) => {
      setToken(sessionUpdate.accessToken || null);
      await persistSession(sessionUpdate);
    });
    setApiUnauthorizedHandler(async () => {
      await clearSession();
    });

    return () => {
      setApiSessionChangeHandler(null);
      setApiUnauthorizedHandler(null);
    };
  }, [clearSession, persistSession]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!runtimeReady) {
        return;
      }

      if (!config || config.needsConnection || !setupStatus?.initialized) {
        if (!cancelled) {
          setLoading(false);
          setUser(null);
          setToken(null);
        }
        clearApiSession();
        return;
      }

      setLoading(true);

      if (config.isDesktop) {
        const stored = await loadStoredSession(config);
        setApiSession({
          authMode: "token",
          accessToken: stored.accessToken,
          refreshToken: stored.refreshToken,
        });

        if (!stored.accessToken) {
          if (!cancelled) {
            setUser(null);
            setToken(null);
            setLoading(false);
          }
          return;
        }
      } else {
        setApiSession({
          authMode: "cookie",
          accessToken: null,
          refreshToken: null,
        });
      }

      try {
        const res = await api.get("/auth/me");
        if (cancelled) return;
        setUser(res.data);
        setToken(res.data.access_token || null);
        if (config.isDesktop && res.data.access_token) {
          await persistSession({
            accessToken: res.data.access_token,
            refreshToken: (await loadStoredSession(config)).refreshToken,
          });
          setApiSession({ accessToken: res.data.access_token });
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setToken(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [config, persistSession, runtimeReady, setupStatus?.initialized]);

  const applyAuthResult = useCallback(async (data) => {
    setUser(data.user);
    setToken(data.access_token || null);
    setApiSession({
      authMode: config?.authMode || "cookie",
      accessToken: data.access_token || null,
      refreshToken: data.refresh_token || null,
    });
    await persistSession({
      accessToken: data.access_token || null,
      refreshToken: data.refresh_token || null,
    });
    return data;
  }, [config?.authMode, persistSession]);

  const login = useCallback(async (email, password) => {
    const res = await api.post("/auth/login", { email, password });
    return applyAuthResult(res.data);
  }, [applyAuthResult]);

  const register = useCallback(async (email, username, password, display_name) => {
    const res = await api.post("/auth/register", { email, username, password, display_name });
    return applyAuthResult(res.data);
  }, [applyAuthResult]);

  const bootstrap = useCallback(async (payload) => {
    const res = await api.post("/setup/bootstrap", payload);
    await refreshSetupStatus();
    return applyAuthResult(res.data);
  }, [applyAuthResult, refreshSetupStatus]);

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // The client still clears local session state even if the network request fails.
    }
    await clearSession();
  }, [clearSession]);

  const value = useMemo(() => ({
    user,
    loading,
    token,
    login,
    register,
    bootstrap,
    logout,
    setUser,
  }), [bootstrap, loading, login, logout, register, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}

