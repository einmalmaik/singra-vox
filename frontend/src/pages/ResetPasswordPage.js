/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import AuthShell from "@/components/auth/AuthShell";
import { formatAppError } from "@/lib/appErrors";
import LocalizedErrorBanner from "@/components/ui/LocalizedErrorBanner";

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { forgotPassword, resetPassword } = useAuth();
  const [email, setEmail] = useState(location.state?.email || "");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = useMemo(
    () => Boolean(email && code.trim().length === 6 && newPassword && confirmPassword),
    [code, confirmPassword, email, newPassword],
  );

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (code.trim().length !== 6) {
      setError(t("auth.enterResetCode"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordsDoNotMatch"));
      return;
    }

    setError("");
    setLoading(true);
    try {
      await resetPassword(email, code, newPassword);
      toast.success(t("auth.passwordResetSuccess"));
      navigate("/login", { replace: true });
    } catch (err) {
      setError(formatAppError(t, err, { fallbackKey: "auth.passwordResetFailed" }));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!email) {
      setError(t("auth.enterEmailFirst"));
      return;
    }
    setError("");
    setResending(true);
    try {
      await forgotPassword(email);
      toast.success(t("auth.passwordResetCodeSent"));
    } catch (err) {
      setError(formatAppError(t, err, { fallbackKey: "auth.passwordResetRequestFailed" }));
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthShell
      eyebrow={t("auth.resetPassword")}
      title={t("auth.resetPassword")}
      subtitle={t("auth.resetPasswordSubtitle")}
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
            {resending ? t("auth.sendingResetCode") : t("auth.resendCode")}
          </Button>
          <Link to="/login" className="text-sm font-medium text-cyan-300 transition-colors hover:text-cyan-200">
            {t("auth.backToSignIn")}
          </Link>
        </div>
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-5" data-testid="reset-password-page">
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

        <div className="space-y-2">
          <Label className="workspace-section-label">{t("auth.resetCode")}</Label>
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

        <div className="space-y-2">
          <Label className="workspace-section-label">{t("auth.newPassword")}</Label>
          <Input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder={t("auth.passwordMinLength")}
            className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
          />
        </div>

        <div className="space-y-2">
          <Label className="workspace-section-label">{t("auth.confirmPassword")}</Label>
          <Input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder={t("auth.confirmPassword")}
            className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
          />
        </div>

        <Button type="submit" disabled={loading || !canSubmit} className="h-12 w-full rounded-2xl bg-cyan-400 font-semibold text-zinc-950 shadow-[0_16px_40px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300">
          {loading ? t("auth.resettingPassword") : t("auth.resetPasswordAction")}
        </Button>
      </form>
    </AuthShell>
  );
}
