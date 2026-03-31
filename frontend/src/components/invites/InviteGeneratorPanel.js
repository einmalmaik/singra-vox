import { useMemo, useState } from "react";
import { Check, Copy, LinkSimple, Sparkle } from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { formatError } from "@/lib/api";
import { useRuntime } from "@/contexts/RuntimeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INVITE_EXPIRY_OPTIONS,
  buildDesktopInviteLink,
  buildInviteLink,
  describeInviteExpiry,
  describeInviteUsage,
} from "@/lib/inviteLinks";

export default function InviteGeneratorPanel({ serverId }) {
  const { config } = useRuntime();
  const [maxUses, setMaxUses] = useState("0");
  const [expiresHours, setExpiresHours] = useState("24");
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const inviteLink = useMemo(() => {
    if (!invite?.code) return "";
    const baseUrl = config?.instanceUrl || (typeof window !== "undefined" ? window.location.origin : "");
    return buildInviteLink(baseUrl, invite.code);
  }, [config?.instanceUrl, invite?.code]);

  const desktopInviteLink = useMemo(() => {
    if (!invite?.code) return "";
    const baseUrl = config?.instanceUrl || (typeof window !== "undefined" ? window.location.origin : "");
    return buildDesktopInviteLink(baseUrl, invite.code);
  }, [config?.instanceUrl, invite?.code]);

  const generateInvite = async () => {
    const parsedMaxUses = Number.parseInt(maxUses || "0", 10);
    const parsedExpiry = Number.parseInt(expiresHours || "24", 10);

    if (Number.isNaN(parsedMaxUses) || parsedMaxUses < 0) {
      toast.error("Max uses must be 0 or greater");
      return;
    }

    if (Number.isNaN(parsedExpiry) || parsedExpiry < 0) {
      toast.error("Expiry must be 0 or greater");
      return;
    }

    setLoading(true);
    try {
      const response = await api.post(`/servers/${serverId}/invites`, {
        max_uses: parsedMaxUses,
        expires_hours: parsedExpiry,
      });
      setInvite(response.data);
      toast.success("Invite created");
    } catch (error) {
      toast.error(formatError(error.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };

  const copyInvite = async () => {
    if (!inviteLink) return;

    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success("Invite link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy invite link");
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">
            Max Uses
          </Label>
          <Input
            type="number"
            min="0"
            step="1"
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
            className="bg-[#0A0A0A] border-[#27272A] text-white"
          />
          <p className="text-xs text-[#71717A]">Use 0 for unlimited invites.</p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">
            Expiry
          </Label>
          <Select value={expiresHours} onValueChange={setExpiresHours}>
            <SelectTrigger className="bg-[#0A0A0A] border-[#27272A] text-white">
              <SelectValue placeholder="Select expiry" />
            </SelectTrigger>
            <SelectContent className="border-[#27272A] bg-[#18181B] text-white">
              {INVITE_EXPIRY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-[#71717A]">Choose how long the invite stays valid.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={generateInvite} disabled={loading} className="bg-[#6366F1] hover:bg-[#4F46E5]">
          <Sparkle size={14} className="mr-2" />
          {loading ? "Generating..." : invite ? "Regenerate Invite" : "Generate Invite"}
        </Button>
        <p className="text-sm text-[#71717A]">
          Links use the current instance URL, so domain and IP deployments both work.
        </p>
      </div>

      {invite ? (
        <div className="space-y-3 rounded-xl border border-[#27272A] bg-[#0A0A0A] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Share this invite link</p>
              <p className="mt-1 text-xs text-[#71717A]">
                {describeInviteUsage(invite.max_uses, invite.uses)} · {describeInviteExpiry(invite.expires_at)}
              </p>
            </div>
            <div className="rounded-md border border-[#27272A] bg-[#121212] px-2 py-1 text-[11px] uppercase tracking-[0.2em] text-[#71717A]">
              {invite.code}
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              value={inviteLink}
              readOnly
              className="bg-[#121212] border-[#27272A] text-white text-xs"
            />
            <Button onClick={copyInvite} size="sm" className="bg-[#27272A] hover:bg-[#3F3F46] shrink-0">
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </div>

          <div className="rounded-lg border border-[#27272A] bg-[#121212] px-3 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <LinkSimple size={14} className="text-[#A5B4FC]" />
              Desktop handoff
            </div>
            <p className="mt-2 break-all text-xs text-[#71717A]">
              Installed desktop apps can also open this invite via <span className="text-[#A1A1AA]">{desktopInviteLink}</span>
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
