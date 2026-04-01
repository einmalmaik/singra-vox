import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { RocketLaunch } from "@phosphor-icons/react";
import api from "@/lib/api";
import { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-6" data-testid="onboarding-page">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <RocketLaunch size={36} weight="fill" className="text-[#6366F1]" />
          <div>
            <h2 className="text-2xl font-bold" style={{ fontFamily: "Manrope" }}>{t("onboarding.getStarted")}</h2>
            <p className="text-[#71717A] text-sm">{t("onboarding.subtitle")}</p>
          </div>
        </div>

        {canCreateInstanceCommunity && (
          <div className="bg-[#121212] border border-[#27272A] rounded-lg p-6 mb-6">
            <h3 className="text-lg font-bold mb-4" style={{ fontFamily: "Manrope" }}>{t("onboarding.createCommunity")}</h3>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("onboarding.communityName")}</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("onboarding.communityNamePlaceholder")}
                  required
                  data-testid="server-name-input"
                  className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white placeholder:text-[#52525B]"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("onboarding.description")}</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t("onboarding.descriptionPlaceholder")}
                  data-testid="server-desc-input"
                  className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white placeholder:text-[#52525B]"
                />
              </div>
              <Button
                type="submit"
                disabled={loading}
                data-testid="create-server-button"
                className="w-full bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold h-11"
              >
                {loading ? t("onboarding.creating") : t("onboarding.createCommunityAction")}
              </Button>
            </form>
          </div>
        )}

        <div className="bg-[#121212] border border-[#27272A] rounded-lg p-6">
          <h3 className="text-lg font-bold mb-4" style={{ fontFamily: "Manrope" }}>{t("onboarding.joinWithInvite")}</h3>
          <div className="flex gap-2">
            <Input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder={t("onboarding.invitePlaceholder")}
              data-testid="invite-code-input"
              className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white placeholder:text-[#52525B]"
            />
            <Button
              onClick={handleJoinInvite}
              disabled={loading || !inviteCode.trim()}
              data-testid="join-invite-button"
              className="bg-[#27272A] hover:bg-[#3f3f46] text-white shrink-0"
            >
              {t("onboarding.join")}
            </Button>
          </div>
          {!canCreateInstanceCommunity && (
            <p className="text-xs text-[#71717A] mt-4">
              {t("onboarding.inviteOnlyHelp")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
