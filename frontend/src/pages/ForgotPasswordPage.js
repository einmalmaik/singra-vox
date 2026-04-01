import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatError } from "@/lib/api";

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
      setError(formatError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-6" data-testid="forgot-password-page">
      <div className="w-full max-w-md rounded-2xl border border-[#27272A] bg-[#121212] p-8 shadow-2xl">
        <div className="flex items-center gap-2 mb-6">
          <ShieldCheck size={32} weight="fill" className="text-[#6366F1]" />
          <h1 className="text-2xl font-bold" style={{ fontFamily: "Manrope" }}>{t("auth.forgotPassword")}</h1>
        </div>

        <p className="mb-6 text-sm text-[#A1A1AA]">{t("auth.forgotPasswordSubtitle")}</p>

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
              onChange={(event) => setEmail(event.target.value)}
              placeholder={t("auth.emailPlaceholder")}
              className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white"
            />
          </div>

          <Button type="submit" disabled={loading || !email} className="w-full bg-[#6366F1] hover:bg-[#4F46E5]">
            {loading ? t("auth.sendingResetCode") : t("auth.sendResetCode")}
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-between gap-3">
          <Link to="/login" className="text-sm text-[#6366F1] hover:text-[#4F46E5]">
            {t("auth.backToSignIn")}
          </Link>
          <Link to="/reset-password" className="text-sm text-[#A1A1AA] hover:text-white">
            {t("auth.alreadyHaveResetCode")}
          </Link>
        </div>
      </div>
    </div>
  );
}
