import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/contexts/RuntimeContext";
import { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "@phosphor-icons/react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const { setupStatus } = useRuntime();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch (err) {
      setError(formatError(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" data-testid="login-page">
      <div
        className="hidden lg:flex lg:w-1/2 items-center justify-center relative"
        style={{
          backgroundImage: 'url(https://static.prod-images.emergentagent.com/jobs/ab5120aa-52b2-45d0-8c31-465387b65c60/images/5a2b1ab20571b43fc0763efbcb163ee57e49b0baef6e022d78582e64bd6b10fc.png)',
          backgroundSize: 'cover', backgroundPosition: 'center'
        }}
      >
        <div className="absolute inset-0 bg-black/60" />
        <div className="relative z-10 text-center px-12">
          <div className="flex items-center justify-center gap-3 mb-6">
            <ShieldCheck size={48} weight="fill" className="text-[#6366F1]" />
            <h1 className="text-5xl font-extrabold tracking-tight" style={{ fontFamily: 'Manrope' }}>
              Singra Vox
            </h1>
          </div>
          <p className="text-[#A1A1AA] text-lg max-w-md">
            Privacy-first communication. Self-hosted. No telemetry. No tracking. Your data, your rules.
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center bg-[#0A0A0A] px-6">
        <div className="w-full max-w-sm">
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <ShieldCheck size={32} weight="fill" className="text-[#6366F1]" />
            <h1 className="text-2xl font-bold" style={{ fontFamily: 'Manrope' }}>Singra Vox</h1>
          </div>

          <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: 'Manrope' }}>Welcome back</h2>
          <p className="text-[#71717A] text-sm mb-8">
            Sign in to {setupStatus?.instance_name || "your self-hosted instance"}
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-md text-sm" data-testid="login-error">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email" className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Email</Label>
              <Input
                id="email" type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required data-testid="login-email-input"
                className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] focus:ring-1 focus:ring-[#6366F1] text-white placeholder:text-[#52525B]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Password</Label>
              <Input
                id="password" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password" required data-testid="login-password-input"
                className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] focus:ring-1 focus:ring-[#6366F1] text-white placeholder:text-[#52525B]"
              />
            </div>
            <Button
              type="submit" disabled={loading} data-testid="login-submit-button"
              className="w-full bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold h-11"
            >
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>

          {setupStatus?.allow_open_signup && (
            <p className="text-center text-[#71717A] text-sm mt-6">
              No account yet?{" "}
              <Link to="/register" className="text-[#6366F1] hover:text-[#4F46E5] font-medium" data-testid="register-link">
                Create one
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
