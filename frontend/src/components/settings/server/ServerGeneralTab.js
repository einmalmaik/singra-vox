/*
 * Singra Vox – Server General settings tab
 * Name, description, ownership transfer, and leave server.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Gear, Crown, SignOut } from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { SETTINGS_INPUT_CLASSNAME, SETTINGS_NATIVE_SELECT_CLASSNAME } from "@/components/settings/settingsConstants";
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
    <div className="space-y-8" data-testid="server-settings-general">
      {/* Server Info */}
      <section className="workspace-card p-6">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-500/15">
            <Gear size={22} className="text-cyan-300" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white" style={{ fontFamily: "Manrope" }}>
              {t("server.general")}
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              {t("serverSettings.generalHelp")}
            </p>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2.5">
            <Label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
              {t("server.serverName")}
            </Label>
            <Input
              data-testid="server-name-input"
              value={serverName}
              onChange={(e) => setServerName(e.target.value)}
              className={SETTINGS_INPUT_CLASSNAME}
            />
          </div>
          <div className="space-y-2.5">
            <Label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
              {t("serverSettings.descriptionLabel")}
            </Label>
            <Input
              data-testid="server-description-input"
              value={serverDescription}
              onChange={(e) => setServerDescription(e.target.value)}
              className={SETTINGS_INPUT_CLASSNAME}
            />
          </div>
        </div>

        <Button
          data-testid="server-save-general-btn"
          onClick={saveGeneral}
          className="mt-6 h-11 rounded-2xl bg-cyan-400 px-8 text-zinc-950 font-semibold hover:bg-cyan-300 transition-colors"
        >
          {t("serverSettings.saveChanges")}
        </Button>
      </section>

      {/* Ownership */}
      <section className="workspace-card p-6">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15">
            <Crown size={22} className="text-amber-300" />
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white" style={{ fontFamily: "Manrope" }}>
                  {t("server.ownership")}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">{t("serverSettings.ownershipBanner")}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-zinc-950/60 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.15em] text-zinc-400">
                {isServerOwner ? t("server.owner") : t("server.ownership")}
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-2.5">
            <Label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
              {t("server.transferOwnership")}
            </Label>
            <select
              value={ownershipTargetId}
              onChange={(e) => setOwnershipTargetId(e.target.value)}
              disabled={!isServerOwner || transferCandidates.length === 0}
              className={SETTINGS_NATIVE_SELECT_CLASSNAME}
              data-testid="transfer-ownership-select"
            >
              <option value="">{t("serverSettings.selectMember")}</option>
              {transferCandidates.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.user?.display_name || m.user?.username}
                </option>
              ))}
            </select>
            <p className="text-xs text-zinc-500 leading-relaxed">
              {isServerOwner ? t("serverSettings.ownershipHelpOwner") : t("serverSettings.ownershipHelpMember")}
            </p>
          </div>
          <div className="flex items-end">
            <Button
              onClick={handleTransferOwnership}
              disabled={!isServerOwner || !ownershipTargetId || transferringOwnership}
              className="w-full h-12 rounded-2xl bg-cyan-400 text-zinc-950 font-semibold hover:bg-cyan-300 transition-colors"
              data-testid="transfer-ownership-btn"
            >
              {transferringOwnership ? t("serverSettings.transferring") : t("server.transferOwnership")}
            </Button>
          </div>
        </div>
      </section>

      {/* Danger Zone */}
      <section className="workspace-card border-red-500/15 bg-red-500/[0.03] p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-red-500/15">
            <SignOut size={22} className="text-red-400" />
          </div>
          <div className="flex-1">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-base font-bold text-white" style={{ fontFamily: "Manrope" }}>
                  {t("server.leaveServer")}
                </h3>
                <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
                  {isServerOwner ? t("serverSettings.leaveOwnerHelp") : t("serverSettings.leaveMemberHelp")}
                </p>
              </div>
              <Button
                onClick={handleLeaveServer}
                disabled={leavingServer}
                variant="outline"
                className="h-11 rounded-2xl border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 px-6 transition-colors shrink-0"
                data-testid="leave-server-btn"
              >
                {leavingServer ? t("serverSettings.leaving") : t("server.leaveServer")}
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
