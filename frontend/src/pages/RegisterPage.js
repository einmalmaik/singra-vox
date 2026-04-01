import { useMemo, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/contexts/RuntimeContext";
import api, { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
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
      setError(formatError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-6" data-testid="register-page">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <ShieldCheck size={32} weight="fill" className="text-[#6366F1]" />
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'Manrope' }}>Singra Vox</h1>
        </div>

        <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: 'Manrope' }}>{t("auth.createAccount")}</h2>
        <p className="text-[#71717A] text-sm mb-8">
          {t("auth.registerSubtitle", { instance: setupStatus?.instance_name || "this privacy-first communication platform" })}
        </p>
        {pendingInvite?.code ? (
          <div className="mb-6 rounded-md border border-[#27272A] bg-[#121212] px-4 py-3 text-sm text-[#D4D4D8]">
            {t("auth.pendingInviteRegister")}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-md text-sm" data-testid="register-error">
              {error}
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("auth.email")}</Label>
            <Input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com" required data-testid="register-email-input"
              className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white placeholder:text-[#52525B]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("auth.username")}</Label>
            <Input
              value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="username" required data-testid="register-username-input"
              className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white placeholder:text-[#52525B]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("auth.displayName")}</Label>
            <Input
              value={displayName} onChange={e => setDisplayName(e.target.value)}
              placeholder="How others see you" data-testid="register-display-input"
              className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white placeholder:text-[#52525B]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("auth.password")}</Label>
            <Input
              type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Min. 8 characters" required data-testid="register-password-input"
              className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white placeholder:text-[#52525B]"
            />
          </div>
          <Button
            type="submit" disabled={loading} data-testid="register-submit-button"
            className="w-full bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold h-11"
          >
            {loading ? t("auth.creatingAccount") : t("auth.createAccountAction")}
          </Button>
        </form>

        <p className="text-center text-[#71717A] text-sm mt-6">
          {t("auth.alreadyHaveAccount")}{" "}
          <Link to="/login" className="text-[#6366F1] hover:text-[#4F46E5] font-medium" data-testid="login-link">
            {t("auth.signIn")}
          </Link>
        </p>
      </div>
    </div>
  );
}
