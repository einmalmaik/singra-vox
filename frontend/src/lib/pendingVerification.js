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
