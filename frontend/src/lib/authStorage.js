import { deleteDesktopSecret, getDesktopSecret, isDesktopApp, setDesktopSecret } from "@/lib/desktop";

const ACCESS_TOKEN_KEY = "auth.access_token";
const REFRESH_TOKEN_KEY = "auth.refresh_token";

export async function loadStoredSession(config) {
  if (!config?.isDesktop || !isDesktopApp()) {
    return { accessToken: null, refreshToken: null };
  }

  const [accessToken, refreshToken] = await Promise.all([
    getDesktopSecret(ACCESS_TOKEN_KEY),
    getDesktopSecret(REFRESH_TOKEN_KEY),
  ]);

  return {
    accessToken: accessToken || null,
    refreshToken: refreshToken || null,
  };
}

export async function saveStoredSession(config, session) {
  if (!config?.isDesktop || !isDesktopApp()) return;

  if (session?.accessToken) {
    await setDesktopSecret(ACCESS_TOKEN_KEY, session.accessToken);
  }
  if (session?.refreshToken) {
    await setDesktopSecret(REFRESH_TOKEN_KEY, session.refreshToken);
  }
}

export async function clearStoredSession(config) {
  if (!config?.isDesktop || !isDesktopApp()) return;

  await Promise.all([
    deleteDesktopSecret(ACCESS_TOKEN_KEY),
    deleteDesktopSecret(REFRESH_TOKEN_KEY),
  ]);
}

