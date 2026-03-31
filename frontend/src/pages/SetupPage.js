import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShieldCheck, RocketLaunch } from "@phosphor-icons/react";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/contexts/RuntimeContext";
import { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function SetupPage() {
  const navigate = useNavigate();
  const { bootstrap } = useAuth();
  const { config } = useRuntime();
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
      toast.success("Instance initialized");
      navigate("/onboarding");
    } catch (err) {
      setError(formatError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center px-6" data-testid="setup-page">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-3 mb-8">
          <RocketLaunch size={40} weight="fill" className="text-[#6366F1]" />
          <div>
            <h1 className="text-3xl font-bold" style={{ fontFamily: "Manrope" }}>Initialize Instance</h1>
            <p className="text-[#71717A] text-sm">
              Create the first owner account for {config?.isDesktop ? "the connected server" : "this self-hosted instance"}.
            </p>
          </div>
        </div>

        <div className="bg-[#121212] border border-[#27272A] rounded-xl p-6">
          <div className="flex items-start gap-3 bg-[#18181B] border border-[#27272A] rounded-lg p-4 mb-6">
            <ShieldCheck size={24} weight="fill" className="text-[#6366F1] shrink-0 mt-0.5" />
            <div className="text-sm text-[#A1A1AA]">
              This wizard runs once per instance. The first account becomes the instance owner and can promote additional admins later.
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-md text-sm" data-testid="setup-error">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Instance Name</Label>
              <Input
                value={instanceName}
                onChange={(e) => setInstanceName(e.target.value)}
                placeholder="Singra Vox"
                required
                data-testid="instance-name-input"
                className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Owner Email</Label>
                <Input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="admin@example.com"
                  required
                  data-testid="setup-owner-email"
                  className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Owner Username</Label>
                <Input
                  value={ownerUsername}
                  onChange={(e) => setOwnerUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  placeholder="owner"
                  required
                  data-testid="setup-owner-username"
                  className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Display Name</Label>
                <Input
                  value={ownerDisplayName}
                  onChange={(e) => setOwnerDisplayName(e.target.value)}
                  placeholder="Server Owner"
                  data-testid="setup-owner-display-name"
                  className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Password</Label>
                <Input
                  type="password"
                  value={ownerPassword}
                  onChange={(e) => setOwnerPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  data-testid="setup-owner-password"
                  className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white"
                />
              </div>
            </div>

            <label className="flex items-start gap-3 rounded-lg border border-[#27272A] bg-[#18181B] px-4 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={allowOpenSignup}
                onChange={(e) => setAllowOpenSignup(e.target.checked)}
                className="mt-1 accent-[#6366F1]"
                data-testid="setup-open-signup"
              />
              <div>
                <p className="text-sm font-medium text-white">Enable open signup</p>
                <p className="text-xs text-[#71717A]">New users can register on this instance after setup. Admin promotion stays owner-only.</p>
              </div>
            </label>

            <Button
              type="submit"
              disabled={loading}
              data-testid="setup-submit-button"
              className="w-full bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold h-11"
            >
              {loading ? "Initializing..." : "Create Owner Account"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

