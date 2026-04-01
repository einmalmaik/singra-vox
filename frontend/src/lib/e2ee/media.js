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

function normalizeParticipantIds(participantUserIds) {
  return [...new Set((participantUserIds || []).filter(Boolean))].sort();
}

function sameParticipants(left, right) {
  const normalizedLeft = normalizeParticipantIds(left);
  const normalizedRight = normalizeParticipantIds(right);
  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }
  return normalizedLeft.every((participantId, index) => participantId === normalizedRight[index]);
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

async function resolveLocalIdentity(config) {
  const identity = await loadLocalE2EEIdentity(config);
  if (!identity?.deviceId || !identity?.devicePrivateKey || !identity?.devicePublicKey) {
    throw new Error("A verified desktop device is required for encrypted voice");
  }
  return identity;
}

export async function createEncryptedMediaController(config, channelId) {
  const keyProvider = new ExternalE2EEKeyProvider();
  const worker = new Worker(new URL("livekit-client/e2ee-worker", import.meta.url));

  let currentKeyVersion = null;
  let currentParticipants = [];

  const applyCurrentPackage = async (identity, keyPackage) => {
    if (!keyPackage) {
      return false;
    }

    const envelope = (keyPackage.key_envelopes || []).find(
      (entry) => entry.recipient_device_id === identity.deviceId,
    );
    if (!envelope) {
      return false;
    }

    const messageKey = await openMessageKey(
      envelope.sealed_key,
      identity.devicePublicKey,
      identity.devicePrivateKey,
    );
    await keyProvider.setKey(base64ToArrayBuffer(messageKey));
    currentKeyVersion = keyPackage.key_version || null;
    currentParticipants = normalizeParticipantIds(keyPackage.participant_user_ids || []);
    return true;
  };

  const rotate = async (identity, participantUserIds, reason = "membership") => {
    const recipientsResponse = await api.get(`/e2ee/channels/${channelId}/recipients`);
    const allowedRecipients = (recipientsResponse.data?.recipients || []).filter((recipient) => (
      participantUserIds.includes(recipient.user_id)
    ));
    const mediaKeyB64 = await randomBase64(32);
    const keyVersion = `${Date.now()}-${reason}`;
    const keyEnvelopes = await buildDeviceEnvelopes(allowedRecipients, mediaKeyB64);

    await api.post(`/e2ee/media/channels/${channelId}/rotate`, {
      sender_device_id: identity.deviceId,
      key_version: keyVersion,
      participant_user_ids: participantUserIds,
      key_envelopes: keyEnvelopes,
    });

    await keyProvider.setKey(base64ToArrayBuffer(mediaKeyB64));
    currentKeyVersion = keyVersion;
    currentParticipants = [...participantUserIds];
    return {
      rotated: true,
      keyVersion,
      participantUserIds,
    };
  };

  const syncParticipantSet = async (participantUserIds, reason = "membership") => {
    const normalizedParticipants = normalizeParticipantIds(participantUserIds);
    const identity = await resolveLocalIdentity(config);
    const currentResponse = await api.get(`/e2ee/media/channels/${channelId}/current`);
    const keyPackage = currentResponse.data?.key_package;

    const appliedCurrent = await applyCurrentPackage(identity, keyPackage);
    if (appliedCurrent && sameParticipants(keyPackage?.participant_user_ids || [], normalizedParticipants)) {
      return {
        rotated: false,
        keyVersion: keyPackage?.key_version || currentKeyVersion,
        participantUserIds: normalizedParticipants,
      };
    }

    return rotate(identity, normalizedParticipants, reason);
  };

  return {
    encryption: {
      keyProvider,
      worker,
    },
    syncParticipantSet,
    getCurrentState() {
      return {
        keyVersion: currentKeyVersion,
        participantUserIds: [...currentParticipants],
      };
    },
  };
}
