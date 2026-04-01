import api from "@/lib/api";
import { ExternalE2EEKeyProvider } from "livekit-client";
import { loadLocalE2EEIdentity } from "@/lib/e2ee/deviceStorage";
import { openMessageKey, randomBase64, sealMessageKey } from "@/lib/e2ee/crypto";

function base64ToArrayBuffer(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function buildDeviceEnvelopes(recipients, mediaKeyB64) {
  const envelopes = [];
  for (const recipient of recipients || []) {
    for (const device of recipient.devices || []) {
      envelopes.push({
        recipient_user_id: recipient.user_id,
        recipient_device_id: device.device_id,
        sealed_key: await sealMessageKey(mediaKeyB64, device.public_key),
      });
    }
  }
  return envelopes;
}

async function fetchOrRotateMediaKey(config, channelId) {
  const identity = await loadLocalE2EEIdentity(config);
  if (!identity?.deviceId || !identity?.devicePrivateKey || !identity?.devicePublicKey) {
    throw new Error("A verified desktop device is required for encrypted voice");
  }

  const currentResponse = await api.get(`/e2ee/media/channels/${channelId}/current`);
  const keyPackage = currentResponse.data?.key_package;
  const existingEnvelope = keyPackage?.key_envelopes?.find(
    (envelope) => envelope.recipient_device_id === identity.deviceId,
  );
  if (existingEnvelope) {
    return openMessageKey(existingEnvelope.sealed_key, identity.devicePublicKey, identity.devicePrivateKey);
  }

  const recipientsResponse = await api.get(`/e2ee/channels/${channelId}/recipients`);
  const mediaKeyB64 = await randomBase64(32);
  const keyEnvelopes = await buildDeviceEnvelopes(recipientsResponse.data?.recipients, mediaKeyB64);
  await api.post(`/e2ee/media/channels/${channelId}/rotate`, {
    sender_device_id: identity.deviceId,
    key_version: `${Date.now()}`,
    key_envelopes: keyEnvelopes,
  });
  return mediaKeyB64;
}

export async function buildMediaE2EEOptions(config, channelId) {
  const keyProvider = new ExternalE2EEKeyProvider();
  await keyProvider.setKey(base64ToArrayBuffer(await fetchOrRotateMediaKey(config, channelId)));
  return {
    keyProvider,
    worker: new Worker(new URL("livekit-client/e2ee-worker", import.meta.url)),
  };
}

