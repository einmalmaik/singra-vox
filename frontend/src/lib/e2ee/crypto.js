/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import sodium from "libsodium-wrappers-sumo";

function variant(sodiumLib) {
  return sodiumLib.base64_variants.ORIGINAL;
}

export async function readySodium() {
  await sodium.ready;
  return sodium;
}

export async function randomBase64(size = 32) {
  const sodiumLib = await readySodium();
  return sodiumLib.to_base64(sodiumLib.randombytes_buf(size), variant(sodiumLib));
}

export async function randomDeviceId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `device-${await randomBase64(12)}`;
}

export async function generateBoxKeyPair() {
  const sodiumLib = await readySodium();
  const keyPair = sodiumLib.crypto_box_keypair();
  return {
    publicKey: sodiumLib.to_base64(keyPair.publicKey, variant(sodiumLib)),
    privateKey: sodiumLib.to_base64(keyPair.privateKey, variant(sodiumLib)),
  };
}

export async function encryptRecoveryPrivateKey(privateKeyB64, passphrase) {
  const sodiumLib = await readySodium();
  const salt = sodiumLib.randombytes_buf(sodiumLib.crypto_pwhash_SALTBYTES);
  const derivedKey = sodiumLib.crypto_pwhash(
    sodiumLib.crypto_secretbox_KEYBYTES,
    sodiumLib.from_string(passphrase),
    salt,
    sodiumLib.crypto_pwhash_OPSLIMIT_MODERATE,
    sodiumLib.crypto_pwhash_MEMLIMIT_MODERATE,
    sodiumLib.crypto_pwhash_ALG_DEFAULT,
  );
  const nonce = sodiumLib.randombytes_buf(sodiumLib.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodiumLib.crypto_secretbox_easy(
    sodiumLib.from_string(privateKeyB64),
    nonce,
    derivedKey,
  );
  return {
    encryptedRecoveryPrivateKey: sodiumLib.to_base64(ciphertext, variant(sodiumLib)),
    recoverySalt: sodiumLib.to_base64(salt, variant(sodiumLib)),
    recoveryNonce: sodiumLib.to_base64(nonce, variant(sodiumLib)),
  };
}

export async function decryptRecoveryPrivateKey(bundle, passphrase) {
  const sodiumLib = await readySodium();
  const salt = sodiumLib.from_base64(bundle.recoverySalt, variant(sodiumLib));
  const nonce = sodiumLib.from_base64(bundle.recoveryNonce, variant(sodiumLib));
  const ciphertext = sodiumLib.from_base64(bundle.encryptedRecoveryPrivateKey, variant(sodiumLib));
  const derivedKey = sodiumLib.crypto_pwhash(
    sodiumLib.crypto_secretbox_KEYBYTES,
    sodiumLib.from_string(passphrase),
    salt,
    sodiumLib.crypto_pwhash_OPSLIMIT_MODERATE,
    sodiumLib.crypto_pwhash_MEMLIMIT_MODERATE,
    sodiumLib.crypto_pwhash_ALG_DEFAULT,
  );
  const plaintext = sodiumLib.crypto_secretbox_open_easy(ciphertext, nonce, derivedKey);
  return sodiumLib.to_string(plaintext);
}

export async function sealMessageKey(messageKeyB64, recipientPublicKeyB64) {
  const sodiumLib = await readySodium();
  const envelope = sodiumLib.crypto_box_seal(
    sodiumLib.from_string(messageKeyB64),
    sodiumLib.from_base64(recipientPublicKeyB64, variant(sodiumLib)),
  );
  return sodiumLib.to_base64(envelope, variant(sodiumLib));
}

export async function openMessageKey(envelopeB64, publicKeyB64, privateKeyB64) {
  const sodiumLib = await readySodium();
  const plaintext = sodiumLib.crypto_box_seal_open(
    sodiumLib.from_base64(envelopeB64, variant(sodiumLib)),
    sodiumLib.from_base64(publicKeyB64, variant(sodiumLib)),
    sodiumLib.from_base64(privateKeyB64, variant(sodiumLib)),
  );
  return sodiumLib.to_string(plaintext);
}

export async function encryptStructuredPayload(payload, messageKeyB64) {
  const sodiumLib = await readySodium();
  const nonce = sodiumLib.randombytes_buf(sodiumLib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const plaintext = sodiumLib.from_string(JSON.stringify(payload));
  const ciphertext = sodiumLib.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    null,
    null,
    nonce,
    sodiumLib.from_base64(messageKeyB64, variant(sodiumLib)),
  );
  return {
    ciphertext: sodiumLib.to_base64(ciphertext, variant(sodiumLib)),
    nonce: sodiumLib.to_base64(nonce, variant(sodiumLib)),
  };
}

export async function decryptStructuredPayload(ciphertextB64, nonceB64, messageKeyB64) {
  const sodiumLib = await readySodium();
  const ciphertext = sodiumLib.from_base64(ciphertextB64, variant(sodiumLib));
  const nonce = sodiumLib.from_base64(nonceB64, variant(sodiumLib));
  const plaintext = sodiumLib.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    ciphertext,
    null,
    nonce,
    sodiumLib.from_base64(messageKeyB64, variant(sodiumLib)),
  );
  return JSON.parse(sodiumLib.to_string(plaintext));
}

export async function encryptBinaryPayload(bytes, keyB64) {
  const sodiumLib = await readySodium();
  const nonce = sodiumLib.randombytes_buf(sodiumLib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const ciphertext = sodiumLib.crypto_aead_xchacha20poly1305_ietf_encrypt(
    bytes,
    null,
    null,
    nonce,
    sodiumLib.from_base64(keyB64, variant(sodiumLib)),
  );
  return {
    ciphertextB64: sodiumLib.to_base64(ciphertext, variant(sodiumLib)),
    ciphertextSizeBytes: ciphertext.length,
    nonce: sodiumLib.to_base64(nonce, variant(sodiumLib)),
    sha256: sodiumLib.to_hex(sodiumLib.crypto_hash_sha256(ciphertext)),
  };
}

export async function decryptBinaryPayload(ciphertextBuffer, nonceB64, keyB64) {
  const sodiumLib = await readySodium();
  const bytes = ciphertextBuffer instanceof Uint8Array ? ciphertextBuffer : new Uint8Array(ciphertextBuffer);
  return sodiumLib.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    bytes,
    null,
    sodiumLib.from_base64(nonceB64, variant(sodiumLib)),
    sodiumLib.from_base64(keyB64, variant(sodiumLib)),
  );
}

export async function fingerprintPublicKey(publicKeyB64) {
  const sodiumLib = await readySodium();
  const hash = sodiumLib.crypto_generichash(
    16,
    sodiumLib.from_base64(publicKeyB64, variant(sodiumLib)),
  );
  return sodiumLib.to_hex(hash).match(/.{1,4}/g)?.join(" ") || "";
}
