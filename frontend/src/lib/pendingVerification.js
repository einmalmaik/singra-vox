/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
const PENDING_VERIFICATION_EMAIL_KEY = "singravox:pendingVerificationEmail";

export function rememberPendingVerification(email) {
  if (!email) return;
  window.localStorage.setItem(PENDING_VERIFICATION_EMAIL_KEY, email);
}

export function loadPendingVerification() {
  return window.localStorage.getItem(PENDING_VERIFICATION_EMAIL_KEY) || "";
}

export function clearPendingVerification() {
  window.localStorage.removeItem(PENDING_VERIFICATION_EMAIL_KEY);
}
