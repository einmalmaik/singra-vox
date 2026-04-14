/*
 * Singra Vox - Singra-ID upgrade flow for existing local accounts
 *
 * Lets an authenticated instance-only user create and link a Singra-ID without
 * losing their local memberships, settings or encrypted workspace state.
 */
import { useCallback } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, CheckCircle, Fingerprint, Link as LinkIcon, ShieldCheck, UsersThree } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PasswordInput from "@/components/ui/PasswordInput";
import AuthShell from "@/components/auth/AuthShell";
import LocalizedErrorBanner from "@/components/ui/LocalizedErrorBanner";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api";
import useSvidRegistrationFlow from "@/pages/svid/useSvidRegistrationFlow";

function SetupInfoCard({ icon: Icon, title, copy }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-950/45 p-4">
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-cyan-300" weight="duotone" />
        <p className="text-sm font-semibold text-white">{title}</p>
      </div>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{copy}</p>
    </div>
  );
}

export default function SvidSetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, linkSvid } = useAuth();

  const goBackToWorkspace = useCallback(() => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/", { replace: true });
  }, [navigate]);

  const handleVerified = useCallback(async (verifiedSession) => {
    const accessToken = verifiedSession?.access_token || "";
    if (!accessToken) {
      throw new Error("Missing Singra-ID access token.");
    }

    if (user?.avatar_url) {
      const response = await fetch(`${api.defaults.baseURL || "/api"}/id/me`, {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ avatar_url: user.avatar_url }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail?.detail || detail?.message || "Failed to sync avatar.");
      }
    }

    await linkSvid(accessToken, { disableLocalPasswordLogin: true });
  }, [linkSvid, user?.avatar_url]);

  const flow = useSvidRegistrationFlow({
    initialProfile: {
      email: user?.email || "",
      username: user?.username || "",
      displayName: user?.display_name || user?.username || "",
    },
    onVerified: handleVerified,
    invalidCodeMessage: t("svid.invalidCode"),
  });

  if (!user) {
    return null;
  }

  if (flow.verification.verified) {
    return (
      <AuthShell
        eyebrow="SINGRA VOX ID"
        title={t("svid.setupSuccessTitle")}
        subtitle={t("svid.setupSuccessSubtitle")}
        icon={Fingerprint}
        sideTitle="Singra Vox ID"
        sideCopy={t("svid.setupSuccessSideCopy")}
      >
        <div className="space-y-4" data-testid="svid-setup-success">
          <div className="flex items-center justify-center">
            <CheckCircle size={48} className="text-emerald-400" weight="fill" />
          </div>
          <p className="text-center text-sm text-zinc-400">
            {t("svid.setupSuccessBody")}
          </p>
          <Button
            onClick={goBackToWorkspace}
            data-testid="svid-setup-finish"
            className="h-12 w-full rounded-2xl bg-cyan-400 font-semibold text-zinc-950 transition hover:bg-cyan-300"
          >
            {t("svid.setupSuccessAction")}
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (flow.verification.finalizationPending) {
    return (
      <AuthShell
        eyebrow="SINGRA VOX ID"
        title={t("svid.setupFinalizeTitle")}
        subtitle={t("svid.setupFinalizeSubtitle")}
        icon={Fingerprint}
        sideTitle="Singra Vox ID"
        sideCopy={t("svid.setupFinalizeSideCopy")}
      >
        <div className="space-y-4" data-testid="svid-setup-retry-linking">
          <LocalizedErrorBanner message={flow.status.error} className="text-red-200" />
          <p className="text-sm text-zinc-400">
            {t("svid.setupFinalizeHint")}
          </p>
          <Button
            type="button"
            onClick={() => void flow.actions.retryPostVerification()}
            disabled={flow.status.verifying}
            data-testid="svid-setup-retry-linking-action"
            className="h-12 w-full rounded-2xl bg-violet-500 font-semibold text-white shadow-[0_16px_40px_rgba(139,92,246,0.28)] transition hover:bg-violet-400 disabled:opacity-50"
          >
            {flow.status.verifying
              ? t("svid.verifying")
              : t("svid.setupFinalizeRetry")}
          </Button>
          <button
            type="button"
            onClick={goBackToWorkspace}
            className="flex w-full items-center justify-center gap-1.5 pt-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
            data-testid="svid-setup-finalize-back"
          >
            <ArrowLeft size={12} /> {t("svid.backToLogin")}
          </button>
        </div>
      </AuthShell>
    );
  }

  // Keep the local success state visible after linking. The auth context can
  // update `user.svid_account_id` before this page paints its completion view.
  if (user?.svid_account_id) {
    return <Navigate to="/" replace />;
  }

  if (flow.verification.verificationSent) {
    return (
      <AuthShell
        eyebrow="SINGRA VOX ID"
        title={t("svid.checkEmail")}
        subtitle={t("svid.checkEmailSubtitle", { email: flow.verification.verifyEmail })}
        icon={Fingerprint}
        sideTitle="Singra Vox ID"
        sideCopy={t("svid.setupVerifySideCopy")}
      >
        <form onSubmit={flow.actions.handleVerifyCode} className="space-y-4" data-testid="svid-setup-verify-form">
          <LocalizedErrorBanner message={flow.status.error} className="text-red-200" />

          <p className="text-sm text-zinc-400">
            {t("svid.checkEmailHint")}
          </p>

          <div className="space-y-2">
            <Label htmlFor="svid-setup-verify-code" className="workspace-section-label">
              {t("auth.verificationCode")}
            </Label>
            <Input
              id="svid-setup-verify-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={flow.verification.verifyCode}
              onChange={(event) => flow.verification.setVerifyCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000000"
              required
              autoFocus
              autoComplete="one-time-code"
              data-testid="svid-setup-verify-code-input"
              className="h-14 rounded-2xl border-white/10 bg-zinc-950/70 text-center text-2xl font-mono tracking-[0.5em] text-white placeholder:text-zinc-600 focus:border-violet-400/50 focus:ring-violet-400/40"
            />
          </div>

          <Button
            type="submit"
            disabled={flow.status.verifying || flow.verification.verifyCode.length < 6}
            data-testid="svid-setup-verify-submit"
            className="h-12 w-full rounded-2xl bg-violet-500 font-semibold text-white shadow-[0_16px_40px_rgba(139,92,246,0.28)] transition hover:bg-violet-400 disabled:opacity-50"
          >
            {flow.status.verifying ? t("svid.verifying") : t("svid.verifyCode")}
          </Button>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => void flow.actions.handleResendCode()}
              disabled={flow.status.loading}
              className="text-xs text-violet-400 transition-colors hover:text-violet-300 disabled:opacity-50"
              data-testid="svid-setup-resend-code"
            >
              {flow.status.loading ? t("svid.resending") : t("svid.resendCode")}
            </button>
            <button
              type="button"
              onClick={goBackToWorkspace}
              className="flex items-center gap-1.5 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
              data-testid="svid-setup-back"
            >
              <ArrowLeft size={12} /> {t("svid.backToLogin")}
            </button>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="SINGRA VOX ID"
      title={t("svid.setupTitle")}
      subtitle={t("svid.setupSubtitle")}
      icon={Fingerprint}
      sideTitle="Singra Vox ID"
      sideCopy={t("svid.setupSideCopy")}
      sideDetails={[
        {
          title: t("svid.setupKeepsDataTitle"),
          description: t("svid.setupKeepsDataCopy"),
        },
        {
          title: t("svid.setupFriendsTitle"),
          description: t("svid.setupFriendsCopy"),
        },
      ]}
    >
      <div className="space-y-5" data-testid="svid-setup-page">
        <LocalizedErrorBanner message={flow.status.error} className="text-red-200" />

        <div className="grid gap-3">
          <SetupInfoCard
            icon={UsersThree}
            title={t("svid.setupPreserveTitle")}
            copy={t("svid.setupPreserveCopy")}
          />
          <SetupInfoCard
            icon={LinkIcon}
            title={t("svid.setupUpgradeTitle")}
            copy={t("svid.setupUpgradeCopy")}
          />
          <SetupInfoCard
            icon={ShieldCheck}
            title={t("svid.setupPrivacyTitle")}
            copy={t("svid.setupPrivacyCopy")}
          />
        </div>

        <form onSubmit={flow.actions.handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="svid-setup-email" className="workspace-section-label">{t("svid.email")}</Label>
            <Input
              id="svid-setup-email"
              type="email"
              value={flow.form.email}
              onChange={(event) => flow.form.setEmail(event.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              data-testid="svid-setup-email"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-violet-400/50 focus:ring-violet-400/40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="svid-setup-username" className="workspace-section-label">{t("svid.username")}</Label>
            <Input
              id="svid-setup-username"
              type="text"
              value={flow.form.username}
              onChange={(event) => flow.form.setUsername(event.target.value)}
              placeholder={user.username}
              required
              data-testid="svid-setup-username"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-violet-400/50 focus:ring-violet-400/40"
            />
            <p className="text-xs text-zinc-600">{t("svid.usernameHint")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="svid-setup-display" className="workspace-section-label">{t("svid.displayName")}</Label>
            <Input
              id="svid-setup-display"
              type="text"
              value={flow.form.displayName}
              onChange={(event) => flow.form.setDisplayName(event.target.value)}
              placeholder={t("svid.displayNamePlaceholder")}
              data-testid="svid-setup-display"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-violet-400/50 focus:ring-violet-400/40"
            />
          </div>

          <PasswordInput
            value={flow.form.password}
            onChange={flow.form.setPassword}
            label={t("svid.password")}
            showStrength={true}
            showGenerate={true}
            testId="svid-setup-password"
          />

          <Button
            type="submit"
            disabled={flow.status.loading || !flow.form.password}
            data-testid="svid-setup-submit"
            className="h-12 w-full rounded-2xl bg-violet-500 font-semibold text-white shadow-[0_16px_40px_rgba(139,92,246,0.28)] transition hover:bg-violet-400 disabled:opacity-50"
          >
            {flow.status.loading
              ? t("svid.creatingAccount")
              : t("svid.setupCreateAction")}
          </Button>

          <button
            type="button"
            onClick={goBackToWorkspace}
            data-testid="svid-setup-cancel"
            className="flex w-full items-center justify-center gap-1.5 pt-1 text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            <ArrowLeft size={12} /> {t("common.notNow")}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
