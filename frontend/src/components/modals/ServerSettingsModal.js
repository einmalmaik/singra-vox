import { useState, useEffect } from "react";
import { GearSix, Shield, UsersThree, ClipboardText, Plus, Trash, Pencil } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip";
import api from "@/lib/api";
import { toast } from "sonner";

const PERMISSION_LABELS = {
  manage_server: "Manage Server", manage_channels: "Manage Channels", manage_roles: "Manage Roles",
  manage_members: "Manage Members", kick_members: "Kick Members", ban_members: "Ban Members",
  send_messages: "Send Messages", read_messages: "Read Messages", manage_messages: "Manage Messages",
  attach_files: "Attach Files", mention_everyone: "Mention Everyone",
  join_voice: "Join Voice", speak: "Speak", mute_members: "Mute Members",
  deafen_members: "Deafen Members", priority_speaker: "Priority Speaker", create_invites: "Create Invites"
};

export default function ServerSettingsModal({ server, members, roles, onRefresh, user }) {
  const [open, setOpen] = useState(false);
  const [serverName, setServerName] = useState(server?.name || "");
  const [serverDesc, setServerDesc] = useState(server?.description || "");
  const [auditLogs, setAuditLogs] = useState([]);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleColor, setNewRoleColor] = useState("#6366F1");
  const [editingRole, setEditingRole] = useState(null);

  useEffect(() => {
    if (server) {
      setServerName(server.name);
      setServerDesc(server.description || "");
    }
  }, [server]);

  const loadAudit = async () => {
    try {
      const res = await api.get(`/servers/${server.id}/moderation/audit-log`);
      setAuditLogs(res.data);
    } catch {}
  };

  const saveServer = async () => {
    try {
      await api.put(`/servers/${server.id}`, { name: serverName, description: serverDesc });
      toast.success("Server updated");
      onRefresh();
    } catch {
      toast.error("Failed to update server");
    }
  };

  const createRole = async () => {
    if (!newRoleName.trim()) return;
    try {
      await api.post(`/servers/${server.id}/roles`, { name: newRoleName.trim(), color: newRoleColor });
      toast.success("Role created");
      setNewRoleName("");
      onRefresh();
    } catch {
      toast.error("Failed to create role");
    }
  };

  const deleteRole = async (roleId) => {
    try {
      await api.delete(`/servers/${server.id}/roles/${roleId}`);
      toast.success("Role deleted");
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed");
    }
  };

  const togglePermission = async (role, perm) => {
    const newPerms = { ...role.permissions, [perm]: !role.permissions[perm] };
    try {
      await api.put(`/servers/${server.id}/roles/${role.id}`, { permissions: newPerms });
      onRefresh();
    } catch {
      toast.error("Failed");
    }
  };

  const assignRole = async (userId, roleId) => {
    const member = members.find(m => m.user_id === userId);
    if (!member) return;
    const currentRoles = member.roles || [];
    const newRoles = currentRoles.includes(roleId)
      ? currentRoles.filter(r => r !== roleId)
      : [...currentRoles, roleId];
    try {
      await api.put(`/servers/${server.id}/members/${userId}`, { roles: newRoles });
      toast.success("Roles updated");
      onRefresh();
    } catch {
      toast.error("Failed");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) loadAudit(); }}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <button className="p-1 rounded hover:bg-[#27272A] text-[#71717A] hover:text-white transition-colors" data-testid="server-settings-button">
                <GearSix size={16} weight="bold" />
              </button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom"><p>Server Settings</p></TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DialogContent className="bg-[#18181B] border-[#27272A] text-white max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: 'Manrope' }}>Server Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="general" className="mt-2">
          <TabsList className="bg-[#121212] border border-[#27272A]">
            <TabsTrigger value="general" className="data-[state=active]:bg-[#27272A] data-[state=active]:text-white text-[#A1A1AA]" data-testid="settings-tab-general">
              <GearSix size={14} className="mr-1" /> General
            </TabsTrigger>
            <TabsTrigger value="roles" className="data-[state=active]:bg-[#27272A] data-[state=active]:text-white text-[#A1A1AA]" data-testid="settings-tab-roles">
              <Shield size={14} className="mr-1" /> Roles
            </TabsTrigger>
            <TabsTrigger value="members" className="data-[state=active]:bg-[#27272A] data-[state=active]:text-white text-[#A1A1AA]" data-testid="settings-tab-members">
              <UsersThree size={14} className="mr-1" /> Members
            </TabsTrigger>
            <TabsTrigger value="audit" className="data-[state=active]:bg-[#27272A] data-[state=active]:text-white text-[#A1A1AA]" data-testid="settings-tab-audit">
              <ClipboardText size={14} className="mr-1" /> Audit
            </TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Server Name</Label>
              <Input value={serverName} onChange={e => setServerName(e.target.value)} data-testid="settings-server-name"
                className="bg-[#121212] border-[#27272A] text-white" />
            </div>
            <div className="space-y-2">
              <Label className="text-[#A1A1AA] text-xs font-bold uppercase tracking-[0.2em]">Description</Label>
              <Input value={serverDesc} onChange={e => setServerDesc(e.target.value)} data-testid="settings-server-desc"
                className="bg-[#121212] border-[#27272A] text-white" />
            </div>
            <Button onClick={saveServer} data-testid="save-server-settings" className="bg-[#6366F1] hover:bg-[#4F46E5]">
              Save Changes
            </Button>
          </TabsContent>

          <TabsContent value="roles" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              {/* Create role */}
              <div className="flex gap-2 mb-4">
                <Input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="Role name" data-testid="new-role-name"
                  className="bg-[#121212] border-[#27272A] text-white flex-1" />
                <input type="color" value={newRoleColor} onChange={e => setNewRoleColor(e.target.value)}
                  className="w-10 h-10 rounded bg-transparent cursor-pointer" data-testid="new-role-color" />
                <Button onClick={createRole} disabled={!newRoleName.trim()} data-testid="create-role-button"
                  className="bg-[#6366F1] hover:bg-[#4F46E5]">
                  <Plus size={14} className="mr-1" /> Add
                </Button>
              </div>

              {/* Role list */}
              {roles?.map(role => (
                <div key={role.id} className="mb-4 bg-[#121212] border border-[#27272A] rounded-lg p-3">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: role.color }} />
                      <span className="text-sm font-semibold" style={{ color: role.color }}>{role.name}</span>
                      {role.is_default && <span className="text-[10px] text-[#71717A] bg-[#27272A] px-1.5 py-0.5 rounded">Default</span>}
                    </div>
                    {!role.is_default && (
                      <button onClick={() => deleteRole(role.id)} data-testid={`delete-role-${role.name}`}
                        className="text-[#EF4444] hover:text-[#DC2626] transition-colors">
                        <Trash size={14} />
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
                      <div key={key} className="flex items-center justify-between bg-[#0A0A0A] rounded px-2 py-1.5">
                        <span className="text-xs text-[#A1A1AA]">{label}</span>
                        <Switch
                          checked={role.permissions?.[key] || false}
                          onCheckedChange={() => togglePermission(role, key)}
                          data-testid={`perm-${role.name}-${key}`}
                          className="scale-75"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="members" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              {members?.map(member => (
                <div key={member.user_id} className="flex items-center justify-between py-2 border-b border-[#27272A]/50">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#27272A] flex items-center justify-center text-sm font-bold">
                      {member.user?.display_name?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{member.user?.display_name}</p>
                      <p className="text-xs text-[#71717A]">@{member.user?.username}</p>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {roles?.filter(r => !r.is_default).map(role => (
                      <button
                        key={role.id}
                        onClick={() => assignRole(member.user_id, role.id)}
                        data-testid={`assign-role-${member.user?.username}-${role.name}`}
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                          member.roles?.includes(role.id)
                            ? 'border-current opacity-100' : 'border-[#27272A] opacity-40 hover:opacity-70'
                        }`}
                        style={{ color: role.color }}
                      >
                        {role.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </ScrollArea>
          </TabsContent>

          <TabsContent value="audit" className="mt-4">
            <ScrollArea className="h-[400px] pr-4">
              {auditLogs.length === 0 ? (
                <p className="text-[#71717A] text-sm text-center py-8">No audit log entries yet.</p>
              ) : (
                auditLogs.map(log => (
                  <div key={log.id} className="flex items-start gap-3 py-2 border-b border-[#27272A]/50" data-testid={`audit-log-${log.id}`}>
                    <div className="w-7 h-7 rounded-full bg-[#27272A] flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                      {log.actor?.display_name?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="text-sm">
                        <span className="font-semibold">{log.actor?.display_name || 'System'}</span>
                        {' '}<span className="text-[#A1A1AA]">{log.action.replace(/_/g, ' ')}</span>
                      </p>
                      <p className="text-[10px] text-[#52525B]">{new Date(log.created_at).toLocaleString()}</p>
                    </div>
                  </div>
                ))
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
