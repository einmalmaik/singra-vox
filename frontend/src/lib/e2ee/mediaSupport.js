/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { isE2EESupported } from "livekit-client";

export function getEncryptedVoiceSupport(config = null) {
  if (config?.isDesktop) {
    return { supported: true, reason: null };
  }

  if (typeof window === "undefined") {
    return {
      supported: false,
      reason: "Encrypted voice in the browser requires a window context.",
    };
  }

  if (window.isSecureContext !== true) {
    return {
      supported: false,
      reason: "Encrypted voice in the browser requires a secure context (HTTPS or localhost).",
    };
  }

  if (typeof Worker !== "function") {
    return {
      supported: false,
      reason: "Encrypted voice in the browser requires Worker support.",
    };
  }

  if (!window.crypto?.subtle) {
    return {
      supported: false,
      reason: "Encrypted voice in the browser requires Web Crypto support.",
    };
  }

  if (typeof isE2EESupported === "function" && !isE2EESupported()) {
    return {
      supported: false,
      reason: "Encrypted voice is not supported by this browser runtime.",
    };
  }

  return { supported: true, reason: null };
}

export function supportsEncryptedVoice(config = null) {
  return getEncryptedVoiceSupport(config).supported;
}

export function assertEncryptedVoiceSupport(config = null) {
  const support = getEncryptedVoiceSupport(config);
  if (!support.supported) {
    throw new Error(support.reason);
  }
}
