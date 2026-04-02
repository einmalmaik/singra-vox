import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthShell from "@/components/auth/AuthShell";
import { formatAppError } from "@/lib/appErrors";
import LocalizedErrorBanner from "@/components/ui/LocalizedErrorBanner";

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await forgotPassword(email);
      toast.success(t("auth.passwordResetCodeSent"));
      navigate("/reset-password", { state: { email } });
    } catch (err) {
      setError(formatAppError(t, err, { fallbackKey: "auth.passwordResetRequestFailed" }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow={t("auth.forgotPassword")}
      title={t("auth.forgotPassword")}
      subtitle={t("auth.forgotPasswordSubtitle")}
      icon={ShieldCheck}
      sideTitle="Singra Vox"
      sideCopy={t("auth.heroSubtitle")}
      footer={(
        <div className="flex items-center justify-between gap-3 text-sm">
          <Link to="/login" className="font-medium text-cyan-300 transition-colors hover:text-cyan-200">
            {t("auth.backToSignIn")}
          </Link>
          <Link to="/reset-password" className="text-zinc-400 transition-colors hover:text-white">
            {t("auth.alreadyHaveResetCode")}
          </Link>
        </div>
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-5" data-testid="forgot-password-page">
        <LocalizedErrorBanner message={error} className="text-red-200" />

        <div className="space-y-2">
          <Label className="workspace-section-label">{t("auth.email")}</Label>
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t("auth.emailPlaceholder")}
            className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
          />
        </div>

        <Button type="submit" disabled={loading || !email} className="h-12 w-full rounded-2xl bg-cyan-400 font-semibold text-zinc-950 shadow-[0_16px_40px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300">
          {loading ? t("auth.sendingResetCode") : t("auth.sendResetCode")}
        </Button>
      </form>
    </AuthShell>
  );
}
