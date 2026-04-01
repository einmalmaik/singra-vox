import { deleteDesktopSecret, getDesktopSecret, isDesktopApp, setDesktopSecret } from "@/lib/desktop";

function instanceScope(config) {
  const raw = (config?.instanceUrl || "default").toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "default";
}

function scopedKey(config, suffix) {
  return `e2ee.${instanceScope(config)}.${suffix}`;
}

export async function loadLocalE2EEIdentity(config) {
  if (!config?.isDesktop || !isDesktopApp()) {
    return null;
  }

  const keys = [
    "device_id",
    "device_name",
    "device_public_key",
    "device_private_key",
    "recovery_public_key",
    "recovery_private_key",
  ];

  const entries = await Promise.all(
    keys.map(async (key) => [key, await getDesktopSecret(scopedKey(config, key))]),
  );
  const identity = Object.fromEntries(entries);
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
  if (!config?.isDesktop || !isDesktopApp()) return;
  const mappings = {
    device_id: identity.deviceId,
    device_name: identity.deviceName,
    device_public_key: identity.devicePublicKey,
    device_private_key: identity.devicePrivateKey,
    recovery_public_key: identity.recoveryPublicKey || "",
    recovery_private_key: identity.recoveryPrivateKey || "",
  };
  await Promise.all(
    Object.entries(mappings).map(([key, value]) => (
      value
        ? setDesktopSecret(scopedKey(config, key), value)
        : deleteDesktopSecret(scopedKey(config, key))
    )),
  );
}

export async function clearLocalE2EEIdentity(config) {
  if (!config?.isDesktop || !isDesktopApp()) return;
  await Promise.all([
    "device_id",
    "device_name",
    "device_public_key",
    "device_private_key",
    "recovery_public_key",
    "recovery_private_key",
  ].map((key) => deleteDesktopSecret(scopedKey(config, key))));
}

