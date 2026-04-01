import { randomUUID } from "node:crypto";
import { stdin, stdout, stderr } from "node:process";
import sodium from "../frontend/node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm/libsodium-wrappers.mjs";

function variant() {
  return sodium.base64_variants.ORIGINAL;
}

function fromBase64(value) {
  return sodium.from_base64(value, variant());
}

function toBase64(value) {
  return sodium.to_base64(value, variant());
}

async function readPayload() {
  const chunks = [];
  for await (const chunk of stdin) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function buildMessageKeyEnvelopes(recipients, messageKeyB64) {
  const envelopes = [];
  for (const recipient of recipients || []) {
    for (const device of recipient.devices || []) {
      envelopes.push({
        recipient_kind: "device",
        recipient_user_id: recipient.user_id,
        recipient_device_id: device.device_id,
        sealed_key: toBase64(
          sodium.crypto_box_seal(
            sodium.from_string(messageKeyB64),
            fromBase64(device.public_key),
          ),
        ),
      });
    }

    if (recipient.recovery_public_key) {
      envelopes.push({
        recipient_kind: "recovery",
        recipient_user_id: recipient.user_id,
        recipient_device_id: null,
        sealed_key: toBase64(
          sodium.crypto_box_seal(
            sodium.from_string(messageKeyB64),
            fromBase64(recipient.recovery_public_key),
          ),
        ),
      });
    }
  }
  return envelopes;
}

function openEnvelope(envelopeB64, publicKeyB64, privateKeyB64) {
  const plaintext = sodium.crypto_box_seal_open(
    fromBase64(envelopeB64),
    fromBase64(publicKeyB64),
    fromBase64(privateKeyB64),
  );
  return sodium.to_string(plaintext);
}

async function main() {
  await sodium.ready;
  const { command, payload } = await readPayload();

  if (command === "bootstrap") {
    const deviceKeys = sodium.crypto_box_keypair();
    const recoveryKeys = sodium.crypto_box_keypair();
    const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
    const derivedKey = sodium.crypto_pwhash(
      sodium.crypto_secretbox_KEYBYTES,
      sodium.from_string(payload.passphrase),
      salt,
      sodium.crypto_pwhash_OPSLIMIT_MODERATE,
      sodium.crypto_pwhash_MEMLIMIT_MODERATE,
      sodium.crypto_pwhash_ALG_DEFAULT,
    );
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const encryptedRecoveryPrivateKey = sodium.crypto_secretbox_easy(
      sodium.from_string(toBase64(recoveryKeys.privateKey)),
      nonce,
      derivedKey,
    );

    stdout.write(JSON.stringify({
      device_id: payload.deviceId || randomUUID(),
      device_name: payload.deviceName,
      device_public_key: toBase64(deviceKeys.publicKey),
      device_private_key: toBase64(deviceKeys.privateKey),
      recovery_public_key: toBase64(recoveryKeys.publicKey),
      recovery_private_key: toBase64(recoveryKeys.privateKey),
      encrypted_recovery_private_key: toBase64(encryptedRecoveryPrivateKey),
      recovery_salt: toBase64(salt),
      recovery_nonce: toBase64(nonce),
    }));
    return;
  }

  if (command === "generate-device") {
    const keyPair = sodium.crypto_box_keypair();
    stdout.write(JSON.stringify({
      device_id: payload.deviceId || randomUUID(),
      device_name: payload.deviceName,
      device_public_key: toBase64(keyPair.publicKey),
      device_private_key: toBase64(keyPair.privateKey),
    }));
    return;
  }

  if (command === "encrypt-message") {
    const messageKey = toBase64(sodium.randombytes_buf(32));
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      sodium.from_string(JSON.stringify(payload.structuredPayload)),
      null,
      null,
      nonce,
      fromBase64(messageKey),
    );
    const keyEnvelopes = await buildMessageKeyEnvelopes(payload.recipients.recipients || [], messageKey);
    stdout.write(JSON.stringify({
      is_e2ee: true,
      ciphertext: toBase64(ciphertext),
      nonce: toBase64(nonce),
      sender_device_id: payload.identity.device_id,
      protocol_version: payload.recipients.protocol_version || "sv-e2ee-v1",
      key_envelopes: keyEnvelopes,
    }));
    return;
  }

  if (command === "decrypt-message") {
    const message = payload.message;
    const identity = payload.identity;
    const deviceEnvelope = (message.key_envelopes || []).find(
      (entry) => entry.recipient_kind === "device" && entry.recipient_device_id === identity.device_id,
    );
    const recoveryEnvelope = (message.key_envelopes || []).find(
      (entry) => entry.recipient_kind === "recovery" && entry.recipient_user_id === payload.user_id,
    );
    const usableEnvelope = deviceEnvelope || recoveryEnvelope;
    if (!usableEnvelope) {
      stdout.write(JSON.stringify({ ok: false, reason: "no-envelope" }));
      return;
    }

    const publicKey = usableEnvelope.recipient_kind === "device"
      ? identity.device_public_key
      : identity.recovery_public_key;
    const privateKey = usableEnvelope.recipient_kind === "device"
      ? identity.device_private_key
      : identity.recovery_private_key;
    const messageKey = openEnvelope(usableEnvelope.sealed_key, publicKey, privateKey);
    const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      fromBase64(message.ciphertext || message.encrypted_content),
      null,
      fromBase64(message.nonce),
      fromBase64(messageKey),
    );
    stdout.write(JSON.stringify({
      ok: true,
      payload: JSON.parse(sodium.to_string(plaintext)),
    }));
    return;
  }

  if (command === "encrypt-binary") {
    const fileKey = toBase64(sodium.randombytes_buf(32));
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      Buffer.from(payload.plaintext_b64, "base64"),
      null,
      null,
      nonce,
      fromBase64(fileKey),
    );
    stdout.write(JSON.stringify({
      ciphertext_b64: toBase64(ciphertext),
      ciphertext_size_bytes: ciphertext.length,
      nonce: toBase64(nonce),
      sha256: sodium.to_hex(sodium.crypto_hash_sha256(ciphertext)),
      manifest: {
        name: payload.name,
        size_bytes: payload.size_bytes,
        content_type: payload.content_type,
        key: fileKey,
        nonce: toBase64(nonce),
      },
    }));
    return;
  }

  if (command === "decrypt-binary") {
    const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      Buffer.from(payload.ciphertext_b64, "base64"),
      null,
      fromBase64(payload.manifest.nonce),
      fromBase64(payload.manifest.key),
    );
    stdout.write(JSON.stringify({
      plaintext_b64: Buffer.from(plaintext).toString("base64"),
    }));
    return;
  }

  if (command === "build-media-package") {
    const participantUserIds = [...new Set(payload.participant_user_ids || [])].sort();
    const mediaKey = toBase64(sodium.randombytes_buf(32));
    const filteredRecipients = (payload.recipients.recipients || []).filter(
      (recipient) => participantUserIds.includes(recipient.user_id),
    );
    const keyEnvelopes = await buildMessageKeyEnvelopes(filteredRecipients, mediaKey);
    stdout.write(JSON.stringify({
      sender_device_id: payload.identity.device_id,
      key_version: payload.key_version,
      participant_user_ids: participantUserIds,
      key_envelopes: keyEnvelopes,
      media_key_b64: mediaKey,
    }));
    return;
  }

  if (command === "open-media-package") {
    const identity = payload.identity;
    const envelope = (payload.key_package.key_envelopes || []).find(
      (entry) => entry.recipient_device_id === identity.device_id,
    );
    if (!envelope) {
      stdout.write(JSON.stringify({ ok: false, reason: "no-envelope" }));
      return;
    }
    const mediaKey = openEnvelope(
      envelope.sealed_key,
      identity.device_public_key,
      identity.device_private_key,
    );
    stdout.write(JSON.stringify({ ok: true, media_key_b64: mediaKey }));
    return;
  }

  throw new Error(`Unsupported command: ${command}`);
}

main().catch((error) => {
  stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
