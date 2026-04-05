import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/contexts/RuntimeContext";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthShell from "@/components/auth/AuthShell";
import LocalizedErrorBanner from "@/components/ui/LocalizedErrorBanner";
import { ShieldCheck, ArrowLeft, Fingerprint } from "@phosphor-icons/react";
import { toast } from "sonner";
import { clearPendingInvite, loadPendingInvite, rememberPreferredServer } from "@/lib/inviteLinks";
import { rememberPendingVerification } from "@/lib/pendingVerification";
import { clearDesktopInstanceUrl } from "@/lib/runtimeConfig";

export default function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, loginWithSvid } = useAuth();
  const { setupStatus, config, disconnectFromInstance } = useRuntime();
  const navigate = useNavigate();
  const pendingInvite = useMemo(() => loadPendingInvite(), []);

  // ── Singra Vox ID login state ────────────────────────────────────────────
  const [showSvidLogin, setShowSvidLogin] = useState(false);
  const [svidEmail, setSvidEmail] = useState("");
  const [svidPassword, setSvidPassword] = useState("");
  const [svidError, setSvidError] = useState("");
  const [svidLoading, setSvidLoading] = useState(false);
  const [requires2FA, setRequires2FA] = useState(false);
  const [pendingToken, setPendingToken] = useState("");
  const [totpCode, setTotpCode] = useState("");

  const handleChangeServer = async () => {
    await disconnectFromInstance();
    navigate("/connect");
  };

  // ── Local instance login ─────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      if (pendingInvite?.code) {
        try {
          const inviteResponse = await api.post(`/invites/${pendingInvite.code}/accept`);
          clearPendingInvite();
          rememberPreferredServer(inviteResponse.data.server_id);
          toast.success(t("invite.joinedServer"));
          navigate("/", { replace: true });
          return;
        } catch (inviteError) {
          clearPendingInvite();
          toast.error(formatAppError(t, inviteError, { fallbackKey: "invite.acceptFailed" }));
          navigate(`/invite/${pendingInvite.code}`, { replace: true, state: { skipAutoAccept: true } });
          return;
        }
      }
      navigate("/");
    } catch (err) {
      if (err.response?.status === 403 && err.response?.data?.detail?.code === "email_verification_required") {
        const verificationEmail = err.response?.data?.detail?.email || email;
        rememberPendingVerification(verificationEmail);
        toast.info(t("auth.verifyEmail"));
        navigate("/verify-email", { state: { email: verificationEmail } });
        return;
      }
      setError(formatAppError(t, err, { fallbackKey: "auth.signInFailed" }));
    } finally {
      setLoading(false);
    }
  };

  // ── Singra Vox ID login ──────────────────────────────────────────────────
  const handleSvidLogin = async (e) => {
    e.preventDefault();
    setSvidError("");
    setSvidLoading(true);
    try {
      // Step 1: Login to Singra Vox ID
      const svidRes = await api.post("/id/login", {
        email: svidEmail,
        password: svidPassword,
      });

      if (svidRes.data.requires_2fa) {
        setRequires2FA(true);
        setPendingToken(svidRes.data.pending_token);
        setSvidLoading(false);
        return;
      }

      // Step 2: Login to instance with SVID token
      await loginWithSvid(svidRes.data.access_token);
      navigate("/");
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === "object" && detail?.code === "email_verification_required") {
        setSvidError("Please verify your email address first.");
      } else {
        setSvidError(typeof detail === "string" ? detail : "Login failed. Please check your credentials.");
      }
    } finally {
      setSvidLoading(false);
    }
  };

  // ── 2FA completion ───────────────────────────────────────────────────────
  const handle2FASubmit = async (e) => {
    e.preventDefault();
    setSvidError("");
    setSvidLoading(true);
    try {
      const res2fa = await api.post("/id/login/2fa", {
        pending_token: pendingToken,
        code: totpCode,
      });
      await loginWithSvid(res2fa.data.access_token);
      navigate("/");
    } catch (err) {
      setSvidError(err.response?.data?.detail || "Invalid 2FA code.");
    } finally {
      setSvidLoading(false);
    }
  };

  // ── 2FA Form ─────────────────────────────────────────────────────────────
  if (requires2FA) {
    return (
      <AuthShell
        eyebrow="TWO-FACTOR"
        title={t("svid.twoFactorTitle")}
        subtitle={t("svid.twoFactorSubtitle")}
        icon={Fingerprint}
        sideTitle={setupStatus?.instance_name || "Singra Vox"}
        sideCopy="Privacy-first communication. Self-hosted. No telemetry."
      >
        <div data-testid="svid-2fa-page">
          <form onSubmit={handle2FASubmit} className="space-y-5">
            <LocalizedErrorBanner message={svidError} className="text-red-200" />
            <div className="space-y-2">
              <Label htmlFor="totp" className="workspace-section-label">{t("svid.authenticatorCode")}</Label>
              <Input
                id="totp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/[^0-9A-Za-z-]/g, ""))}
                placeholder="000000"
                required
                autoFocus
                data-testid="svid-2fa-input"
                className="h-14 rounded-2xl border-white/10 bg-zinc-950/70 text-center text-2xl font-mono tracking-[0.3em] text-white placeholder:text-zinc-600 focus:border-cyan-400/50 focus:ring-cyan-400/40"
              />
              <p className="text-xs text-zinc-500 mt-1">{ t("svid.backupCodeHint")}</p>
            </div>
            <Button
              type="submit"
              disabled={svidLoading || totpCode.length < 6}
              data-testid="svid-2fa-submit"
              className="h-12 w-full rounded-2xl bg-cyan-400 font-semibold text-zinc-950 shadow-[0_16px_40px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300"
            >
              {svidLoading ? t("svid.verifying") : t("svid.verify")}
            </Button>
            <button
              type="button"
              onClick={() => { setRequires2FA(false); setPendingToken(""); setTotpCode(""); }}
              className="flex items-center justify-center gap-1.5 w-full text-xs text-zinc-500 hover:text-zinc-300 transition-colors duration-150 pt-1"
            >
              <ArrowLeft size={12} /> Back to login
            </button>
          </form>
        </div>
      </AuthShell>
    );
  }

  // ── Singra Vox ID Login Form ─────────────────────────────────────────────
  if (showSvidLogin) {
    return (
      <AuthShell
        eyebrow="SINGRA VOX ID"
        title={t("svid.signInWithSvid")}
        subtitle={t("svid.svidLoginSubtitle")}
        icon={Fingerprint}
        sideTitle={setupStatus?.instance_name || "Singra Vox"}
        sideCopy="One account, all instances. Privacy-first."
      >
        <div data-testid="svid-login-page">
          <form onSubmit={handleSvidLogin} className="space-y-5">
            <LocalizedErrorBanner message={svidError} className="text-red-200" />
            <div className="space-y-2">
              <Label htmlFor="svid-email" className="workspace-section-label">{t("svid.svidEmail")}</Label>
              <Input
                id="svid-email"
                type="email"
                value={svidEmail}
                onChange={(e) => setSvidEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
                data-testid="svid-email-input"
                className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-violet-400/50 focus:ring-violet-400/40"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="svid-password" className="workspace-section-label">{t("svid.svidPassword")}</Label>
              <Input
                id="svid-password"
                type="password"
                value={svidPassword}
                onChange={(e) => setSvidPassword(e.target.value)}
                placeholder={t("svid.svidPasswordPlaceholder")}
                required
                data-testid="svid-password-input"
                className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-violet-400/50 focus:ring-violet-400/40"
              />
            </div>
            <Button
              type="submit"
              disabled={svidLoading}
              data-testid="svid-login-submit"
              className="h-12 w-full rounded-2xl bg-violet-500 font-semibold text-white shadow-[0_16px_40px_rgba(139,92,246,0.28)] transition hover:bg-violet-400"
            >
              {svidLoading ? t("svid.signingIn") : t("svid.signInWithSvid")}
            </Button>
            <div className="text-center">
              <Link
                to="/register-svid"
                className="text-sm font-medium text-violet-300 transition-colors hover:text-violet-200"
                data-testid="svid-register-link"
              >
                {t("svid.createSvidId")}
              </Link>
            </div>
            <button
              type="button"
              onClick={() => { setShowSvidLogin(false); setSvidError(""); }}
              className="flex items-center justify-center gap-1.5 w-full text-xs text-zinc-500 hover:text-zinc-300 transition-colors duration-150 pt-1"
            >
              <ArrowLeft size={12} /> Back to instance login
            </button>
          </form>
        </div>
      </AuthShell>
    );
  }

  // ── Main Login Page ──────────────────────────────────────────────────────
  return (
    <AuthShell
      eyebrow={t("auth.signIn")}
      title={t("auth.welcomeBack")}
      subtitle={t("auth.signInSubtitle", { instance: setupStatus?.instance_name || t("setup.selfHostedInstance") })}
      icon={ShieldCheck}
      sideTitle={setupStatus?.instance_name || "Singra Vox"}
      sideCopy={t("auth.heroSubtitle")}
      footer={setupStatus?.allow_open_signup ? (
        <p className="text-center text-sm text-zinc-400">
          {t("auth.noAccount")}{" "}
          <Link to="/register" className="font-semibold text-cyan-300 transition-colors hover:text-cyan-200" data-testid="register-link">
            {t("auth.createOne")}
          </Link>
        </p>
      ) : null}
    >
      <div data-testid="login-page">
        {/* Singra Vox ID Button */}
        <button
          type="button"
          onClick={() => setShowSvidLogin(true)}
          data-testid="svid-login-button"
          className="flex items-center justify-center gap-2.5 w-full h-12 rounded-2xl border border-violet-500/40 bg-violet-500/10 text-violet-200 font-semibold text-sm transition-all hover:bg-violet-500/20 hover:border-violet-400/60 hover:text-white mb-5"
        >
          <Fingerprint size={20} weight="bold" />
          {t("svid.signInWithSvid")}
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="h-px flex-1 bg-zinc-800" />
          <span className="text-xs font-medium text-zinc-600 uppercase tracking-wider">{t("svid.orSignInLocally")}</span>
          <div className="h-px flex-1 bg-zinc-800" />
        </div>

        {pendingInvite?.code ? (
          <div className="workspace-card mb-6 px-4 py-3 text-sm text-zinc-200">
            {t("auth.pendingInviteLogin")}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-5">
          <LocalizedErrorBanner message={error} className="text-red-200" data-testid="login-error" />
          <div className="space-y-2">
            <Label htmlFor="email" className="workspace-section-label">{t("auth.email")}</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              required
              data-testid="login-email-input"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="workspace-section-label">{t("auth.password")}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("auth.passwordPlaceholder")}
              required
              data-testid="login-password-input"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
            />
          </div>
          <div className="flex justify-end">
            <Link to="/forgot-password" className="text-sm font-medium text-cyan-300 transition-colors hover:text-cyan-200">
              {t("auth.forgotPassword")}
            </Link>
          </div>
          <Button
            type="submit"
            disabled={loading}
            data-testid="login-submit-button"
            className="h-12 w-full rounded-2xl bg-cyan-400 font-semibold text-zinc-950 shadow-[0_16px_40px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300"
          >
            {loading ? t("auth.signingIn") : t("auth.signIn")}
          </Button>

          {config?.isDesktop && (
            <button
              type="button"
              onClick={handleChangeServer}
              data-testid="login-change-server-button"
              className="flex items-center justify-center gap-1.5 w-full text-xs text-zinc-500 hover:text-zinc-300 transition-colors duration-150 pt-1"
            >
              <ArrowLeft size={12} />
              Andere Server-URL eingeben
            </button>
          )}
        </form>
      </div>
    </AuthShell>
  );
}
