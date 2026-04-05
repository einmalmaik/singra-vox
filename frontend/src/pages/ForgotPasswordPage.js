import { useState, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Fingerprint, ArrowLeft } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PasswordInput from "@/components/ui/PasswordInput";
import AuthShell from "@/components/auth/AuthShell";
import { formatAppError } from "@/lib/appErrors";
import LocalizedErrorBanner from "@/components/ui/LocalizedErrorBanner";
import api from "@/lib/api";

/**
 * Einheitliche Passwort-Reset-Seite
 *
 * Ablauf:
 *   1. E-Mail eingeben
 *   2. Backend prüft: Lokal, SVID, oder beides?
 *   3. Bei beides → Auswahl anzeigen
 *   4. Code anfordern → Code + neues Passwort eingeben → Fertig
 *
 * Unterstützt:
 *   - Lokale Instanz-Accounts (POST /api/auth/forgot-password + /api/auth/reset-password)
 *   - Singra Vox ID Accounts (POST /api/id/password/forgot + /api/id/password/reset)
 */

const STEPS = { EMAIL: "email", CHOOSE: "choose", CODE: "code", SUCCESS: "success" };

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [step, setStep] = useState(STEPS.EMAIL);
  const [email, setEmail] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [accountType, setAccountType] = useState(null);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Schritt 1: E-Mail prüfen
  const handleLookup = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { data } = await api.post("/auth/password-reset-lookup", { email: email.trim() });
      const found = data.accounts || [];
      setAccounts(found);

      if (found.length === 0) {
        // Sicherheit: Keine Info-Leakage, trotzdem weiterleiten
        toast.success(t("auth.passwordResetCodeSent"));
        setAccountType("local");
        setStep(STEPS.CODE);
      } else if (found.length === 1) {
        // Nur ein Account → direkt Code senden
        setAccountType(found[0]);
        await sendResetCode(found[0]);
        setStep(STEPS.CODE);
      } else {
        // Beide → Auswahl anzeigen
        setStep(STEPS.CHOOSE);
      }
    } catch (err) {
      setError(formatAppError(t, err, { fallbackKey: "auth.passwordResetRequestFailed" }));
    } finally {
      setLoading(false);
    }
  };

  // Code senden für gewählten Account-Typ
  const sendResetCode = async (type) => {
    const endpoint = type === "svid" ? "/id/password/forgot" : "/auth/forgot-password";
    await api.post(endpoint, { email: email.trim() });
    toast.success(t("auth.passwordResetCodeSent"));
  };

  // Schritt 2: Account-Typ wählen (bei beiden)
  const handleChoose = async (type) => {
    setError("");
    setLoading(true);
    setAccountType(type);
    try {
      await sendResetCode(type);
      setStep(STEPS.CODE);
    } catch (err) {
      setError(formatAppError(t, err, { fallbackKey: "auth.passwordResetRequestFailed" }));
    } finally {
      setLoading(false);
    }
  };

  // Schritt 3: Code + neues Passwort absenden
  const canSubmit = useMemo(
    () => code.trim().length === 6 && newPassword && confirmPassword && newPassword === confirmPassword,
    [code, newPassword, confirmPassword],
  );

  const handleReset = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordsDoNotMatch"));
      return;
    }
    setError("");
    setLoading(true);
    try {
      const endpoint = accountType === "svid" ? "/id/password/reset" : "/auth/reset-password";
      await api.post(endpoint, {
        email: email.trim(),
        code: code.trim(),
        new_password: newPassword,
      });
      setStep(STEPS.SUCCESS);
      toast.success(t("auth.passwordResetSuccess"));
    } catch (err) {
      setError(formatAppError(t, err, { fallbackKey: "auth.passwordResetFailed" }));
    } finally {
      setLoading(false);
    }
  };

  // Code erneut senden
  const handleResend = async () => {
    setError("");
    setLoading(true);
    try {
      await sendResetCode(accountType);
    } catch (err) {
      setError(formatAppError(t, err, { fallbackKey: "auth.passwordResetRequestFailed" }));
    } finally {
      setLoading(false);
    }
  };

  // ─── Schritt 1: E-Mail eingeben ──────────────────────────────────────────
  if (step === STEPS.EMAIL) {
    return (
      <AuthShell
        eyebrow={t("auth.forgotPassword")}
        title={t("auth.forgotPassword")}
        subtitle={t("auth.forgotPasswordSubtitle")}
        icon={ShieldCheck}
        sideTitle="Singra Vox"
        sideCopy={t("auth.heroSubtitle")}
        footer={
          <Link to="/login" className="flex items-center gap-1.5 text-sm font-medium text-cyan-300 hover:text-cyan-200 transition-colors">
            <ArrowLeft size={14} /> {t("auth.backToSignIn")}
          </Link>
        }
      >
        <form onSubmit={handleLookup} className="space-y-5" data-testid="forgot-password-page">
          <LocalizedErrorBanner message={error} className="text-red-200" />
          <div className="space-y-2">
            <Label className="workspace-section-label">{t("auth.email")}</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              autoFocus
              data-testid="forgot-email-input"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
            />
          </div>
          <Button
            type="submit"
            disabled={loading || !email.trim()}
            data-testid="forgot-submit-btn"
            className="h-12 w-full rounded-2xl bg-cyan-400 font-semibold text-zinc-950 shadow-[0_16px_40px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300 disabled:opacity-50"
          >
            {loading ? t("auth.checking") : t("auth.continueReset")}
          </Button>
        </form>
      </AuthShell>
    );
  }

  // ─── Schritt 2: Account-Typ wählen ───────────────────────────────────────
  if (step === STEPS.CHOOSE) {
    return (
      <AuthShell
        eyebrow={t("auth.forgotPassword")}
        title={t("auth.chooseAccountType")}
        subtitle={t("auth.chooseAccountSubtitle", { email: email.trim() })}
        icon={ShieldCheck}
        sideTitle="Singra Vox"
        sideCopy={t("auth.heroSubtitle")}
        footer={
          <button
            onClick={() => { setStep(STEPS.EMAIL); setError(""); }}
            className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={14} /> {t("auth.backToEmail")}
          </button>
        }
      >
        <div className="space-y-4" data-testid="forgot-choose-account">
          <LocalizedErrorBanner message={error} className="text-red-200" />

          <p className="text-sm text-zinc-400">{t("auth.multipleAccountsFound")}</p>

          {accounts.includes("local") && (
            <button
              onClick={() => handleChoose("local")}
              disabled={loading}
              data-testid="forgot-choose-local"
              className="group w-full rounded-2xl border border-white/10 bg-zinc-950/70 p-4 text-left transition hover:border-cyan-400/50 hover:bg-zinc-900/70 disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/10">
                  <ShieldCheck size={22} className="text-cyan-400" weight="duotone" />
                </div>
                <div>
                  <div className="font-semibold text-white">{t("auth.localAccount")}</div>
                  <div className="text-xs text-zinc-400">{t("auth.localAccountDesc")}</div>
                </div>
              </div>
            </button>
          )}

          {accounts.includes("svid") && (
            <button
              onClick={() => handleChoose("svid")}
              disabled={loading}
              data-testid="forgot-choose-svid"
              className="group w-full rounded-2xl border border-white/10 bg-zinc-950/70 p-4 text-left transition hover:border-violet-400/50 hover:bg-zinc-900/70 disabled:opacity-50"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-400/10">
                  <Fingerprint size={22} className="text-violet-400" weight="duotone" />
                </div>
                <div>
                  <div className="font-semibold text-white">{t("auth.svidAccount")}</div>
                  <div className="text-xs text-zinc-400">{t("auth.svidAccountDesc")}</div>
                </div>
              </div>
            </button>
          )}
        </div>
      </AuthShell>
    );
  }

  // ─── Schritt 3: Code + neues Passwort ────────────────────────────────────
  if (step === STEPS.CODE) {
    const isSvid = accountType === "svid";
    return (
      <AuthShell
        eyebrow={t("auth.resetPassword")}
        title={t("auth.resetPassword")}
        subtitle={t("auth.resetPasswordSubtitle")}
        icon={isSvid ? Fingerprint : ShieldCheck}
        sideTitle="Singra Vox"
        sideCopy={t("auth.heroSubtitle")}
        footer={
          <div className="flex items-center justify-between gap-3">
            <button
              onClick={handleResend}
              disabled={loading}
              className="text-sm text-zinc-400 hover:text-white transition-colors disabled:opacity-50"
              data-testid="reset-resend-btn"
            >
              {loading ? t("auth.sendingResetCode") : t("auth.resendCode")}
            </button>
            <button
              onClick={() => { setStep(STEPS.EMAIL); setCode(""); setNewPassword(""); setConfirmPassword(""); setError(""); }}
              className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
            >
              <ArrowLeft size={14} /> {t("auth.startOver")}
            </button>
          </div>
        }
      >
        <form onSubmit={handleReset} className="space-y-4" data-testid="reset-password-page">
          <LocalizedErrorBanner message={error} className="text-red-200" />

          {/* Account-Typ Badge */}
          <div className="flex items-center gap-2 rounded-xl bg-zinc-900/70 p-2.5">
            <span className={`inline-flex h-6 items-center rounded-lg px-2 text-xs font-medium ${isSvid ? "bg-violet-500/20 text-violet-300" : "bg-cyan-500/20 text-cyan-300"}`}>
              {isSvid ? "Singra Vox ID" : t("auth.localAccount")}
            </span>
            <span className="text-sm text-zinc-400">{email}</span>
          </div>

          <div className="space-y-2">
            <Label className="workspace-section-label">{t("auth.resetCode")}</Label>
            <Input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              autoFocus
              autoComplete="one-time-code"
              data-testid="reset-code-input"
              className="h-14 rounded-2xl border-white/10 bg-zinc-950/70 text-white text-center text-2xl tracking-[0.5em] font-mono placeholder:text-zinc-600 focus:border-cyan-400/50 focus:ring-cyan-400/40"
            />
          </div>

          <PasswordInput
            value={newPassword}
            onChange={setNewPassword}
            label={t("auth.newPassword")}
            showStrength={true}
            showGenerate={true}
            autoFocus={false}
            testId="reset-new-password"
          />

          <div className="space-y-2">
            <Label className="workspace-section-label">{t("auth.confirmPassword")}</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t("auth.confirmPassword")}
              data-testid="reset-confirm-password"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
            />
          </div>

          <Button
            type="submit"
            disabled={loading || !canSubmit}
            data-testid="reset-submit-btn"
            className="h-12 w-full rounded-2xl bg-cyan-400 font-semibold text-zinc-950 shadow-[0_16px_40px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300 disabled:opacity-50"
          >
            {loading ? t("auth.resettingPassword") : t("auth.resetPasswordAction")}
          </Button>
        </form>
      </AuthShell>
    );
  }

  // ─── Schritt 4: Erfolg ───────────────────────────────────────────────────
  return (
    <AuthShell
      eyebrow={t("auth.resetPassword")}
      title={t("auth.passwordResetComplete")}
      subtitle={t("auth.passwordResetCompleteSubtitle")}
      icon={ShieldCheck}
      sideTitle="Singra Vox"
      sideCopy={t("auth.heroSubtitle")}
    >
      <div className="space-y-4" data-testid="reset-success">
        <p className="text-sm text-zinc-400 text-center">{t("auth.canNowLoginWithNewPassword")}</p>
        <Button
          onClick={() => navigate("/login")}
          data-testid="reset-go-to-login"
          className="h-12 w-full rounded-2xl bg-cyan-400 font-semibold text-zinc-950 transition hover:bg-cyan-300"
        >
          {t("auth.backToSignIn")}
        </Button>
      </div>
    </AuthShell>
  );
}
