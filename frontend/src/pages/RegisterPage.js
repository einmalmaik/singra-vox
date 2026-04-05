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
import PasswordInput from "@/components/ui/PasswordInput";
import AuthShell from "@/components/auth/AuthShell";
import LocalizedErrorBanner from "@/components/ui/LocalizedErrorBanner";
import { ShieldCheck } from "@phosphor-icons/react";
import { toast } from "sonner";
import { clearPendingInvite, loadPendingInvite, rememberPreferredServer } from "@/lib/inviteLinks";
import { rememberPendingVerification } from "@/lib/pendingVerification";

export default function RegisterPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const { setupStatus } = useRuntime();
  const navigate = useNavigate();
  const pendingInvite = useMemo(() => loadPendingInvite(), []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError(t("auth.passwordMinLengthError")); return; }
    setLoading(true);
    try {
      const result = await register(email, username, password, displayName || username);
      if (result?.verification_required) {
        rememberPendingVerification(result.email || email);
        toast.success(t("auth.verificationSent"));
        navigate("/verify-email", { state: { email: result.email || email } });
        return;
      }
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
      setError(formatAppError(t, err, { fallbackKey: "auth.createAccountFailed" }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow={t("auth.createAccount")}
      title={t("auth.createAccount")}
      subtitle={t("auth.registerSubtitle", { instance: setupStatus?.instance_name || t("auth.defaultInstanceName") })}
      icon={ShieldCheck}
      sideTitle={setupStatus?.instance_name || "Singra Vox"}
      sideCopy={t("auth.heroSubtitle")}
      footer={(
        <p className="text-center text-sm text-zinc-400">
          {t("auth.alreadyHaveAccount")}{" "}
          <Link to="/login" className="font-semibold text-cyan-300 transition-colors hover:text-cyan-200" data-testid="login-link">
            {t("auth.signIn")}
          </Link>
        </p>
      )}
    >
      <div data-testid="register-page">
        {pendingInvite?.code ? (
          <div className="workspace-card mb-6 px-4 py-3 text-sm text-zinc-200">
            {t("auth.pendingInviteRegister")}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          <LocalizedErrorBanner message={error} className="text-red-200" data-testid="register-error" />
          <div className="space-y-2">
            <Label className="workspace-section-label">{t("auth.email")}</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              required
              data-testid="register-email-input"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
            />
          </div>
          <div className="space-y-2">
            <Label className="workspace-section-label">{t("auth.username")}</Label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              placeholder={t("auth.usernamePlaceholder")}
              required
              data-testid="register-username-input"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
            />
          </div>
          <div className="space-y-2">
            <Label className="workspace-section-label">{t("auth.displayName")}</Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t("auth.displayNamePlaceholder")}
              data-testid="register-display-input"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
            />
          </div>
          <PasswordInput
            value={password}
            onChange={setPassword}
            label={t("auth.password")}
            showStrength={true}
            showGenerate={true}
            testId="register-password"
          />
          <Button
            type="submit"
            disabled={loading}
            data-testid="register-submit-button"
            className="h-12 w-full rounded-2xl bg-cyan-400 font-semibold text-zinc-950 shadow-[0_16px_40px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300"
          >
            {loading ? t("auth.creatingAccount") : t("auth.createAccountAction")}
          </Button>
        </form>
      </div>
    </AuthShell>
  );
}
