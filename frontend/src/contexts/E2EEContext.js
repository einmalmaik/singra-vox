import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import api, { setApiSession } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/contexts/RuntimeContext";
import {
  decryptBinaryPayload,
  decryptRecoveryPrivateKey,
  decryptStructuredPayload,
  encryptBinaryPayload,
  encryptRecoveryPrivateKey,
  encryptStructuredPayload,
  fingerprintPublicKey,
  generateBoxKeyPair,
  openMessageKey,
  randomBase64,
  randomDeviceId,
  sealMessageKey,
} from "@/lib/e2ee/crypto";
import {
  clearLocalE2EEIdentity,
  loadLocalE2EEIdentity,
  saveLocalE2EEIdentity,
} from "@/lib/e2ee/deviceStorage";

const E2EEContext = createContext(null);
const TRUST_SNAPSHOT_STORAGE_KEY = "singravox:e2ee:trust-snapshots";
const E2EE_AUTO_PASSPHRASE_KEY = "singravox.e2ee.device_passphrase";

// Generiert oder lädt eine gerätespezifische Passphrase für die Auto-Init.
// Die Passphrase wird lokal gespeichert und nie dem Nutzer gezeigt.
function getOrCreateAutoPassphrase() {
  try {
    let pp = window.localStorage.getItem(E2EE_AUTO_PASSPHRASE_KEY);
    if (!pp) {
      pp = crypto.randomUUID() + "-" + crypto.randomUUID();
      window.localStorage.setItem(E2EE_AUTO_PASSPHRASE_KEY, pp);
    }
    return pp;
  } catch { return "singravox-e2ee-fallback-passphrase-001"; }
}

function getStoredAutoPassphrase() {
  try { return window.localStorage.getItem(E2EE_AUTO_PASSPHRASE_KEY) || null; }
  catch { return null; }
}

function readTrustSnapshots() {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    return JSON.parse(window.localStorage.getItem(TRUST_SNAPSHOT_STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeTrustSnapshots(nextSnapshots) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(TRUST_SNAPSHOT_STORAGE_KEY, JSON.stringify(nextSnapshots));
}

function buildTrustSnapshotKey(userId, scopeKind, scopeId) {
  return `${userId}:${scopeKind}:${scopeId}`;
}

function buildUserMessageKeyEnvelopes(recipients, messageKeyB64) {
  return Promise.all(
    recipients.flatMap((recipient) => {
      const deviceEnvelopes = (recipient.devices || []).map(async (device) => ({
        recipient_kind: "device",
        recipient_user_id: recipient.user_id,
        recipient_device_id: device.device_id,
        sealed_key: await sealMessageKey(messageKeyB64, device.public_key),
      }));
      const recoveryEnvelope = recipient.recovery_public_key
        ? [Promise.resolve().then(async () => ({
          recipient_kind: "recovery",
          recipient_user_id: recipient.user_id,
          recipient_device_id: null,
          sealed_key: await sealMessageKey(messageKeyB64, recipient.recovery_public_key),
        }))]
        : [];
      return [...deviceEnvelopes, ...recoveryEnvelope];
    }),
  ).then((envelopes) => envelopes.filter(Boolean));
}

function scopeParticipantsForBlob(scopeKind, scopeId, recipients) {
  return {
    scopeKind,
    scopeId,
    participantUserIds: (recipients?.recipients || []).map((recipient) => recipient.user_id),
  };
}

async function buildRecipientFingerprintSnapshot(recipients, fingerprintFn) {
  const entries = [];
  for (const recipient of recipients || []) {
    for (const device of recipient.devices || []) {
      entries.push([
        `${recipient.user_id}:${device.device_id}`,
        await fingerprintFn(device.public_key),
      ]);
    }
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

export function E2EEProvider({ children }) {
  const { user } = useAuth();
  const { config } = useRuntime();
  const [identity, setIdentity] = useState(null);
  const [state, setState] = useState({ enabled: false, account: null, devices: [], current_device: null });
  const [loading, setLoading] = useState(true);
  const autoInitRef = useRef(false);  // verhindert mehrfache Auto-Init

  const applyDeviceHeader = useCallback((deviceId) => {
    setApiSession({ deviceId: deviceId || null });
  }, []);

  const refreshState = useCallback(async () => {
    if (!user) {
      setState({ enabled: false, account: null, devices: [], current_device: null });
      setLoading(false);
      return;
    }
    try {
      const response = await api.get("/e2ee/state");
      setState(response.data);
    } catch {
      setState({ enabled: false, account: null, devices: [], current_device: null });
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user) {
        applyDeviceHeader(null);
        setIdentity(null);
        setState({ enabled: false, account: null, devices: [], current_device: null });
        setLoading(false);
        return;
      }

      setLoading(true);
      const localIdentity = await loadLocalE2EEIdentity(config);
      if (cancelled) return;
      setIdentity(localIdentity);
      applyDeviceHeader(localIdentity?.deviceId || null);
      try {
        await refreshState();
      } catch {
        if (!cancelled) {
          setState({ enabled: false, account: null, devices: [], current_device: null });
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyDeviceHeader, config, refreshState, user]);

  const initializeE2EE = useCallback(async ({ passphrase, deviceName }) => {
    const deviceId = await randomDeviceId();
    const [deviceKeys, recoveryKeys] = await Promise.all([
      generateBoxKeyPair(),
      generateBoxKeyPair(),
    ]);
    const recoveryBundle = await encryptRecoveryPrivateKey(recoveryKeys.privateKey, passphrase);
    applyDeviceHeader(deviceId);
    const response = await api.post("/e2ee/bootstrap", {
      device_id: deviceId,
      device_name: deviceName,
      device_public_key: deviceKeys.publicKey,
      recovery_public_key: recoveryKeys.publicKey,
      encrypted_recovery_private_key: recoveryBundle.encryptedRecoveryPrivateKey,
      recovery_salt: recoveryBundle.recoverySalt,
      recovery_nonce: recoveryBundle.recoveryNonce,
    });
    const nextIdentity = {
      deviceId,
      deviceName,
      devicePublicKey: deviceKeys.publicKey,
      devicePrivateKey: deviceKeys.privateKey,
      recoveryPublicKey: recoveryKeys.publicKey,
      recoveryPrivateKey: recoveryKeys.privateKey,
    };
    await saveLocalE2EEIdentity(config, nextIdentity);
    setIdentity(nextIdentity);
    setState(response.data);
    return response.data;
  }, [applyDeviceHeader, config]);

  const restoreE2EE = useCallback(async ({ passphrase, deviceName }) => {
    const deviceId = identity?.deviceId || await randomDeviceId();
    const deviceKeys = identity?.devicePrivateKey && identity?.devicePublicKey
      ? { publicKey: identity.devicePublicKey, privateKey: identity.devicePrivateKey }
      : await generateBoxKeyPair();

    applyDeviceHeader(deviceId);
    await api.post("/e2ee/devices", {
      device_id: deviceId,
      device_name: deviceName,
      device_public_key: deviceKeys.publicKey,
    });
    const recoveryResponse = await api.get("/e2ee/recovery/account");
    const recoveryPrivateKey = await decryptRecoveryPrivateKey({
      encryptedRecoveryPrivateKey: recoveryResponse.data.encrypted_recovery_private_key,
      recoverySalt: recoveryResponse.data.recovery_salt,
      recoveryNonce: recoveryResponse.data.recovery_nonce,
    }, passphrase);
    const nextIdentity = {
      deviceId,
      deviceName,
      devicePublicKey: deviceKeys.publicKey,
      devicePrivateKey: deviceKeys.privateKey,
      recoveryPublicKey: recoveryResponse.data.recovery_public_key,
      recoveryPrivateKey,
    };
    await saveLocalE2EEIdentity(config, nextIdentity);
    await api.post(`/e2ee/devices/${deviceId}/verify-recovery`);
    setIdentity(nextIdentity);
    await refreshState();
    return nextIdentity;
  }, [applyDeviceHeader, config, identity, refreshState]);

  // Auto-Init E2EE nach Login (2 s verzögert damit UI zuerst rendert)
  useEffect(() => {
    if (loading || !user || state.enabled || identity || autoInitRef.current) return;
    autoInitRef.current = true;

    const timer = setTimeout(async () => {
      try {
        const passphrase = getOrCreateAutoPassphrase();
        const deviceName =
          (typeof navigator !== "undefined" && navigator.platform ? navigator.platform : "Gerät") +
          " (Auto)";
        await initializeE2EE({ passphrase, deviceName });
      } catch {
        autoInitRef.current = false; // Bei Fehler nächstes Mal erneut versuchen
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [loading, user, state.enabled, identity, initializeE2EE]);

  // Auto-Restore E2EE auf neuem Gerät (E2EE aktiv, aber keine lokale Identity)
  useEffect(() => {
    if (loading || !user || !state.enabled || identity || autoInitRef.current) return;
    autoInitRef.current = true;

    const timer = setTimeout(async () => {
      const storedPp = getStoredAutoPassphrase();
      if (!storedPp) return; // Kein Passwort gespeichert → manuelles Restore nötig
      try {
        const deviceName =
          (typeof navigator !== "undefined" && navigator.platform ? navigator.platform : "Gerät") +
          " (Auto)";
        await restoreE2EE({ passphrase: storedPp, deviceName });
      } catch {
        autoInitRef.current = false;
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [loading, user, state.enabled, identity, restoreE2EE]);

  const approveDevice = useCallback(async (deviceId) => {
    await api.post(`/e2ee/devices/${deviceId}/approve`);
    await refreshState();
  }, [refreshState]);

  const revokeDevice = useCallback(async (deviceId) => {
    await api.post(`/e2ee/devices/${deviceId}/revoke`);
    await refreshState();
  }, [refreshState]);

  const clearIdentity = useCallback(async () => {
    await clearLocalE2EEIdentity(config);
    applyDeviceHeader(null);
    setIdentity(null);
    setState({ enabled: false, account: null, devices: [], current_device: null });
  }, [applyDeviceHeader, config]);

  const encryptForRecipients = useCallback(async (payload, recipientsResponse) => {
    if (!identity?.deviceId || !identity?.devicePrivateKey || !identity?.devicePublicKey) {
      throw new Error("An E2EE device is required to encrypt this message. Enable E2EE in Settings > Privacy.");
    }
    const messageKeyB64 = await randomBase64(32);
    const encryptedPayload = await encryptStructuredPayload(payload, messageKeyB64);
    const keyEnvelopes = await buildUserMessageKeyEnvelopes(recipientsResponse.recipients || [], messageKeyB64);
    return {
      ciphertext: encryptedPayload.ciphertext,
      nonce: encryptedPayload.nonce,
      key_envelopes: keyEnvelopes,
      sender_device_id: identity.deviceId,
      protocol_version: recipientsResponse.protocol_version || "sv-e2ee-v1",
      is_e2ee: true,
    };
  }, [identity]);

  const decryptMessage = useCallback(async (message) => {
    if (!message?.is_e2ee || !message?.encrypted_content && !message?.ciphertext) {
      return null;
    }
    if (!identity?.devicePrivateKey || !identity?.devicePublicKey) {
      return null;
    }
    const envelopes = message.key_envelopes || [];
    const deviceEnvelope = envelopes.find((envelope) => envelope.recipient_kind === "device" && envelope.recipient_device_id === identity.deviceId);
    const recoveryEnvelope = envelopes.find((envelope) => envelope.recipient_kind === "recovery" && envelope.recipient_user_id === user?.id);
    const usableEnvelope = deviceEnvelope || recoveryEnvelope;
    if (!usableEnvelope) {
      return null;
    }
    const publicKey = usableEnvelope.recipient_kind === "device"
      ? identity.devicePublicKey
      : identity.recoveryPublicKey;
    const privateKey = usableEnvelope.recipient_kind === "device"
      ? identity.devicePrivateKey
      : identity.recoveryPrivateKey;
    if (!publicKey || !privateKey) {
      return null;
    }
    const messageKey = await openMessageKey(usableEnvelope.sealed_key, publicKey, privateKey);
    return decryptStructuredPayload(message.ciphertext || message.encrypted_content, message.nonce, messageKey);
  }, [identity, user?.id]);

  const fetchDmRecipients = useCallback(async (otherUserId) => {
    const response = await api.get(`/e2ee/dm/${otherUserId}/recipients`);
    return response.data;
  }, []);

  const fetchGroupRecipients = useCallback(async (groupId) => {
    const response = await api.get(`/e2ee/groups/${groupId}/recipients`);
    return response.data;
  }, []);

  const fetchChannelRecipients = useCallback(async (channelId) => {
    const response = await api.get(`/e2ee/channels/${channelId}/recipients`);
    return response.data;
  }, []);

  const uploadEncryptedAttachment = useCallback(async ({ file, scopeKind, scopeId, recipientsResponse }) => {
    const participantPayload = scopeParticipantsForBlob(scopeKind, scopeId, recipientsResponse);
    const initResponse = await api.post("/e2ee/blobs/init", {
      scope_kind: participantPayload.scopeKind,
      scope_id: participantPayload.scopeId,
      participant_user_ids: participantPayload.participantUserIds,
    });
    const fileKey = await randomBase64(32);
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    const encryptedBlob = await encryptBinaryPayload(fileBytes, fileKey);
    await api.put(`/e2ee/blobs/${initResponse.data.upload_id}/content`, {
      ciphertext_b64: encryptedBlob.ciphertextB64,
      sha256: encryptedBlob.sha256,
      size_bytes: encryptedBlob.ciphertextSizeBytes,
      content_type: "application/octet-stream",
    });
    const completeResponse = await api.post(`/e2ee/blobs/${initResponse.data.upload_id}/complete`);
    return {
      serverAttachment: {
        id: completeResponse.data.id,
        url: completeResponse.data.url,
        size_bytes: completeResponse.data.size_bytes,
        content_type: completeResponse.data.content_type,
      },
      manifest: {
        blob_id: completeResponse.data.id,
        url: completeResponse.data.url,
        name: file.name,
        size_bytes: file.size,
        content_type: file.type || "application/octet-stream",
        key: fileKey,
        nonce: encryptedBlob.nonce,
      },
    };
  }, []);

  const downloadAndDecryptAttachment = useCallback(async (manifest) => {
    const response = await api.get(`/e2ee/blobs/${manifest.blob_id}`, {
      responseType: "arraybuffer",
    });
    const plaintext = await decryptBinaryPayload(response.data, manifest.nonce, manifest.key);
    const blob = new Blob([plaintext], { type: manifest.content_type || "application/octet-stream" });
    return {
      blob,
      url: URL.createObjectURL(blob),
    };
  }, []);

  const inspectRecipientTrust = useCallback(async ({ scopeKind, scopeId, recipientsResponse }) => {
    if (!user?.id || !scopeKind || !scopeId) {
      return { changed: false, initialized: false, fingerprintCount: 0 };
    }

    const snapshotKey = buildTrustSnapshotKey(user.id, scopeKind, scopeId);
    const nextSnapshot = await buildRecipientFingerprintSnapshot(
      recipientsResponse?.recipients || [],
      fingerprintPublicKey,
    );
    const existingSnapshots = readTrustSnapshots();
    const previousSnapshot = existingSnapshots[snapshotKey];
    const changed = Boolean(
      previousSnapshot
      && JSON.stringify(previousSnapshot) !== JSON.stringify(nextSnapshot),
    );

    writeTrustSnapshots({
      ...existingSnapshots,
      [snapshotKey]: nextSnapshot,
    });

    return {
      changed,
      initialized: Boolean(previousSnapshot),
      fingerprintCount: Object.keys(nextSnapshot).length,
    };
  }, [user?.id]);

  const value = useMemo(() => ({
    loading,
    enabled: state.enabled,
    account: state.account,
    devices: state.devices,
    currentDevice: state.current_device,
    identity,
    ready: Boolean(
      state.enabled
      && identity?.devicePrivateKey
      && identity?.devicePublicKey
      && (state.current_device?.verified_at || identity?.recoveryPrivateKey)
    ),
    isDesktopCapable: Boolean(config?.isDesktop),
    isWebE2EE: Boolean(!config?.isDesktop && state.enabled),
    initializeE2EE,
    restoreE2EE,
    approveDevice,
    revokeDevice,
    refreshState,
    clearIdentity,
    encryptForRecipients,
    decryptMessage,
    fetchDmRecipients,
    fetchGroupRecipients,
    fetchChannelRecipients,
    uploadEncryptedAttachment,
    downloadAndDecryptAttachment,
    inspectRecipientTrust,
    fingerprintPublicKey,
  }), [
    approveDevice,
    clearIdentity,
    config?.isDesktop,
    decryptMessage,
    downloadAndDecryptAttachment,
    encryptForRecipients,
    fetchChannelRecipients,
    fetchDmRecipients,
    fetchGroupRecipients,
    identity,
    inspectRecipientTrust,
    initializeE2EE,
    loading,
    refreshState,
    restoreE2EE,
    revokeDevice,
    state.account,
    state.current_device,
    state.devices,
    state.enabled,
    uploadEncryptedAttachment,
  ]);

  return <E2EEContext.Provider value={value}>{children}</E2EEContext.Provider>;
}

export function useE2EE() {
  const context = useContext(E2EEContext);
  if (!context) {
    throw new Error("useE2EE must be used inside E2EEProvider");
  }
  return context;
}
