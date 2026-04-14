import { localeRegistry } from "../../../i18n/locales";
import buildSvidLoginCopy from "../loginCopy";

function resolveKey(locale, key) {
  return key.split(".").reduce((value, part) => value?.[part], locale);
}

describe("buildSvidLoginCopy", () => {
  it("keeps the SVID login flow on the existing SVID locale namespace", () => {
    const frenchLocale = localeRegistry.fr;
    const copy = buildSvidLoginCopy((key) => resolveKey(frenchLocale, key));

    expect(copy.verifyEmailFirst).toBe(frenchLocale.svid.verifyEmailFirst);
    expect(copy.loginFailed).toBe(frenchLocale.svid.loginFailed);
    expect(copy.invalid2fa).toBe(frenchLocale.svid.invalid2fa);
    expect(copy.twoFactorTitle).toBe(frenchLocale.svid.twoFactorTitle);
    expect(copy.twoFactorSubtitle).toBe(frenchLocale.svid.twoFactorSubtitle);
    expect(copy.authenticatorCode).toBe(frenchLocale.svid.authenticatorCode);
    expect(copy.backupCodeHint).toBe(frenchLocale.svid.backupCodeHint);
    expect(copy.backToLogin).toBe(frenchLocale.svid.backToLogin);
    expect(copy.backToInstanceLogin).toBe(frenchLocale.svid.backToInstanceLogin);
  });
});
