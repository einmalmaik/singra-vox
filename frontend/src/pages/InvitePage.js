import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowSquareOut, DesktopTower, ShieldCheck, SignIn, UserPlus } from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { formatError } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/contexts/RuntimeContext";
import { Button } from "@/components/ui/button";
import {
  attemptDesktopInviteLaunch,
  buildDesktopInviteLink,
  clearPendingInvite,
  describeInviteExpiry,
  describeInviteUsage,
  markDesktopOpenAttempt,
  rememberPreferredServer,
  savePendingInvite,
  shouldAttemptDesktopOpen,
} from "@/lib/inviteLinks";
import { isDesktopApp } from "@/lib/desktop";

export default function InvitePage() {
  const { t } = useTranslation();
  const { code } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { config, setupStatus } = useRuntime();
  const [inviteInfo, setInviteInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");
  const autoAcceptTriggeredRef = useRef(false);

  const inviteLink = useMemo(() => {
    const baseUrl = config?.instanceUrl || (typeof window !== "undefined" ? window.location.origin : "");
    return buildDesktopInviteLink(baseUrl, code);
  }, [code, config?.instanceUrl]);

  const loadInvite = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/invites/${code}`);
      setInviteInfo(response.data);
    } catch (err) {
      setInviteInfo(null);
      setError(formatError(err.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, [code]);

  const acceptInvite = useCallback(async () => {
    if (!code) return;
    setAccepting(true);
    setError("");

    try {
      const response = await api.post(`/invites/${code}/accept`);
      clearPendingInvite();
      rememberPreferredServer(response.data.server_id);
      toast.success(t("invite.joinedCommunity"));
      navigate("/", { replace: true });
    } catch (err) {
      setError(formatError(err.response?.data?.detail));
      toast.error(formatError(err.response?.data?.detail));
    } finally {
      setAccepting(false);
    }
  }, [code, navigate, t]);

  useEffect(() => {
    if (!code) return;
    savePendingInvite(code);
    void loadInvite();
  }, [code, loadInvite]);

  useEffect(() => {
    if (!inviteInfo || isDesktopApp()) return;
    if (!shouldAttemptDesktopOpen(code)) return;

    markDesktopOpenAttempt(code);
    // The browser stays on the HTTP invite page and only tries to hand off once.
    attemptDesktopInviteLaunch(inviteLink);
  }, [code, inviteInfo, inviteLink]);

  useEffect(() => {
    if (!user || !inviteInfo || autoAcceptTriggeredRef.current || location.state?.skipAutoAccept) {
      return;
    }

    autoAcceptTriggeredRef.current = true;
    void acceptInvite();
  }, [acceptInvite, inviteInfo, location.state?.skipAutoAccept, user]);

  const handleAuthRedirect = (targetPath) => {
    savePendingInvite(code);
    navigate(targetPath);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-6" data-testid="invite-page">
      <div className="w-full max-w-md rounded-2xl border border-[#27272A] bg-[#121212] p-6 shadow-2xl">
        <ShieldCheck size={44} weight="fill" className="mx-auto text-[#6366F1]" />

        {loading ? (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="h-8 w-8 rounded-full border-2 border-[#6366F1] border-t-transparent animate-spin" />
            <p className="text-sm text-[#A1A1AA]">{t("invite.loading")}</p>
          </div>
        ) : error && !inviteInfo ? (
          <div className="mt-6 text-center">
            <h2 className="text-2xl font-bold text-white" style={{ fontFamily: "Manrope" }}>
              {t("invite.unavailable")}
            </h2>
            <p className="mt-3 text-sm text-[#A1A1AA]">{error}</p>
            <Button
              onClick={() => navigate("/login")}
              className="mt-6 w-full bg-[#27272A] hover:bg-[#3F3F46] text-white"
            >
                {t("invite.returnToSignIn")}
              </Button>
          </div>
        ) : inviteInfo ? (
          <div className="mt-5 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#71717A]">{t("invite.invite")}</p>
            <h2 className="mt-3 text-3xl font-bold text-white" style={{ fontFamily: "Manrope" }}>
              {t("invite.joinServer", { server: inviteInfo.server?.name })}
            </h2>
            <p className="mt-2 text-sm text-[#A1A1AA]">
              {describeInviteUsage(inviteInfo.invite?.max_uses, inviteInfo.invite?.uses)} · {describeInviteExpiry(inviteInfo.invite?.expires_at)}
            </p>

            {!isDesktopApp() && (
              <div className="mt-6 rounded-xl border border-[#27272A] bg-[#0A0A0A] px-4 py-4 text-left">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <DesktopTower size={16} className="text-[#A5B4FC]" />
                  {t("invite.openDesktop")}
                </div>
                <p className="mt-2 text-xs text-[#71717A]">
                  {t("invite.openDesktopHelp")}
                </p>
                <Button
                  onClick={() => attemptDesktopInviteLaunch(inviteLink)}
                  className="mt-4 w-full bg-[#27272A] hover:bg-[#3F3F46] text-white"
                >
                  <ArrowSquareOut size={14} className="mr-2" />
                  {t("invite.openDesktopAction")}
                </Button>
              </div>
            )}

            {error ? (
              <div className="mt-5 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-left text-sm text-red-300">
                {error}
              </div>
            ) : null}

            {user ? (
              <div className="mt-6 space-y-3">
                <Button
                  onClick={() => void acceptInvite()}
                  disabled={accepting}
                  className="w-full bg-[#6366F1] hover:bg-[#4F46E5] text-white"
                >
                  {accepting ? t("invite.joining") : t("invite.joinCommunity")}
                </Button>
                <Button
                  onClick={() => navigate("/", { replace: true })}
                  variant="outline"
                  className="w-full border-[#27272A] bg-transparent text-white hover:bg-[#1A1A1A]"
                >
                  {t("common.notNow")}
                </Button>
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                <Button
                  onClick={() => handleAuthRedirect("/login")}
                  className="w-full bg-[#6366F1] hover:bg-[#4F46E5] text-white"
                >
                  <SignIn size={14} className="mr-2" />
                  {t("invite.signInToJoin")}
                </Button>
                {setupStatus?.allow_open_signup ? (
                  <Button
                    onClick={() => handleAuthRedirect("/register")}
                    variant="outline"
                    className="w-full border-[#27272A] bg-transparent text-white hover:bg-[#1A1A1A]"
                  >
                    <UserPlus size={14} className="mr-2" />
                    {t("invite.createAccountAndJoin")}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
