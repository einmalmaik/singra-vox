const SVID_LOGIN_COPY_KEYS = Object.freeze({
  verifyEmailFirst: "svid.verifyEmailFirst",
  loginFailed: "svid.loginFailed",
  invalid2fa: "svid.invalid2fa",
  twoFactorTitle: "svid.twoFactorTitle",
  twoFactorSubtitle: "svid.twoFactorSubtitle",
  authenticatorCode: "svid.authenticatorCode",
  backupCodeHint: "svid.backupCodeHint",
  verifying: "svid.verifying",
  verify: "svid.verify",
  backToLogin: "svid.backToLogin",
  backToInstanceLogin: "svid.backToInstanceLogin",
});

export function buildSvidLoginCopy(t) {
  return Object.fromEntries(
    Object.entries(SVID_LOGIN_COPY_KEYS).map(([name, key]) => [name, t(key)]),
  );
}

export default buildSvidLoginCopy;
