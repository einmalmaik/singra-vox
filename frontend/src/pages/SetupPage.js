import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import api from "@/lib/api";
import { formatError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, RocketLaunch } from "@phosphor-icons/react";
import { toast } from "sonner";

export default function SetupPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteInfo, setInviteInfo] = useState(null);
  const navigate = useNavigate();
  const params = useParams();

  useEffect(() => {
    if (params.code) {
      loadInvite(params.code);
    }
  }, [params.code]);

  const loadInvite = async (code) => {
    try {
      const res = await api.get(`/invites/${code}`);
      setInviteInfo(res.data);
    } catch {
      toast.error("Invalid or expired invite");
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api.post("/setup/bootstrap", { name, description });
      toast.success("Server created!");
      navigate("/");
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const handleJoinInvite = async () => {
    if (!inviteCode.trim() && !params.code) return;
    setLoading(true);
    try {
      const code = params.code || inviteCode.trim();
      const res = await api.post(`/invites/${code}/accept`);
      toast.success("Joined server!");
      navigate("/");
    } catch (err) {
      toast.error(formatError(err.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  if (inviteInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-6" data-testid="invite-page">
        <div className="w-full max-w-sm text-center">
          <ShieldCheck size={48} weight="fill" className="text-[#6366F1] mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-2" style={{ fontFamily: 'Manrope' }}>You're invited!</h2>
          <p className="text-[#A1A1AA] mb-6">Join <span className="text-white font-semibold">{inviteInfo.server?.name}</span></p>
          <Button
            onClick={handleJoinInvite} disabled={loading} data-testid="accept-invite-button"
            className="w-full bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold h-11"
          >
            {loading ? "Joining..." : "Accept Invite"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-6" data-testid="setup-page">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <RocketLaunch size={36} weight="fill" className="text-[#6366F1]" />
          <div>
            <h2 className="text-2xl font-bold" style={{ fontFamily: 'Manrope' }}>Get Started</h2>
            <p className="text-[#71717A] text-sm">Create your first server or join one</p>
          </div>
        </div>

        <div className="bg-[#121212] border border-[#27272A] rounded-lg p-6 mb-6">
          <h3 className="text-lg font-bold mb-4" style={{ fontFamily: 'Manrope' }}>Create a Server</h3>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Server Name</Label>
              <Input
                value={name} onChange={e => setName(e.target.value)}
                placeholder="My Community" required data-testid="server-name-input"
                className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white placeholder:text-[#52525B]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Description</Label>
              <Input
                value={description} onChange={e => setDescription(e.target.value)}
                placeholder="What's this server about?" data-testid="server-desc-input"
                className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white placeholder:text-[#52525B]"
              />
            </div>
            <Button
              type="submit" disabled={loading} data-testid="create-server-button"
              className="w-full bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold h-11"
            >
              {loading ? "Creating..." : "Create Server"}
            </Button>
          </form>
        </div>

        <div className="bg-[#121212] border border-[#27272A] rounded-lg p-6">
          <h3 className="text-lg font-bold mb-4" style={{ fontFamily: 'Manrope' }}>Join with Invite</h3>
          <div className="flex gap-2">
            <Input
              value={inviteCode} onChange={e => setInviteCode(e.target.value)}
              placeholder="Paste invite code" data-testid="invite-code-input"
              className="bg-[#18181B] border-[#27272A] focus:border-[#6366F1] text-white placeholder:text-[#52525B]"
            />
            <Button
              onClick={handleJoinInvite} disabled={loading || !inviteCode.trim()} data-testid="join-invite-button"
              className="bg-[#27272A] hover:bg-[#3f3f46] text-white shrink-0"
            >
              Join
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
