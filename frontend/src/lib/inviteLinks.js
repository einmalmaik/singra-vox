const PENDING_INVITE_STORAGE_KEY = "singravox.pending_invite";
const PREFERRED_SERVER_STORAGE_KEY = "singravox.preferred_server_id";
const AUTO_OPEN_GUARD_PREFIX = "singravox.invite_auto_open.";

export const INVITE_EXPIRY_OPTIONS = [
  { value: "0", label: "Never" },
  { value: "1", label: "1 hour" },
  { value: "6", label: "6 hours" },
  { value: "12", label: "12 hours" },
  { value: "24", label: "1 day" },
  { value: "168", label: "7 days" },
  { value: "720", label: "30 days" },
];

function safeGetStorage(kind) {
  if (typeof window === "undefined") return null;
  try {
    return kind === "session" ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeInviteCode(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";

  try {
    const parsedUrl = new URL(trimmed);
    const invitePathMatch = parsedUrl.pathname.match(/\/invite\/([^/?#]+)/i);
    if (invitePathMatch?.[1]) {
      return decodeURIComponent(invitePathMatch[1]);
    }
  } catch {
    // Raw invite codes are expected to land here.
  }

  const deepLinkMatch = trimmed.match(/^singravox:\/\/invite\/([^/?#]+)/i);
  if (deepLinkMatch?.[1]) {
    return decodeURIComponent(deepLinkMatch[1]);
  }

  const pathMatch = trimmed.match(/(?:^|\/)invite\/([^/?#]+)/i);
  if (pathMatch?.[1]) {
    return decodeURIComponent(pathMatch[1]);
  }

  return trimmed.replace(/^\/+/, "");
}

export function buildInviteLink(instanceUrl, code) {
  const normalizedBase = String(instanceUrl || "").replace(/\/+$/, "");
  return `${normalizedBase}/invite/${encodeURIComponent(code)}`;
}

export function buildDesktopInviteLink(instanceUrl, code) {
  const normalizedBase = String(instanceUrl || "").replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (normalizedBase) {
    params.set("instance", normalizedBase);
  }
  return `singravox://invite/${encodeURIComponent(code)}${params.toString() ? `?${params}` : ""}`;
}

export function parseDesktopInviteLink(url) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "singravox:") {
      return null;
    }

    let code = "";
    if (parsedUrl.hostname === "invite") {
      code = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, ""));
    } else {
      const invitePathMatch = parsedUrl.pathname.match(/^\/invite\/([^/?#]+)/i);
      code = invitePathMatch?.[1] ? decodeURIComponent(invitePathMatch[1]) : "";
    }

    if (!code) {
      return null;
    }

    return {
      code,
      instanceUrl: String(parsedUrl.searchParams.get("instance") || "").replace(/\/+$/, ""),
    };
  } catch {
    return null;
  }
}

export function savePendingInvite(code) {
  const storage = safeGetStorage("local");
  if (!storage) return;

  const normalizedCode = normalizeInviteCode(code);
  if (!normalizedCode) return;

  storage.setItem(
    PENDING_INVITE_STORAGE_KEY,
    JSON.stringify({
      code: normalizedCode,
      savedAt: Date.now(),
    }),
  );
}

export function loadPendingInvite() {
  const storage = safeGetStorage("local");
  if (!storage) return null;

  try {
    const rawValue = storage.getItem(PENDING_INVITE_STORAGE_KEY);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue);
    const code = normalizeInviteCode(parsed?.code);
    return code ? { code } : null;
  } catch {
    return null;
  }
}

export function clearPendingInvite() {
  safeGetStorage("local")?.removeItem(PENDING_INVITE_STORAGE_KEY);
}

export function rememberPreferredServer(serverId) {
  if (!serverId) return;
  safeGetStorage("local")?.setItem(PREFERRED_SERVER_STORAGE_KEY, serverId);
}

export function consumePreferredServer() {
  const storage = safeGetStorage("local");
  if (!storage) return "";
  const serverId = storage.getItem(PREFERRED_SERVER_STORAGE_KEY) || "";
  storage.removeItem(PREFERRED_SERVER_STORAGE_KEY);
  return serverId;
}

export function shouldAttemptDesktopOpen(code) {
  const storage = safeGetStorage("session");
  if (!storage) return false;
  return !storage.getItem(`${AUTO_OPEN_GUARD_PREFIX}${normalizeInviteCode(code)}`);
}

export function markDesktopOpenAttempt(code) {
  const storage = safeGetStorage("session");
  if (!storage) return;
  storage.setItem(`${AUTO_OPEN_GUARD_PREFIX}${normalizeInviteCode(code)}`, "1");
}

export function attemptDesktopInviteLaunch(url) {
  if (typeof document === "undefined" || !url) {
    return;
  }

  // Browsers only allow best-effort custom-protocol launches from a web page.
  // A hidden iframe avoids replacing the current invite page with a browser error.
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "absolute";
  iframe.style.width = "1px";
  iframe.style.height = "1px";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.src = url;
  document.body.appendChild(iframe);

  window.setTimeout(() => {
    iframe.remove();
  }, 1500);
}

export function describeInviteUsage(maxUses, uses = 0) {
  const parsedMaxUses = Number(maxUses || 0);
  const parsedUses = Number(uses || 0);
  if (!parsedMaxUses) {
    return "Unlimited uses";
  }

  const remainingUses = Math.max(parsedMaxUses - parsedUses, 0);
  const remainingLabel = remainingUses === 1 ? "1 use left" : `${remainingUses} uses left`;
  return `${parsedMaxUses} max uses · ${remainingLabel}`;
}

export function describeInviteExpiry(expiresAt) {
  if (!expiresAt) {
    return "Does not expire";
  }

  const expiresDate = new Date(expiresAt);
  if (Number.isNaN(expiresDate.getTime())) {
    return "Expires soon";
  }

  return `Expires ${expiresDate.toLocaleString()}`;
}
