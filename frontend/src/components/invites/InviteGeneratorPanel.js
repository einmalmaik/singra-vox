import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, LinkSimple, Sparkle } from "@phosphor-icons/react";
import { toast } from "sonner";
import api, { formatError } from "@/lib/api";
import { useRuntime } from "@/contexts/RuntimeContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  buildDesktopInviteLink,
  buildInviteLink,
} from "@/lib/inviteLinks";

export default function InviteGeneratorPanel({ serverId }) {
  const { t } = useTranslation();
  const { config } = useRuntime();
  const [maxUses, setMaxUses] = useState("0");
  const [expiresHours, setExpiresHours] = useState("24");
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const expiryOptions = useMemo(() => ([
    { value: "0", label: t("inviteGenerator.expiryNever") },
    { value: "1", label: t("inviteGenerator.expiryHour", { count: 1 }) },
    { value: "6", label: t("inviteGenerator.expiryHours", { count: 6 }) },
    { value: "12", label: t("inviteGenerator.expiryHours", { count: 12 }) },
    { value: "24", label: t("inviteGenerator.expiryDay", { count: 1 }) },
    { value: "168", label: t("inviteGenerator.expiryDays", { count: 7 }) },
    { value: "720", label: t("inviteGenerator.expiryDays", { count: 30 }) },
  ]), [t]);

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

  const usageSummary = useMemo(() => {
    const parsedMaxUses = Number(invite?.max_uses || 0);
    const parsedUses = Number(invite?.uses || 0);
    if (!parsedMaxUses) {
      return t("inviteGenerator.unlimitedUses");
    }

    const remainingUses = Math.max(parsedMaxUses - parsedUses, 0);
    return `${t("inviteGenerator.maxUsesCount", { count: parsedMaxUses })} · ${t("inviteGenerator.usesLeft", { count: remainingUses })}`;
  }, [invite?.max_uses, invite?.uses, t]);

  const expirySummary = useMemo(() => {
    if (!invite?.expires_at) {
      return t("inviteGenerator.doesNotExpire");
    }

    const expiresDate = new Date(invite.expires_at);
    if (Number.isNaN(expiresDate.getTime())) {
      return t("inviteGenerator.expiresSoon");
    }

    return t("inviteGenerator.expiresAt", { value: expiresDate.toLocaleString() });
  }, [invite?.expires_at, t]);

  const generateInvite = async () => {
    const parsedMaxUses = Number.parseInt(maxUses || "0", 10);
    const parsedExpiry = Number.parseInt(expiresHours || "24", 10);

    if (Number.isNaN(parsedMaxUses) || parsedMaxUses < 0) {
      toast.error(t("inviteGenerator.maxUsesInvalid"));
      return;
    }

    if (Number.isNaN(parsedExpiry) || parsedExpiry < 0) {
      toast.error(t("inviteGenerator.expiryInvalid"));
      return;
    }

    setLoading(true);
    try {
      const response = await api.post(`/servers/${serverId}/invites`, {
        max_uses: parsedMaxUses,
        expires_hours: parsedExpiry,
      });
      setInvite(response.data);
      toast.success(t("inviteGenerator.created"));
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
      toast.success(t("inviteGenerator.copied"));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("inviteGenerator.copyFailed"));
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">
            {t("inviteGenerator.maxUses")}
          </Label>
          <Input
            type="number"
            min="0"
            step="1"
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
            className="bg-[#0A0A0A] border-[#27272A] text-white"
          />
          <p className="text-xs text-[#71717A]">{t("inviteGenerator.maxUsesHelp")}</p>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">
            {t("inviteGenerator.expiry")}
          </Label>
          <select
            value={expiresHours}
            onChange={(event) => setExpiresHours(event.target.value)}
            className="h-10 w-full rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white outline-none focus:border-[#6366F1]"
          >
            {expiryOptions.map((option) => (
              <option key={option.value} value={option.value} className="bg-[#18181B] text-white">
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-[#71717A]">{t("inviteGenerator.expiryHelp")}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={generateInvite} disabled={loading} className="bg-[#6366F1] hover:bg-[#4F46E5]">
          <Sparkle size={14} className="mr-2" />
          {loading ? t("inviteGenerator.generating") : invite ? t("inviteGenerator.regenerate") : t("inviteGenerator.generate")}
        </Button>
        <p className="text-sm text-[#71717A]">
          {t("inviteGenerator.linkModeHelp")}
        </p>
      </div>

      {invite ? (
        <div className="space-y-3 rounded-xl border border-[#27272A] bg-[#0A0A0A] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">{t("inviteGenerator.shareLink")}</p>
              <p className="mt-1 text-xs text-[#71717A]">
                {`${usageSummary} · ${expirySummary}`}
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
              {t("inviteGenerator.desktopHandoff")}
            </div>
            <p className="mt-2 break-all text-xs text-[#71717A]">
              {t("inviteGenerator.desktopHandoffHelp", { link: desktopInviteLink })}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
