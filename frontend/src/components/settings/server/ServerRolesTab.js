/*
 * Singra Vox – Server Roles settings tab
 * Create, edit, delete roles with permissions and hoisting.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash } from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export default function ServerRolesTab({ server, roles }) {
  const { t } = useTranslation();
  const [selectedRoleId, setSelectedRoleId] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#6366F1");
  const [newRoleMentionable, setNewRoleMentionable] = useState(false);
  const [roleDraft, setRoleDraft] = useState({ name: "", color: "#6366F1", permissions: {}, mentionable: false, hoist: false });

  const selectedRole = useMemo(
    () => roles?.find((r) => r.id === selectedRoleId) || roles?.[0] || null,
    [roles, selectedRoleId],
  );

  const permissionLabels = useMemo(
    () => ({
      manage_server: t("permissions.manageServer"),
      manage_channels: t("permissions.manageChannels"),
      manage_roles: t("permissions.manageRoles"),
      manage_members: t("permissions.manageMembers"),
      kick_members: t("permissions.kickMembers"),
      ban_members: t("permissions.banMembers"),
      view_channels: t("permissions.viewChannels"),
      read_messages: t("permissions.readMessages"),
      read_message_history: t("permissions.readMessageHistory"),
      send_messages: t("permissions.sendMessages"),
      attach_files: t("permissions.attachFiles"),
      pin_messages: t("permissions.pinMessages"),
      manage_messages: t("permissions.manageMessages"),
      mention_everyone: t("permissions.mentionEveryone"),
      create_invites: t("permissions.createInvites"),
      join_voice: t("permissions.joinVoice"),
      speak: t("permissions.speak"),
      stream: t("permissions.stream"),
      mute_members: t("permissions.muteMembers"),
      deafen_members: t("permissions.deafenMembers"),
      priority_speaker: t("permissions.prioritySpeaker"),
    }),
    [t],
  );

  useEffect(() => {
    if (!selectedRoleId && roles?.length) setSelectedRoleId(roles[0].id);
    else if (selectedRoleId && !roles?.some((r) => r.id === selectedRoleId)) setSelectedRoleId(roles?.[0]?.id || "");
  }, [roles, selectedRoleId]);

  useEffect(() => {
    if (!selectedRole) {
      setRoleDraft({ name: "", color: "#6366F1", permissions: {}, mentionable: false, hoist: false });
      return;
    }
    setRoleDraft({
      name: selectedRole.name || "",
      color: selectedRole.color || "#6366F1",
      permissions: { ...(selectedRole.permissions || {}) },
      mentionable: !!selectedRole.mentionable,
      hoist: !!selectedRole.hoist,
    });
  }, [selectedRole]);

  const createRole = async () => {
    if (!newRoleName.trim()) return;
    try {
      const res = await api.post(`/servers/${server.id}/roles`, {
        name: newRoleName.trim(),
        color: newRoleColor,
        mentionable: newRoleMentionable,
        hoist: false,
      });
      setNewRoleName("");
      setNewRoleMentionable(false);
      setSelectedRoleId(res.data.id);
      toast.success(t("serverSettings.roleCreated"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.roleCreateFailed" }));
    }
  };

  const saveRole = async () => {
    if (!selectedRole) return;
    try {
      const payload = selectedRole.is_default
        ? { permissions: roleDraft.permissions }
        : {
            name: roleDraft.name,
            color: roleDraft.color,
            permissions: roleDraft.permissions,
            mentionable: roleDraft.mentionable,
            hoist: roleDraft.hoist,
          };
      await api.put(`/servers/${server.id}/roles/${selectedRole.id}`, payload);
      toast.success(t("serverSettings.roleUpdated"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.roleUpdateFailed" }));
    }
  };

  const deleteRole = async () => {
    if (!selectedRole || selectedRole.is_default) return;
    try {
      await api.delete(`/servers/${server.id}/roles/${selectedRole.id}`);
      toast.success(t("serverSettings.roleDeleted"));
    } catch (error) {
      toast.error(formatAppError(t, error, { fallbackKey: "serverSettings.roleDeleteFailed" }));
    }
  };

  const togglePermission = (permissionKey) => {
    setRoleDraft((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [permissionKey]: !prev.permissions?.[permissionKey] },
    }));
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]" data-testid="server-settings-roles">
      {/* Role list */}
      <section className="rounded-xl border border-[#27272A] bg-[#121212] p-4">
        <div className="mb-4 flex gap-2">
          <Input
            data-testid="new-role-name-input"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder={t("serverSettings.newRolePlaceholder")}
            className="bg-[#0A0A0A] border-[#27272A] text-white"
          />
          <input
            type="color"
            value={newRoleColor}
            onChange={(e) => setNewRoleColor(e.target.value)}
            className="h-10 w-10 rounded-md border border-[#27272A] bg-[#0A0A0A]"
          />
        </div>
        <div className="mb-4 flex items-center justify-between rounded-lg border border-[#27272A] bg-[#0A0A0A] px-3 py-2.5">
          <div>
            <p className="text-sm text-white">{t("serverSettings.allowRoleMentions")}</p>
            <p className="text-xs text-[#71717A]">{t("serverSettings.allowRoleMentionsHelp")}</p>
          </div>
          <Switch checked={newRoleMentionable} onCheckedChange={setNewRoleMentionable} />
        </div>
        <Button data-testid="create-role-btn" onClick={createRole} disabled={!newRoleName.trim()} className="mb-4 w-full bg-cyan-400 text-zinc-950 hover:bg-cyan-300">
          <Plus size={14} className="mr-2" />
          {t("common.create")} {t("server.roles")}
        </Button>

        <div className="space-y-1">
          {roles?.map((role) => (
            <button
              key={role.id}
              onClick={() => setSelectedRoleId(role.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                selectedRole?.id === role.id ? "bg-[#27272A] text-white" : "text-[#A1A1AA] hover:bg-[#1A1A1A] hover:text-white"
              }`}
            >
              <span className="h-3 w-3 rounded-full" style={{ backgroundColor: role.color }} />
              <span className="truncate">{role.name}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Role editor */}
      <section className="rounded-xl border border-[#27272A] bg-[#121212] p-5">
        {selectedRole ? (
          <>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold" style={{ fontFamily: "Manrope" }}>{t("serverSettings.roleEditor")}</h3>
              {!selectedRole.is_default && (
                <Button onClick={deleteRole} variant="outline" className="border-[#EF4444]/30 bg-transparent text-[#EF4444] hover:bg-[#EF4444]/10">
                  <Trash size={14} className="mr-2" />
                  {t("common.delete")}
                </Button>
              )}
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("server.roles")} {t("common.name")}</Label>
                <Input
                  value={roleDraft.name}
                  onChange={(e) => setRoleDraft((p) => ({ ...p, name: e.target.value }))}
                  disabled={selectedRole.is_default}
                  className="bg-[#0A0A0A] border-[#27272A] text-white"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-[0.2em] text-[#71717A]">{t("common.color")}</Label>
                <input
                  type="color"
                  value={roleDraft.color}
                  onChange={(e) => setRoleDraft((p) => ({ ...p, color: e.target.value }))}
                  disabled={selectedRole.is_default}
                  className="h-10 w-full rounded-md border border-[#27272A] bg-[#0A0A0A]"
                />
              </div>
            </div>

            {selectedRole.is_default ? (
              <div className="mt-4 rounded-lg border border-[#3F3F46] bg-[#0A0A0A] px-4 py-3">
                <p className="text-sm text-white">{t("serverSettings.everyoneFixedTitle")}</p>
                <p className="mt-1 text-xs text-[#71717A]">{t("serverSettings.everyoneFixedHelp")}</p>
              </div>
            ) : (
              <>
                <div className="mt-4 flex items-center justify-between rounded-lg border border-[#27272A] bg-[#0A0A0A] px-4 py-3">
                  <div>
                    <p className="text-sm text-white">{t("serverSettings.allowRoleMentions")}</p>
                    <p className="text-xs text-[#71717A]">{t("serverSettings.allowRoleMentionsHelp")}</p>
                  </div>
                  <Switch
                    checked={!!roleDraft.mentionable}
                    onCheckedChange={(checked) => setRoleDraft((p) => ({ ...p, mentionable: checked }))}
                  />
                </div>

                {/* Role Hoisting */}
                <div className="mt-4 flex items-center justify-between rounded-lg border border-[#27272A] bg-[#0A0A0A] px-4 py-3" data-testid="role-hoist-toggle">
                  <div>
                    <p className="text-sm text-white">{t("serverSettings.hoistRole", { defaultValue: "Separat in Mitgliederliste anzeigen" })}</p>
                    <p className="text-xs text-[#71717A]">{t("serverSettings.hoistRoleHelp", { defaultValue: "Mitglieder mit dieser Rolle werden in einer eigenen Gruppe angezeigt" })}</p>
                  </div>
                  <Switch
                    checked={!!roleDraft.hoist}
                    onCheckedChange={(checked) => setRoleDraft((p) => ({ ...p, hoist: checked }))}
                  />
                </div>
              </>
            )}

            <Button data-testid="save-role-btn" onClick={saveRole} className="mt-5 bg-cyan-400 text-zinc-950 hover:bg-cyan-300">{t("serverSettings.saveRole")}</Button>

            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {Object.entries(permissionLabels).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between rounded-lg border border-[#27272A] bg-[#0A0A0A] px-4 py-3">
                  <span className="text-sm text-white">{label}</span>
                  <Switch
                    checked={!!roleDraft.permissions?.[key]}
                    onCheckedChange={() => togglePermission(key)}
                  />
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-[#71717A]">{t("serverSettings.noRoleSelected")}</p>
        )}
      </section>
    </div>
  );
}
