// E2EE utilities using Web Crypto API (ECDH + AES-GCM)

export async function generateKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );
  const publicKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
  return { publicKey: publicKeyJwk, privateKey: privateKeyJwk };
}

export async function deriveSharedKey(privateKeyJwk, publicKeyJwk) {
  const privateKey = await window.crypto.subtle.importKey(
    "jwk", privateKeyJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]
  );
  const publicKey = await window.crypto.subtle.importKey(
    "jwk", publicKeyJwk, { name: "ECDH", namedCurve: "P-256" }, false, []
  );
  return await window.crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptMessage(sharedKey, plaintext) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv }, sharedKey, encoded
  );
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    nonce: btoa(String.fromCharCode(...iv))
  };
}

export async function decryptMessage(sharedKey, ciphertextB64, nonceB64) {
  const iv = Uint8Array.from(atob(nonceB64), c => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv }, sharedKey, ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

export function storeKeyPair(keyPair) {
  localStorage.setItem("sv_keypair", JSON.stringify(keyPair));
}

export function loadKeyPair() {
  const stored = localStorage.getItem("sv_keypair");
  return stored ? JSON.parse(stored) : null;
}
