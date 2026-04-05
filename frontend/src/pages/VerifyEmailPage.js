import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import AuthShell from "@/components/auth/AuthShell";
import LocalizedErrorBanner from "@/components/ui/LocalizedErrorBanner";
import { clearPendingInvite, loadPendingInvite, rememberPreferredServer } from "@/lib/inviteLinks";
import {
  clearPendingVerification,
  loadPendingVerification,
  rememberPendingVerification,
} from "@/lib/pendingVerification";

export default function VerifyEmailPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { verifyEmail, resendVerification } = useAuth();
  const [email, setEmail] = useState(location.state?.email || "");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");
  const pendingInvite = useMemo(() => loadPendingInvite(), []);

  useEffect(() => {
    if (location.state?.email) {
      rememberPendingVerification(location.state.email);
      return;
    }

    const storedEmail = loadPendingVerification();
    if (storedEmail) {
      setEmail(storedEmail);
    }
  }, [location.state?.email]);

  const completePendingInvite = async () => {
    if (!pendingInvite?.code) {
      navigate("/", { replace: true });
      return;
    }

    try {
      const inviteResponse = await api.post(`/invites/${pendingInvite.code}/accept`);
      clearPendingInvite();
      rememberPreferredServer(inviteResponse.data.server_id);
      toast.success(t("invite.joinedServer"));
      navigate("/", { replace: true });
    } catch (inviteError) {
      clearPendingInvite();
      toast.error(formatAppError(t, inviteError, { fallbackKey: "invite.acceptFailed" }));
      navigate(`/invite/${pendingInvite.code}`, { replace: true, state: { skipAutoAccept: true } });
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (code.trim().length !== 6) {
      setError(t("auth.enterVerificationCode"));
      return;
    }

    setError("");
    setLoading(true);
    try {
      await verifyEmail(email, code);
      clearPendingVerification();
      await completePendingInvite();
    } catch (err) {
      setError(formatAppError(t, err, { fallbackKey: "auth.verifyEmailFailed" }));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) {
      setError(t("auth.enterEmailFirst"));
      return;
    }
    setResending(true);
    setError("");
    try {
      await resendVerification(email);
      rememberPendingVerification(email);
      toast.success(t("auth.verificationSent"));
    } catch (err) {
      setError(formatAppError(t, err, { fallbackKey: "auth.resendVerificationFailed" }));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell
      eyebrow={t("auth.verifyEmail")}
      title={t("auth.verifyEmail")}
      subtitle={t("auth.verifyEmailSubtitle")}
      sideTitle="Singra Vox"
      sideCopy={t("auth.heroSubtitle")}
      footer={(
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleResend}
            disabled={resending || !email}
            className="rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10"
          >
            {resending ? t("auth.sendingCode") : t("auth.resendCode")}
          </Button>
          <Link to="/login" className="text-sm font-medium text-cyan-300 transition-colors hover:text-cyan-200">
            {t("auth.backToSignIn")}
          </Link>
        </div>
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-5" data-testid="verify-email-page">
        <LocalizedErrorBanner message={error} className="text-red-200" />

        <div className="space-y-2">
          <Label className="workspace-section-label">{t("auth.email")}</Label>
          <Input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              rememberPendingVerification(event.target.value);
            }}
            placeholder={t("auth.emailPlaceholder")}
            className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
          />
        </div>

        <div className="space-y-2">
          <Label className="workspace-section-label">{t("auth.verificationCode")}</Label>
          <InputOTP
            maxLength={6}
            value={code}
            onChange={setCode}
            containerClassName="justify-between"
          >
            <InputOTPGroup className="w-full justify-between gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  className="h-12 w-12 rounded-2xl border border-white/10 bg-zinc-950/70 text-white first:rounded-2xl last:rounded-2xl"
                />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <Button type="submit" disabled={loading || !email} className="h-12 w-full rounded-2xl bg-cyan-400 font-semibold text-zinc-950 shadow-[0_16px_40px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300">
          {loading ? t("auth.verifying") : t("auth.verifyAction")}
        </Button>
      </form>
    </AuthShell>
  );
}
