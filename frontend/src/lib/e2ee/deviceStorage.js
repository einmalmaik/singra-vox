import { deleteDesktopSecret, getDesktopSecret, isDesktopApp, setDesktopSecret } from "@/lib/desktop";

const WEB_E2EE_PREFIX = "singravox:e2ee:";

function instanceScope(config) {
  const raw = (config?.instanceUrl || "default").toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "default";
}

function scopedKey(config, suffix) {
  return `e2ee.${instanceScope(config)}.${suffix}`;
}

// localStorage-based storage for web mode (less secure than Tauri keychain)
function loadWebSecret(config, suffix) {
  try {
    return localStorage.getItem(`${WEB_E2EE_PREFIX}${scopedKey(config, suffix)}`) || null;
  } catch { return null; }
}
function saveWebSecret(config, suffix, value) {
  try {
    if (value) {
      localStorage.setItem(`${WEB_E2EE_PREFIX}${scopedKey(config, suffix)}`, value);
    } else {
      localStorage.removeItem(`${WEB_E2EE_PREFIX}${scopedKey(config, suffix)}`);
    }
  } catch { /* ignore */ }
}
function deleteWebSecret(config, suffix) {
  try {
    localStorage.removeItem(`${WEB_E2EE_PREFIX}${scopedKey(config, suffix)}`);
  } catch { /* ignore */ }
}

export async function loadLocalE2EEIdentity(config) {
  const keys = [
    "device_id", "device_name", "device_public_key",
    "device_private_key", "recovery_public_key", "recovery_private_key",
  ];

  let identity;
  if (isDesktopApp()) {
    const entries = await Promise.all(
      keys.map(async (key) => [key, await getDesktopSecret(scopedKey(config, key))]),
    );
    identity = Object.fromEntries(entries);
  } else {
    identity = Object.fromEntries(keys.map((k) => [k, loadWebSecret(config, k)]));
  }

  if (!identity.device_id || !identity.device_private_key || !identity.device_public_key) {
    return null;
  }
  return {
    deviceId: identity.device_id,
    deviceName: identity.device_name || "",
    devicePublicKey: identity.device_public_key,
    devicePrivateKey: identity.device_private_key,
    recoveryPublicKey: identity.recovery_public_key || null,
    recoveryPrivateKey: identity.recovery_private_key || null,
  };
}

export async function saveLocalE2EEIdentity(config, identity) {
  const mappings = {
    device_id: identity.deviceId,
    device_name: identity.deviceName,
    device_public_key: identity.devicePublicKey,
    device_private_key: identity.devicePrivateKey,
    recovery_public_key: identity.recoveryPublicKey || "",
    recovery_private_key: identity.recoveryPrivateKey || "",
  };
  if (isDesktopApp()) {
    await Promise.all(
      Object.entries(mappings).map(([key, value]) => (
        value ? setDesktopSecret(scopedKey(config, key), value)
              : deleteDesktopSecret(scopedKey(config, key))
      )),
    );
  } else {
    Object.entries(mappings).forEach(([key, value]) => saveWebSecret(config, key, value));
  }
}

export async function clearLocalE2EEIdentity(config) {
  const keys = [
    "device_id", "device_name", "device_public_key",
    "device_private_key", "recovery_public_key", "recovery_private_key",
  ];
  if (isDesktopApp()) {
    await Promise.all(keys.map((key) => deleteDesktopSecret(scopedKey(config, key))));
  } else {
    keys.forEach((key) => deleteWebSecret(config, key));
  }
}

