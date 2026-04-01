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
    <div className="min-h-screen flex" data-testid="login-page">
      <div
        className="hidden lg:flex lg:w-1/2 items-center justify-center relative"
        style={{
          backgroundImage: 'url(https://static.prod-images.emergentagent.com/jobs/ab5120aa-52b2-45d0-8c31-465387b65c60/images/5a2b1ab20571b43fc0763efbcb163ee57e49b0baef6e022d78582e64bd6b10fc.png)',
          backgroundSize: 'cover', backgroundPosition: 'center'
        }}
      >
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative z-10 text-center px-12">
          <div className="flex items-center justify-center gap-3 mb-6">
            <ShieldCheck size={48} weight="fill" className="text-[#6366F1]" />
            <h1 className="text-5xl font-extrabold tracking-tight" style={{ fontFamily: 'Manrope' }}>
              Singra Vox
            </h1>
          </div>
          <p className="text-[#A1A1AA] text-lg max-w-md">
            {t("auth.heroSubtitle")}
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center bg-[#0A0A0A] px-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <ShieldCheck size={32} weight="fill" className="text-[#6366F1]" />
            <h1 className="text-2xl font-bold" style={{ fontFamily: 'Manrope' }}>Singra Vox</h1>
          </div>

          <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: 'Manrope' }}>{t("auth.welcomeBack")}</h2>
          <p className="text-[#71717A] text-sm mb-8">
            {t("auth.signInSubtitle", { instance: setupStatus?.instance_name || t("setup.selfHostedInstance") })}
          </p>
          {pendingInvite?.code ? (
            <div className="mb-6 rounded-md border border-[#27272A] bg-[#121212] px-4 py-3 text-sm text-[#D4D4D8]">
              {t("auth.pendingInviteLogin")}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-md text-sm" data-testid="login-error">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("auth.email")}</Label>
              <Input
                id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder={t("auth.emailPlaceholder")} required data-testid="login-email-input"
                className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] focus:ring-1 focus:ring-[#6366F1] text-white placeholder:text-[#52525B]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("auth.password")}</Label>
              <Input
                id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={t("auth.passwordPlaceholder")} required data-testid="login-password-input"
                className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] focus:ring-1 focus:ring-[#6366F1] text-white placeholder:text-[#52525B]"
              />
            </div>
            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-sm text-[#6366F1] hover:text-[#4F46E5]">
                {t("auth.forgotPassword")}
              </Link>
            </div>
            <Button
              type="submit" disabled={loading} data-testid="login-submit-button"
              className="w-full bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold h-11"
            >
              {loading ? t("auth.signingIn") : t("auth.signIn")}
            </Button>
          </form>

          {setupStatus?.allow_open_signup && (
            <p className="text-center text-[#71717A] text-sm mt-6">
              {t("auth.noAccount")}{" "}
              <Link to="/register" className="text-[#6366F1] hover:text-[#4F46E5] font-medium" data-testid="register-link">
                {t("auth.createOne")}
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
