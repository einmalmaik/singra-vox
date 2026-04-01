import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import api, { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
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
      toast.success("Joined community");
      navigate("/", { replace: true });
    } catch (inviteError) {
      clearPendingInvite();
      toast.error(formatError(inviteError.response?.data?.detail));
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
      setError(formatError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) {
      setError("Enter your email address first.");
      return;
    }
    setResending(true);
    setError("");
    try {
      await resendVerification(email);
      rememberPendingVerification(email);
      toast.success(t("auth.verificationSent"));
    } catch (err) {
      setError(formatError(err.response?.data?.detail) || err.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-6" data-testid="verify-email-page">
      <div className="w-full max-w-md rounded-2xl border border-[#27272A] bg-[#121212] p-8 shadow-2xl">
        <div className="flex items-center gap-2 mb-6">
          <ShieldCheck size={32} weight="fill" className="text-[#6366F1]" />
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Manrope" }}>{t("auth.verifyEmail")}</h1>
        </div>

        <p className="mb-6 text-sm text-[#A1A1AA]">
          {t("auth.verifyEmailSubtitle")}
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {error ? (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          ) : null}

          <div className="space-y-2">
            <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("auth.email")}</Label>
            <Input
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                rememberPendingVerification(event.target.value);
              }}
              placeholder="you@example.com"
              className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("auth.verificationCode")}</Label>
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
                    className="h-12 w-12 rounded-lg border border-[#27272A] bg-[#18181B] text-white first:border first:rounded-lg last:border last:rounded-lg"
                  />
                ))}
              </InputOTPGroup>
            </InputOTP>
          </div>

          <Button type="submit" disabled={loading || !email} className="w-full bg-[#6366F1] hover:bg-[#4F46E5]">
            {loading ? t("auth.verifying") : t("auth.verifyAction")}
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={handleResend}
            disabled={resending || !email}
            className="border-[#27272A] bg-transparent text-white hover:bg-[#1A1A1A]"
          >
            {resending ? t("auth.sendingCode") : t("auth.resendCode")}
          </Button>
          <Link to="/login" className="text-sm text-[#6366F1] hover:text-[#4F46E5]">
            {t("auth.backToSignIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
