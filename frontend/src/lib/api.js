import axios from "axios";

let runtimeConfig = {
  apiBase: "/api",
  authMode: "cookie",
};

let currentSession = {
  accessToken: null,
  refreshToken: null,
  authMode: "cookie",
};

let onUnauthorized = null;
let onSessionChange = null;
let refreshPromise = null;

const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

export function configureApi(config) {
  runtimeConfig = config;
  api.defaults.baseURL = config.apiBase || "/api";
  api.defaults.withCredentials = config.authMode === "cookie";
}

export function setApiSession(session) {
  currentSession = {
    ...currentSession,
    ...session,
  };
  api.defaults.withCredentials = currentSession.authMode === "cookie";
}

export function clearApiSession() {
  currentSession = {
    accessToken: null,
    refreshToken: null,
    authMode: runtimeConfig.authMode || "cookie",
  };
}

export function setApiUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

export function setApiSessionChangeHandler(handler) {
  onSessionChange = handler;
}

async function refreshSession() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    if (currentSession.authMode === "token") {
      if (!currentSession.refreshToken) {
        throw new Error("No refresh token");
      }
      const res = await axios.post(
        `${runtimeConfig.apiBase}/auth/refresh`,
        { refresh_token: currentSession.refreshToken },
        { headers: { "Content-Type": "application/json" } },
      );
      setApiSession({ accessToken: res.data.access_token || null });
      await onSessionChange?.({
        accessToken: res.data.access_token || null,
        refreshToken: currentSession.refreshToken,
      });
      return res.data.access_token || null;
    }

    await axios.post(
      `${runtimeConfig.apiBase}/auth/refresh`,
      {},
      { withCredentials: true },
    );
    return null;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

api.interceptors.request.use(async (config) => {
  if (currentSession.authMode === "token" && currentSession.accessToken) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${currentSession.accessToken}`;
  }
  config.withCredentials = currentSession.authMode === "cookie";
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config || {};
    const status = error.response?.status;
    const isAuthRoute = originalRequest.url?.includes("/auth/");

    if (status === 401 && !originalRequest._retry && !isAuthRoute) {
      originalRequest._retry = true;
      try {
        await refreshSession();
        if (currentSession.authMode === "token" && currentSession.accessToken) {
          originalRequest.headers = originalRequest.headers || {};
          originalRequest.headers.Authorization = `Bearer ${currentSession.accessToken}`;
        }
        originalRequest.withCredentials = currentSession.authMode === "cookie";
        return api(originalRequest);
      } catch {
        await onUnauthorized?.();
      }
    }

    return Promise.reject(error);
  },
);

export default api;

export function formatError(detail) {
  if (detail == null) return "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  if (detail?.message) return detail.message;
  if (detail?.msg) return detail.msg;
  return String(detail);
}
