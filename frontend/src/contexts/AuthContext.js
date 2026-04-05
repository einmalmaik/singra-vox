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
          platform: config.isDesktop ? "desktop" : "web",
        });

        if (!stored.accessToken && stored.refreshToken) {
          try {
            const refreshResponse = await api.post("/auth/refresh", {
              refresh_token: stored.refreshToken,
            });
            const refreshedAccessToken = refreshResponse.data?.access_token || null;
            const refreshedRefreshToken = refreshResponse.data?.refresh_token || stored.refreshToken;
            setApiSession({
              authMode: "token",
              accessToken: refreshedAccessToken,
              refreshToken: refreshedRefreshToken,
              platform: "desktop",
            });
            await persistSession({
              accessToken: refreshedAccessToken,
              refreshToken: refreshedRefreshToken,
            });
          } catch {
            if (!cancelled) {
              setUser(null);
              setToken(null);
              setLoading(false);
            }
            return;
          }
        }
      } else {
        // Web: Cookie-basierte Auth
        setApiSession({
          authMode: "cookie",
          accessToken: null,
          refreshToken: null,
          platform: "web",
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
      } catch (err) {
        // Wenn 401 (Token abgelaufen) → Refresh versuchen (Web: Cookie, Desktop: schon oben behandelt)
        const isExpired = err?.response?.status === 401;
        if (isExpired && !config.isDesktop) {
          try {
            await api.post("/auth/refresh");
            const retryRes = await api.get("/auth/me");
            if (!cancelled) {
              setUser(retryRes.data);
              setToken(retryRes.data.access_token || null);
            }
          } catch {
            if (!cancelled) { setUser(null); setToken(null); }
          }
        } else if (!cancelled) {
          setUser(null);
          setToken(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
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
      platform: config?.isDesktop ? "desktop" : "web",
    });
    await persistSession({
      accessToken: data.access_token || null,
      refreshToken: data.refresh_token || null,
    });
    return data;
  }, [config?.authMode, config?.isDesktop, persistSession]);

  const login = useCallback(async (email, password) => {
    const res = await api.post("/auth/login", { email, password });
    // If 2FA is required, return the response without setting auth state
    if (res.data?.requires_2fa) {
      return res.data;
    }
    return applyAuthResult(res.data);
  }, [applyAuthResult]);

  const loginWithSvid = useCallback(async (svidAccessToken) => {
    const res = await api.post("/auth/login-with-svid", { svid_access_token: svidAccessToken });
    return applyAuthResult(res.data);
  }, [applyAuthResult]);

  const register = useCallback(async (email, username, password, display_name) => {
    const res = await api.post("/auth/register", { email, username, password, display_name });
    if (res.data?.verification_required) {
      return res.data;
    }
    return applyAuthResult(res.data);
  }, [applyAuthResult]);

  const verifyEmail = useCallback(async (email, code) => {
    const res = await api.post("/auth/verify-email", { email, code });
    return applyAuthResult(res.data);
  }, [applyAuthResult]);

  const verify2FA = useCallback(async (userId, code) => {
    const res = await api.post("/auth/2fa/verify", { user_id: userId, code });
    return applyAuthResult(res.data);
  }, [applyAuthResult]);

  const resendVerification = useCallback(async (email) => {
    const res = await api.post("/auth/resend-verification", { email });
    return res.data;
  }, []);

  const forgotPassword = useCallback(async (email) => {
    const res = await api.post("/auth/forgot-password", { email });
    return res.data;
  }, []);

  const resetPassword = useCallback(async (email, code, newPassword) => {
    const res = await api.post("/auth/reset-password", {
      email,
      code,
      new_password: newPassword,
    });
    return res.data;
  }, []);

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

  const logoutAll = useCallback(async () => {
    try {
      await api.post("/auth/logout-all");
    } finally {
      await clearSession();
    }
  }, [clearSession]);

  const listSessions = useCallback(async () => {
    const response = await api.get("/auth/sessions");
    return response.data?.sessions || [];
  }, []);

  const revokeSession = useCallback(async (sessionId) => {
    const response = await api.delete(`/auth/sessions/${sessionId}`);
    return response.data;
  }, []);

  const value = useMemo(() => ({
    user,
    loading,
    token,
    login,
    loginWithSvid,
    verify2FA,
    register,
    verifyEmail,
    resendVerification,
    forgotPassword,
    resetPassword,
    bootstrap,
    logout,
    logoutAll,
    listSessions,
    revokeSession,
    clearAuthState: clearSession,
    setUser,
  }), [
    bootstrap,
    clearSession,
    forgotPassword,
    loading,
    listSessions,
    login,
    loginWithSvid,
    logout,
    logoutAll,
    register,
    resendVerification,
    revokeSession,
    resetPassword,
    token,
    user,
    verify2FA,
    verifyEmail,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
