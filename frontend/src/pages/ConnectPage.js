import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DesktopTower, LinkSimple } from "@phosphor-icons/react";
import { useRuntime } from "@/contexts/RuntimeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAppError } from "@/lib/appErrors";
import LocalizedErrorBanner from "@/components/ui/LocalizedErrorBanner";

export default function ConnectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { connectToInstance } = useRuntime();
  const [instanceUrl, setInstanceUrl] = useState("http://localhost:8080");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { status } = await connectToInstance(instanceUrl);
      navigate(status?.initialized ? "/login" : "/setup");
    } catch (err) {
      setError(formatAppError(t, err, { fallbackKey: "connect.couldNotReach" }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-6" data-testid="connect-page">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <DesktopTower size={40} weight="fill" className="text-[#6366F1]" />
          <div>
            <h1 className="text-3xl font-bold" style={{ fontFamily: "Manrope" }}>{t("connect.title")}</h1>
            <p className="text-[#71717A] text-sm">{t("connect.subtitle")}</p>
          </div>
        </div>

        <div className="bg-[#121212] border border-[#27272A] rounded-xl p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <LocalizedErrorBanner message={error} className="rounded-md text-red-200" data-testid="connect-error" />

            <div className="space-y-2">
              <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">{t("connect.instanceUrl")}</Label>
              <Input
                value={instanceUrl}
                onChange={(e) => setInstanceUrl(e.target.value)}
                placeholder={t("connect.instanceUrlPlaceholder")}
                required
                data-testid="instance-url-input"
                className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white"
              />
            </div>

            <div className="rounded-lg border border-[#27272A] bg-[#18181B] px-4 py-3 text-xs text-[#71717A] flex gap-2">
              <LinkSimple size={16} className="text-[#6366F1] shrink-0 mt-0.5" />
              {t("connect.helpText")}
            </div>

            <Button
              type="submit"
              disabled={loading}
              data-testid="connect-submit-button"
              className="w-full bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold h-11"
            >
              {loading ? t("connect.connecting") : t("connect.connect")}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
