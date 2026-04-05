import { useState, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthShell from "@/components/auth/AuthShell";
import LocalizedErrorBanner from "@/components/ui/LocalizedErrorBanner";
import { Fingerprint, ArrowLeft, Eye, EyeSlash, ArrowsClockwise, CheckCircle, XCircle } from "@phosphor-icons/react";
import api from "@/lib/api";

const STRENGTH_COLORS = ["#EF4444", "#F97316", "#EAB308", "#22C55E", "#10B981"];
const STRENGTH_LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"];

function PasswordStrength({ strength }) {
  if (!strength) return null;
  return (
    <div className="space-y-1.5" data-testid="password-strength">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ backgroundColor: i <= strength.score ? STRENGTH_COLORS[strength.score] : "#27272A" }}
          />
        ))}
      </div>
      <p className="text-xs" style={{ color: STRENGTH_COLORS[strength.score] }}>
        {STRENGTH_LABELS[strength.score]}
      </p>
      {strength.feedback?.length > 0 && (
        <ul className="space-y-0.5">
          {strength.feedback.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-zinc-400">
              <XCircle size={12} className="mt-0.5 text-red-400 shrink-0" />
              {f}
            </li>
          ))}
        </ul>
      )}
      {strength.meets_policy && (
        <p className="flex items-center gap-1.5 text-xs text-emerald-400">
          <CheckCircle size={12} /> Password meets all requirements
        </p>
      )}
    </div>
  );
}

export default function SvidRegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [strength, setStrength] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [verifyEmail, setVerifyEmail] = useState("");

  const checkStrength = useCallback(async (pw) => {
    if (pw.length < 3) { setStrength(null); return; }
    try {
      const res = await api.post("/id/password/check", { password: pw });
      setStrength(res.data);
    } catch { /* ignore */ }
  }, []);

  const handleGeneratePassword = async () => {
    try {
      const res = await api.post("/id/password/generate?length=18");
      setPassword(res.data.password);
      setStrength(res.data.strength);
      setShowPassword(true);
    } catch { /* ignore */ }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.post("/id/register", {
        email,
        username: username.toLowerCase().trim(),
        password,
        display_name: displayName || username,
      });
      if (res.data.verification_required) {
        setVerificationSent(true);
        setVerifyEmail(res.data.email);
      } else {
        navigate("/login");
      }
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (typeof detail === "object" && detail?.errors) {
        setError(detail.errors.join(". "));
      } else {
        setError(typeof detail === "string" ? detail : "Registration failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (verificationSent) {
    return (
      <AuthShell
        eyebrow="SINGRA VOX ID"
        title="Check your email"
        subtitle={`We sent a verification code to ${verifyEmail}`}
        icon={Fingerprint}
        sideTitle="Singra Vox ID"
        sideCopy="One account for all instances."
      >
        <div className="space-y-4" data-testid="svid-verify-sent">
          <p className="text-sm text-zinc-400">
            Enter the 6-digit code from your email to activate your Singra Vox ID.
            Then return to the login page to sign in.
          </p>
          <Button
            onClick={() => navigate("/login")}
            data-testid="svid-back-to-login"
            className="h-12 w-full rounded-2xl bg-violet-500 font-semibold text-white transition hover:bg-violet-400"
          >
            Back to Login
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="SINGRA VOX ID"
      title="Create your Singra Vox ID"
      subtitle="One account for every Singra Vox instance."
      icon={Fingerprint}
      sideTitle="Singra Vox ID"
      sideCopy="Register once, use everywhere. Your identity stays with you across all instances."
      footer={
        <p className="text-center text-sm text-zinc-400">
          Already have a Singra Vox ID?{" "}
          <Link to="/login" className="font-semibold text-violet-300 hover:text-violet-200">Sign in</Link>
        </p>
      }
    >
      <div data-testid="svid-register-page">
        <form onSubmit={handleSubmit} className="space-y-4">
          <LocalizedErrorBanner message={error} className="text-red-200" />

          <div className="space-y-2">
            <Label htmlFor="svid-reg-email" className="workspace-section-label">EMAIL</Label>
            <Input
              id="svid-reg-email" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com" required autoFocus
              data-testid="svid-reg-email"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-violet-400/50 focus:ring-violet-400/40"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="svid-reg-username" className="workspace-section-label">USERNAME</Label>
            <Input
              id="svid-reg-username" type="text" value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your_username" required
              data-testid="svid-reg-username"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-violet-400/50 focus:ring-violet-400/40"
            />
            <p className="text-xs text-zinc-600">3-32 characters: lowercase, numbers, underscores</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="svid-reg-display" className="workspace-section-label">DISPLAY NAME</Label>
            <Input
              id="svid-reg-display" type="text" value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How others see you"
              data-testid="svid-reg-display"
              className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-violet-400/50 focus:ring-violet-400/40"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="svid-reg-password" className="workspace-section-label">PASSWORD</Label>
              <button
                type="button" onClick={handleGeneratePassword}
                className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                data-testid="svid-generate-password"
              >
                <ArrowsClockwise size={12} /> Generate
              </button>
            </div>
            <div className="relative">
              <Input
                id="svid-reg-password" type={showPassword ? "text" : "password"} value={password}
                onChange={(e) => { setPassword(e.target.value); checkStrength(e.target.value); }}
                placeholder="Min. 10 chars, mixed case, numbers, symbols" required
                data-testid="svid-reg-password"
                className="h-12 rounded-2xl border-white/10 bg-zinc-950/70 text-white placeholder:text-zinc-500 focus:border-violet-400/50 focus:ring-violet-400/40 pr-10"
              />
              <button
                type="button" onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <PasswordStrength strength={strength} />
          </div>

          <Button
            type="submit"
            disabled={loading || (strength && !strength.meets_policy)}
            data-testid="svid-register-submit"
            className="h-12 w-full rounded-2xl bg-violet-500 font-semibold text-white shadow-[0_16px_40px_rgba(139,92,246,0.28)] transition hover:bg-violet-400 disabled:opacity-50"
          >
            {loading ? "Creating account..." : "Create Singra Vox ID"}
          </Button>

          <button
            type="button" onClick={() => navigate("/login")}
            className="flex items-center justify-center gap-1.5 w-full text-xs text-zinc-500 hover:text-zinc-300 transition-colors pt-1"
          >
            <ArrowLeft size={12} /> Back to login
          </button>
        </form>
      </div>
    </AuthShell>
  );
}
