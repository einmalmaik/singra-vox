import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RocketLaunch } from "@phosphor-icons/react";
import api from "@/lib/api";
import { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthShell from "@/components/auth/AuthShell";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { canCreateCommunity } from "@/lib/workspacePermissions";
import { normalizeInviteCode, rememberPreferredServer } from "@/lib/inviteLinks";

export default function OnboardingPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const navigate = useNavigate();
  const canCreateInstanceCommunity = canCreateCommunity(user);

  const handleCreate = async (event) => {
    event.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api.post("/servers", { name, description });
      toast.success(t("onboarding.communityCreated"));
      navigate("/");
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const handleJoinInvite = async () => {
    const normalizedInviteCode = normalizeInviteCode(inviteCode);
    if (!normalizedInviteCode) return;

    setLoading(true);
    try {
      const response = await api.post(`/invites/${normalizedInviteCode}/accept`);
      rememberPreferredServer(response.data.server_id);
      toast.success(t("invite.joinedCommunity"));
      navigate("/");
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow={t("onboarding.getStarted")}
      title={t("onboarding.getStarted")}
      subtitle={t("onboarding.subtitle")}
      icon={RocketLaunch}
      sideTitle="Singra Vox"
      sideCopy={t("auth.heroSubtitle")}
      cardClassName="max-w-2xl"
      contentClassName="max-w-none"
    >
      <div className="space-y-6" data-testid="onboarding-page">
        {canCreateInstanceCommunity && (
          <section className="workspace-card p-6">
            <h3 className="text-xl font-bold text-white" style={{ fontFamily: "Manrope" }}>{t("onboarding.createCommunity")}</h3>
            <form onSubmit={handleCreate} className="mt-5 space-y-4">
              <div className="space-y-2">
                <Label className="workspace-section-label">{t("onboarding.communityName")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("onboarding.communityNamePlaceholder")}
                  required
                  data-testid="server-name-input"
                  className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
                />
              </div>
              <div className="space-y-2">
                <Label className="workspace-section-label">{t("onboarding.description")}</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("onboarding.descriptionPlaceholder")}
                  data-testid="server-desc-input"
                  className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                data-testid="create-server-button"
                className="h-12 w-full rounded-2xl bg-cyan-400 font-semibold text-zinc-950 shadow-[0_16px_40px_rgba(34,211,238,0.28)] transition hover:bg-cyan-300"
              >
                {loading ? t("onboarding.creating") : t("onboarding.createCommunityAction")}
              </Button>
            </form>
          </section>
        )}

        <section className="workspace-card p-6">
          <h3 className="text-xl font-bold text-white" style={{ fontFamily: "Manrope" }}>{t("onboarding.joinWithInvite")}</h3>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder={t("onboarding.invitePlaceholder")}
              data-testid="invite-code-input"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-cyan-400/50 focus:ring-cyan-400/40"
            />
            <Button
              onClick={handleJoinInvite}
              disabled={loading || !inviteCode.trim()}
              data-testid="join-invite-button"
              className="h-12 shrink-0 rounded-2xl bg-white/8 px-6 text-white hover:bg-white/12"
            >
              {t("onboarding.join")}
            </Button>
          </div>
          {!canCreateInstanceCommunity && (
            <p className="mt-4 text-sm text-zinc-400">
              {t("onboarding.inviteOnlyHelp")}
            </p>
          )}
        </section>
      </div>
    </AuthShell>
  );
}
