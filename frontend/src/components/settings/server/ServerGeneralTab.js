/*
 * Singra Vox – Server General settings tab
 * Name, description, ownership transfer, and leave server.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ServerGeneralTab({
  server,
  members,
  user,
  capabilities,
  onRefreshServers,
  onClose,
}) {
  const { t } = useTranslation();
  const [serverName, setServerName] = useState(server?.name || "");
  const [serverDescription, setServerDescription] = useState(server?.description || "");
  const [ownershipTargetId, setOwnershipTargetId] = useState("");
  const [transferringOwnership, setTransferringOwnership] = useState(false);
  const [leavingServer, setLeavingServer] = useState(false);

  const isServerOwner = server?.owner_id === user?.id;
  const transferCandidates = useMemo(
    () => (members || []).filter((m) => m.user_id !== user?.id),
    [members, user?.id],
  );

  useEffect(() => {
    setServerName(server?.name || "");
    setServerDescription(server?.description || "");
  }, [server]);

  const saveGeneral = async () => {
    try {
      await api.put(`/servers/${server.id}`, { name: serverName, description: serverDescription });
      toast.success(t("serverSettings.updated"));
    } catch {
      toast.error(t("serverSettings.updateFailed"));
    }
  };

  const handleTransferOwnership = async () => {
    if (!ownershipTargetId) {
      toast.error(t("serverSettings.transferSelectFirst"));
      return;
    }
    if (!window.confirm(t("serverSettings.transferConfirm"))) return;
    setTransferringOwnership(true);
    try {
      await api.post(`/servers/${server.id}/ownership/transfer`, { user_id: ownershipTargetId });
      toast.success(t("serverSettings.transferSuccess"));
      await onRefreshServers?.();
      onClose?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.transferFailed" }));
    } finally {
      setTransferringOwnership(false);
    }
  };

  const handleLeaveServer = async () => {
    if (isServerOwner) {
      toast.error(t("serverSettings.leaveOwnerGuard"));
      return;
    }
    if (!window.confirm(t("serverSettings.leaveConfirm", { name: server.name }))) return;
    setLeavingServer(true);
    try {
      await api.post(`/servers/${server.id}/leave`);
      toast.success(t("serverSettings.leaveSuccess"));
      await onRefreshServers?.();
      onClose?.();
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.leaveFailed" }));
    } finally {
      setLeavingServer(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="server-settings-general">
      <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
        <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("server.general")}</h3>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("server.serverName")}</Label>
            <Input data-testid="server-name-input" value={serverName} onChange={(e) => setServerName(e.target.value)} className="bg-[#0A0A0A] border-[#27272A] text-white" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("serverSettings.descriptionLabel")}</Label>
            <Input data-testid="server-description-input" value={serverDescription} onChange={(e) => setServerDescription(e.target.value)} className="bg-[#0A0A0A] border-[#27272A] text-white" />
          </div>
        </div>
        <Button data-testid="server-save-general-btn" onClick={saveGeneral} className="mt-5 bg-cyan-400 text-zinc-950 hover:bg-cyan-300">{t("serverSettings.saveChanges")}</Button>
      </section>

      <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("server.ownership")}</h3>
            <p className="mt-1 text-sm text-[#71717A]">{t("serverSettings.ownershipBanner")}</p>
          </div>
          <div className="rounded-full border border-[#27272A] bg-[#0A0A0A] px-3 py-1 text-xs uppercase tracking-[0.2em] text-[#A1A1AA]">
            {isServerOwner ? t("server.owner") : t("server.ownership")}
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("server.transferOwnership")}</Label>
            <select
              value={ownershipTargetId}
              onChange={(e) => setOwnershipTargetId(e.target.value)}
              disabled={!isServerOwner || transferCandidates.length === 0}
              className="h-10 w-full rounded-md border border-[#27272A] bg-[#0A0A0A] px-3 text-sm text-white disabled:opacity-50"
            >
              <option value="">{t("serverSettings.selectMember")}</option>
              {transferCandidates.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.user?.display_name || m.user?.username}
                </option>
              ))}
            </select>
            <p className="text-xs text-[#71717A]">
              {isServerOwner ? t("serverSettings.ownershipHelpOwner") : t("serverSettings.ownershipHelpMember")}
            </p>
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleTransferOwnership}
              disabled={!isServerOwner || !ownershipTargetId || transferringOwnership}
              className="w-full bg-cyan-400 text-zinc-950 hover:bg-cyan-300"
            >
              {transferringOwnership ? t("serverSettings.transferring") : t("server.transferOwnership")}
            </Button>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-[#EF4444]/20 bg-[#0A0A0A] px-4 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium text-white">{t("server.leaveServer")}</p>
              <p className="mt-1 text-xs text-[#71717A]">
                {isServerOwner ? t("serverSettings.leaveOwnerHelp") : t("serverSettings.leaveMemberHelp")}
              </p>
            </div>
            <Button
              onClick={handleLeaveServer}
              disabled={leavingServer}
              variant="outline"
              className="border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10"
            >
              {leavingServer ? t("serverSettings.leaving") : t("server.leaveServer")}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
