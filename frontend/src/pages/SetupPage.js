import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ShieldCheck, RocketLaunch, ArrowLeft } from "@phosphor-icons/react";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/contexts/RuntimeContext";
import { formatAppError } from "@/lib/appErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import LocalizedErrorBanner from "@/components/ui/LocalizedErrorBanner";
import { toast } from "sonner";



export default function SetupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { bootstrap } = useAuth();
  const { config, disconnectFromInstance } = useRuntime();
  const [instanceName, setInstanceName] = useState("Singra Vox");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerUsername, setOwnerUsername] = useState("");
  const [ownerDisplayName, setOwnerDisplayName] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [allowOpenSignup, setAllowOpenSignup] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await bootstrap({
        instance_name: instanceName,
        owner_email: ownerEmail,
        owner_username: ownerUsername,
        owner_display_name: ownerDisplayName || ownerUsername,
        owner_password: ownerPassword,
        allow_open_signup: allowOpenSignup,
      });
      toast.success(t("setup.instanceInitialized"));
      navigate("/onboarding");
    } catch (err) {
      setError(formatAppError(t, err, { fallbackKey: "setup.bootstrapFailed" }));
    } finally {
      setLoading(false);
    }
  };

  const handleBack = async () => {
    // disconnectFromInstance() aktualisiert auch den RuntimeContext-State,
    // sodass AppRoutes sofort zur /connect-Seite wechselt (Back-Button-Fix).
    await disconnectFromInstance();
    navigate("/connect");
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{
        background:
          "radial-gradient(circle at top left, rgba(34,211,238,0.12), transparent 28%), radial-gradient(circle at bottom right, rgba(113,113,122,0.2), transparent 32%), linear-gradient(180deg,#05070b 0%,#09090b 45%,#060608 100%)",
      }}
      data-testid="setup-page"
    >
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          {config?.isDesktop && (
            <button
              type="button"
              onClick={handleBack}
              data-testid="setup-back-button"
              className="flex items-center justify-center w-9 h-9 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-all duration-150 shrink-0"
              title="Andere URL eingeben"
            >
              <ArrowLeft size={18} weight="bold" />
            </button>
          )}
          <div
            className="flex items-center justify-center w-12 h-12 rounded-2xl shrink-0"
            style={{
              background: "rgba(34,211,238,0.12)",
              border: "1px solid rgba(34,211,238,0.22)",
              boxShadow: "0 0 28px rgba(34,211,238,0.1)",
            }}
          >
            <RocketLaunch size={24} weight="fill" className="text-cyan-400" />
          </div>
          <div>
            <h1
              className="text-2xl font-bold text-white"
              style={{ fontFamily: "Manrope" }}
            >
              {t("setup.initializeInstance")}
            </h1>
            <p className="text-zinc-500 text-sm mt-0.5">
              {t("setup.initializeSubtitle", {
                target: config?.isDesktop
                  ? t("setup.connectedServer")
                  : t("setup.selfHostedInstance"),
              })}
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="workspace-card p-6 space-y-5">
          {/* Info Banner */}
          <div
            className="flex items-start gap-3 rounded-xl p-4"
            style={{
              background: "rgba(34,211,238,0.06)",
              border: "1px solid rgba(34,211,238,0.15)",
            }}
          >
            <ShieldCheck size={20} weight="fill" className="text-cyan-400 shrink-0 mt-0.5" />
            <p className="text-sm text-zinc-400 leading-relaxed">{t("setup.wizardHelp")}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <LocalizedErrorBanner
              message={error}
              className="rounded-xl text-red-300 bg-red-950/30 border border-red-800/30 px-4 py-3 text-sm"
              data-testid="setup-error"
            />

            {/* Instance Name */}
            <div className="space-y-1.5">
              <Label className="workspace-section-label">{t("setup.instanceName")}</Label>
              <Input
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                placeholder={t("setup.instanceNamePlaceholder")}
                required
                data-testid="instance-name-input"
                className="bg-zinc-900/70 border-white/10 focus:border-cyan-500/50 text-white placeholder:text-zinc-600 rounded-xl h-10"
              />
            </div>

            {/* Email & Username */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="workspace-section-label">{t("setup.ownerEmail")}</Label>
                <Input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder={t("setup.ownerEmailPlaceholder")}
                  required
                  data-testid="setup-owner-email"
                  className="bg-zinc-900/70 border-white/10 focus:border-cyan-500/50 text-white placeholder:text-zinc-600 rounded-xl h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="workspace-section-label">{t("setup.ownerUsername")}</Label>
                <Input
                  value={ownerUsername}
                  onChange={(e) =>
                    setOwnerUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
                  }
                  placeholder={t("setup.ownerUsernamePlaceholder")}
                  required
                  data-testid="setup-owner-username"
                  className="bg-zinc-900/70 border-white/10 focus:border-cyan-500/50 text-white placeholder:text-zinc-600 rounded-xl h-10"
                />
              </div>
            </div>

            {/* Display Name & Password */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="workspace-section-label">{t("auth.displayName")}</Label>
                <Input
                  value={ownerDisplayName}
                  onChange={(e) => setOwnerDisplayName(e.target.value)}
                  placeholder={t("setup.ownerDisplayNamePlaceholder")}
                  data-testid="setup-owner-display-name"
                  className="bg-zinc-900/70 border-white/10 focus:border-cyan-500/50 text-white placeholder:text-zinc-600 rounded-xl h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="workspace-section-label">{t("auth.password")}</Label>
                <Input
                  type="password"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  placeholder={t("auth.passwordMinLength")}
                  required
                  data-testid="setup-owner-password"
                  className="bg-zinc-900/70 border-white/10 focus:border-cyan-500/50 text-white placeholder:text-zinc-600 rounded-xl h-10"
                />
              </div>
            </div>

            {/* Open Signup Toggle */}
            <label
              className="flex items-start gap-3 rounded-xl cursor-pointer transition-colors duration-200"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                padding: "12px 16px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.055)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.03)";
              }}
            >
              <input
                type="checkbox"
                checked={allowOpenSignup}
                onChange={(e) => setAllowOpenSignup(e.target.checked)}
                className="mt-1 accent-cyan-400"
                data-testid="setup-open-signup"
              />
              <div>
                <p className="text-sm font-medium text-white">{t("setup.enableOpenSignup")}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{t("setup.enableOpenSignupHelp")}</p>
              </div>
            </label>

            {/* Submit */}
            <Button
              type="submit"
              disabled={loading}
              data-testid="setup-submit-button"
              className="w-full font-semibold h-11 rounded-xl text-sm transition-all duration-200"
              style={{
                background: loading
                  ? "rgba(34,211,238,0.3)"
                  : "linear-gradient(135deg, rgba(34,211,238,0.85), rgba(6,182,212,0.9))",
                color: "#05070b",
                border: "1px solid rgba(34,211,238,0.3)",
                boxShadow: loading ? "none" : "0 0 20px rgba(34,211,238,0.2)",
              }}
            >
              {loading ? t("setup.initializing") : t("setup.createOwnerAccount")}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
