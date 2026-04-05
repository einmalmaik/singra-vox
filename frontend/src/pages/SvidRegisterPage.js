import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PasswordInput from "@/components/ui/PasswordInput";
import AuthShell from "@/components/auth/AuthShell";
import LocalizedErrorBanner from "@/components/ui/LocalizedErrorBanner";
import { Fingerprint, ArrowLeft, CheckCircle } from "@phosphor-icons/react";
import api from "@/lib/api";

export default function SvidRegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/id/register", {
        email,
        username: username.toLowerCase().trim(),
        password,
        display_name: displayName || username,
      });
      if (res.data.verification_required) {
        setVerificationSent(true);
        setVerifyEmail(res.data.email);
      } else {
        navigate("/login");
      }
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === "object" && detail?.errors) {
        setError(detail.errors.join(". "));
      } else {
        setError(typeof detail === "string" ? detail : "Registration failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e) => {
    e.preventDefault();
    setError("");
    setVerifying(true);
    try {
      await api.post("/id/verify-email", { email: verifyEmail, code: verifyCode.trim() });
      setVerified(true);
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : t("svid.invalidCode"));
    } finally {
      setVerifying(false);
    }
  };

  const handleResendCode = async () => {
    setError("");
    setLoading(true);
    try {
      await api.post("/id/resend-verification", { email: verifyEmail });
      setError("");
    } catch (err) {
      const detail = err.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Could not resend code.");
    } finally {
      setLoading(false);
    }
  };

  if (verified) {
    return (
      <AuthShell
        eyebrow="SINGRA VOX ID"
        title={t("svid.emailVerified")}
        subtitle={t("svid.emailVerifiedSubtitle")}
        icon={Fingerprint}
        sideTitle="Singra Vox ID"
        sideCopy="One account for all instances."
      >
        <div className="space-y-4" data-testid="svid-verified-success">
          <div className="flex items-center justify-center">
            <CheckCircle size={48} className="text-emerald-400" weight="fill" />
          </div>
          <p className="text-sm text-zinc-400 text-center">
            {t("svid.canNowLogin")}
          </p>
          <Button
            onClick={() => navigate("/login")}
            data-testid="svid-go-to-login"
            className="h-12 w-full rounded-2xl bg-violet-500 font-semibold text-white transition hover:bg-violet-400"
          >
            {t("svid.backToLoginButton")}
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (verificationSent) {
    return (
      <AuthShell
        eyebrow="SINGRA VOX ID"
        title={t("svid.checkEmail")}
        subtitle={t("svid.checkEmailSubtitle", { email: verifyEmail })}
        icon={Fingerprint}
        sideTitle="Singra Vox ID"
        sideCopy="One account for all instances."
      >
        <form onSubmit={handleVerifyCode} className="space-y-4" data-testid="svid-verify-code-form">
          <LocalizedErrorBanner message={error} className="text-red-200" />

          <p className="text-sm text-zinc-400">
            {t("svid.checkEmailHint")}
          </p>

          <div className="space-y-2">
            <Label htmlFor="svid-verify-code" className="workspace-section-label">
              {t("auth.verificationCode")}
            </Label>
            <Input
              id="svid-verify-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              required
              autoFocus
              autoComplete="one-time-code"
              data-testid="svid-verify-code-input"
              className="h-14 rounded-2xl border-white/10 bg-zinc-950/70 text-white text-center text-2xl tracking-[0.5em] font-mono placeholder:text-zinc-600 focus:border-violet-400/50 focus:ring-violet-400/40"
            />
          </div>

          <Button
            type="submit"
            disabled={verifying || verifyCode.length < 6}
            data-testid="svid-verify-submit"
            className="h-12 w-full rounded-2xl bg-violet-500 font-semibold text-white shadow-[0_16px_40px_rgba(139,92,246,0.28)] transition hover:bg-violet-400 disabled:opacity-50"
          >
            {verifying ? t("svid.verifying") : t("svid.verifyCode")}
          </Button>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={handleResendCode}
              disabled={loading}
              className="text-xs text-violet-400 hover:text-violet-300 transition-colors disabled:opacity-50"
              data-testid="svid-resend-code"
            >
              {loading ? t("svid.resending") : t("svid.resendCode")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              data-testid="svid-back-to-login"
            >
              <ArrowLeft size={12} /> {t("svid.backToLogin")}
            </button>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="SINGRA VOX ID"
      title={t("svid.registerTitle")}
      subtitle={t("svid.registerSubtitle")}
      icon={Fingerprint}
      sideTitle="Singra Vox ID"
      sideCopy={t("svid.registerSideCopy")}
      footer={
        <p className="text-center text-sm text-zinc-400">
          {t("svid.alreadyHaveSvid")}{" "}
          <Link to="/login" className="font-semibold text-violet-300 hover:text-violet-200">{t("svid.signIn")}</Link>
        </p>
      }
    >
      <div data-testid="svid-register-page">
        <form onSubmit={handleSubmit} className="space-y-4">
          <LocalizedErrorBanner message={error} className="text-red-200" />

          <div className="space-y-2">
            <Label htmlFor="svid-reg-email" className="workspace-section-label">{t("svid.email")}</Label>
            <Input
              id="svid-reg-email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" required autoFocus
              data-testid="svid-reg-email"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-violet-400/50 focus:ring-violet-400/40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="svid-reg-username" className="workspace-section-label">{t("svid.username")}</Label>
            <Input
              id="svid-reg-username" type="text" value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your_username" required
              data-testid="svid-reg-username"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-violet-400/50 focus:ring-violet-400/40"
            />
            <p className="text-xs text-zinc-600">{t("svid.usernameHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="svid-reg-display" className="workspace-section-label">{t("svid.displayName")}</Label>
            <Input
              id="svid-reg-display" type="text" value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("svid.displayNamePlaceholder")}
              data-testid="svid-reg-display"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-violet-400/50 focus:ring-violet-400/40"
            />
          </div>

          <PasswordInput
            value={password}
            onChange={setPassword}
            label={t("svid.password")}
            showStrength={true}
            showGenerate={true}
            testId="svid-reg-password"
          />

          <Button
            type="submit"
            disabled={loading || !password}
            data-testid="svid-register-submit"
            className="h-12 w-full rounded-2xl bg-violet-500 font-semibold text-white shadow-[0_16px_40px_rgba(139,92,246,0.28)] transition hover:bg-violet-400 disabled:opacity-50"
          >
            {loading ? t("svid.creatingAccount") : t("svid.createAccount")}
          </Button>

          <button
            type="button" onClick={() => navigate("/login")}
            className="flex items-center justify-center gap-1.5 w-full text-xs text-zinc-500 hover:text-zinc-300 transition-colors pt-1"
          >
            <ArrowLeft size={12} /> {t("svid.backToLogin")}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
