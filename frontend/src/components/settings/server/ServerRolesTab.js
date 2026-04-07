/*
 * Singra Vox – Server Roles settings tab
 * Create, edit, delete roles with permissions and hoisting.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Trash, ShieldCheck } from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { SETTINGS_INPUT_CLASSNAME } from "@/components/settings/settingsConstants";
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
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]" data-testid="server-settings-roles">
      {/* Role list */}
      <section className="workspace-card p-6">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500 mb-5">
          {t("server.roles")}
        </p>

        {/* Create form */}
        <div className="space-y-3 mb-5">
          <div className="flex gap-3">
            <Input
              data-testid="new-role-name-input"
              value={newRoleName}
              onChange={(e) => setNewRoleName(e.target.value)}
              placeholder={t("serverSettings.newRolePlaceholder")}
              className={SETTINGS_INPUT_CLASSNAME + " flex-1"}
            />
            <input
              type="color"
              value={newRoleColor}
              onChange={(e) => setNewRoleColor(e.target.value)}
              className="h-12 w-12 shrink-0 rounded-2xl border border-white/10 bg-zinc-950/70 cursor-pointer"
              data-testid="new-role-color-input"
            />
          </div>

          <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-zinc-950/60 px-4 py-3.5">
            <div>
              <p className="text-sm font-medium text-white">{t("serverSettings.allowRoleMentions")}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{t("serverSettings.allowRoleMentionsHelp")}</p>
            </div>
            <Switch checked={newRoleMentionable} onCheckedChange={setNewRoleMentionable} />
          </div>

          <Button
            data-testid="create-role-btn"
            onClick={createRole}
            disabled={!newRoleName.trim()}
            className="w-full h-11 rounded-2xl bg-cyan-400 text-zinc-950 font-semibold hover:bg-cyan-300 transition-colors"
          >
            <Plus size={15} className="mr-2" />
            {t("common.create")} {t("server.roles")}
          </Button>
        </div>

        {/* Role list */}
        <div className="space-y-1.5">
          {roles?.map((role) => {
            const isSelected = selectedRole?.id === role.id;
            return (
              <button
                key={role.id}
                onClick={() => setSelectedRoleId(role.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition-all ${
                  isSelected
                    ? "bg-white/8 text-white shadow-[0_0_12px_rgba(34,211,238,0.06)]"
                    : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }`}
                data-testid={`role-item-${role.id}`}
              >
                <span className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-white/10" style={{ backgroundColor: role.color }} />
                <span className="truncate">{role.name}</span>
                {role.is_default && (
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-zinc-600">default</span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      {/* Role editor */}
      <section className="workspace-card p-6">
        {selectedRole ? (
          <>
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex items-start gap-4">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: `${selectedRole.color}22` }}>
                  <ShieldCheck size={22} style={{ color: selectedRole.color }} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white" style={{ fontFamily: "Manrope" }}>
                    {t("serverSettings.roleEditor")}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500">{selectedRole.name}</p>
                </div>
              </div>
              {!selectedRole.is_default && (
                <Button
                  onClick={deleteRole}
                  variant="outline"
                  className="h-10 rounded-2xl border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 px-5 transition-colors"
                  data-testid="delete-role-btn"
                >
                  <Trash size={15} className="mr-2" />
                  {t("common.delete")}
                </Button>
              )}
            </div>

            <div className="grid gap-5 md:grid-cols-3">
              <div className="space-y-2.5 md:col-span-2">
                <Label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
                  {t("server.roles")} {t("common.name")}
                </Label>
                <Input
                  value={roleDraft.name}
                  onChange={(e) => setRoleDraft((p) => ({ ...p, name: e.target.value }))}
                  disabled={selectedRole.is_default}
                  className={SETTINGS_INPUT_CLASSNAME}
                  data-testid="edit-role-name-input"
                />
              </div>
              <div className="space-y-2.5">
                <Label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">{t("common.color")}</Label>
                <input
                  type="color"
                  value={roleDraft.color}
                  onChange={(e) => setRoleDraft((p) => ({ ...p, color: e.target.value }))}
                  disabled={selectedRole.is_default}
                  className="h-12 w-full rounded-2xl border border-white/10 bg-zinc-950/70 cursor-pointer disabled:opacity-50"
                  data-testid="edit-role-color-input"
                />
              </div>
            </div>

            {selectedRole.is_default ? (
              <div className="mt-5 rounded-2xl border border-white/8 bg-zinc-950/60 px-5 py-4">
                <p className="text-sm font-medium text-white">{t("serverSettings.everyoneFixedTitle")}</p>
                <p className="mt-1.5 text-xs text-zinc-500 leading-relaxed">{t("serverSettings.everyoneFixedHelp")}</p>
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-zinc-950/60 px-5 py-4">
                  <div>
                    <p className="text-sm font-medium text-white">{t("serverSettings.allowRoleMentions")}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{t("serverSettings.allowRoleMentionsHelp")}</p>
                  </div>
                  <Switch
                    checked={!!roleDraft.mentionable}
                    onCheckedChange={(checked) => setRoleDraft((p) => ({ ...p, mentionable: checked }))}
                  />
                </div>

                {/* Role Hoisting */}
                <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-zinc-950/60 px-5 py-4" data-testid="role-hoist-toggle">
                  <div>
                    <p className="text-sm font-medium text-white">{t("serverSettings.hoistRole", { defaultValue: "Separat in Mitgliederliste anzeigen" })}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{t("serverSettings.hoistRoleHelp", { defaultValue: "Mitglieder mit dieser Rolle werden in einer eigenen Gruppe angezeigt" })}</p>
                  </div>
                  <Switch
                    checked={!!roleDraft.hoist}
                    onCheckedChange={(checked) => setRoleDraft((p) => ({ ...p, hoist: checked }))}
                  />
                </div>
              </div>
            )}

            <Button
              data-testid="save-role-btn"
              onClick={saveRole}
              className="mt-6 h-11 rounded-2xl bg-cyan-400 px-8 text-zinc-950 font-semibold hover:bg-cyan-300 transition-colors"
            >
              {t("serverSettings.saveRole")}
            </Button>

            {/* Permissions grid */}
            <div className="mt-8">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500 mb-4">
                {t("serverSettings.permissionsTitle", { defaultValue: "Berechtigungen" })}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {Object.entries(permissionLabels).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between rounded-2xl border border-white/10 bg-zinc-950/60 px-5 py-3.5">
                    <span className="text-sm text-white">{label}</span>
                    <Switch
                      checked={!!roleDraft.permissions?.[key]}
                      onCheckedChange={() => togglePermission(key)}
                      data-testid={`perm-toggle-${key}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-60">
            <p className="text-sm text-zinc-600">{t("serverSettings.noRoleSelected")}</p>
          </div>
        )}
      </section>
    </div>
  );
}
