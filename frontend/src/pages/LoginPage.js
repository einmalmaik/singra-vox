import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/contexts/RuntimeContext";
import api, { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthShell from "@/components/auth/AuthShell";
import { ShieldCheck } from "@phosphor-icons/react";
import { toast } from "sonner";
import { clearPendingInvite, loadPendingInvite, rememberPreferredServer } from "@/lib/inviteLinks";
import { rememberPendingVerification } from "@/lib/pendingVerification";

export default function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { setupStatus } = useRuntime();
  const navigate = useNavigate();
  const pendingInvite = useMemo(() => loadPendingInvite(), []);

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
          toast.success("Joined community");
          navigate("/", { replace: true });
          return;
        } catch (inviteError) {
          clearPendingInvite();
          toast.error(formatError(inviteError.response?.data?.detail));
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
      setError(formatError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

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
        {pendingInvite?.code ? (
          <div className="workspace-card mb-6 px-4 py-3 text-sm text-zinc-200">
            {t("auth.pendingInviteLogin")}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-300" data-testid="login-error">
              {error}
            </div>
          )}
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
        </form>
      </div>
    </AuthShell>
  );
}
