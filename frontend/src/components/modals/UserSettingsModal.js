import { useState, useEffect } from "react";
import { GearSix, Export, Trash, ShieldCheck, Bell, Clock, Monitor, Globe } from "@phosphor-icons/react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import api from "@/lib/api";
import { toast } from "sonner";
import { requestNotificationPermission, subscribeToPush, getNotificationPreferences, updateNotificationPreferences } from "@/lib/pushNotifications";

export default function UserSettingsModal({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [notifPrefs, setNotifPrefs] = useState({ web_push_enabled: true, desktop_push_enabled: true });
  const [statusHistory, setStatusHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (open) {
      loadNotifPrefs();
      loadStatusHistory();
    }
  }, [open]);

  const loadNotifPrefs = async () => {
    try {
      const prefs = await getNotificationPreferences();
      setNotifPrefs(prefs);
    } catch {}
  };

  const loadStatusHistory = async () => {
    if (!user?.id) return;
    setLoadingHistory(true);
    try {
      const res = await api.get(`/users/${user.id}/status/history`);
      setStatusHistory(res.data || []);
    } catch {
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleTogglePush = async (key, val) => {
    const next = { ...notifPrefs, [key]: val };
    setNotifPrefs(next);
    try {
      await updateNotificationPreferences(next);
      if (val && key === "web_push_enabled") {
        const granted = await requestNotificationPermission();
        if (granted) {
          await subscribeToPush();
        } else {
          toast.error("Notification permission denied");
          setNotifPrefs({ ...next, [key]: false });
        }
      }
    } catch {
      toast.error("Failed to update preferences");
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await api.get("/users/me/export");
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `singravox-export-${user?.username}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Data exported successfully");
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    if (confirmDelete !== user?.username) {
      toast.error("Username doesn't match");
      return;
    }
    setDeleting(true);
    try {
      await api.delete("/users/me");
      toast.success("Account deleted");
      setTimeout(() => onLogout(), 1000);
    } catch {
      toast.error("Deletion failed");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="p-1 rounded hover:bg-[#27272A] text-[#71717A] hover:text-white transition-colors" data-testid="user-settings-button">
          <GearSix size={16} weight="bold" />
        </button>
      </DialogTrigger>
      <DialogContent className="bg-[#18181B] border-[#27272A] text-white max-w-md">
        <DialogHeader>
          <DialogTitle style={{ fontFamily: 'Manrope' }}>Account Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="notifications" className="mt-2">
          <TabsList className="bg-[#121212] border border-[#27272A] w-full justify-start">
            <TabsTrigger value="notifications" className="data-[state=active]:bg-[#27272A] data-[state=active]:text-white text-[#A1A1AA]">
              <Bell size={14} className="mr-1" /> Notifications
            </TabsTrigger>
            <TabsTrigger value="status" className="data-[state=active]:bg-[#27272A] data-[state=active]:text-white text-[#A1A1AA]">
              <Clock size={14} className="mr-1" /> Status
            </TabsTrigger>
            <TabsTrigger value="privacy" className="data-[state=active]:bg-[#27272A] data-[state=active]:text-white text-[#A1A1AA]">
              <ShieldCheck size={14} className="mr-1" /> Privacy
            </TabsTrigger>
          </TabsList>

          <TabsContent value="notifications" className="space-y-4 mt-4">
            <div className="bg-[#121212] border border-[#27272A] rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Globe size={20} className="text-[#6366F1]" />
                  <div>
                    <p className="text-sm font-bold">Browser Push Notifications</p>
                    <p className="text-[10px] text-[#71717A]">Receive notifications even when the app is closed.</p>
                  </div>
                </div>
                <Switch 
                  checked={notifPrefs.web_push_enabled} 
                  onCheckedChange={(v) => handleTogglePush("web_push_enabled", v)} 
                />
              </div>
              
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Monitor size={20} className="text-[#6366F1]" />
                  <div>
                    <p className="text-sm font-bold">Desktop App Notifications</p>
                    <p className="text-[10px] text-[#71717A]">Native notifications when using the desktop application.</p>
                  </div>
                </div>
                <Switch 
                  checked={notifPrefs.desktop_push_enabled} 
                  onCheckedChange={(v) => handleTogglePush("desktop_push_enabled", v)} 
                />
              </div>
            </div>
            <p className="text-[10px] text-[#71717A] px-1 italic">
              Note: Mentions and DMs will always be saved in your In-App Notification Center.
            </p>
          </TabsContent>

          <TabsContent value="status" className="mt-4">
            <div className="bg-[#121212] border border-[#27272A] rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-[#27272A] bg-[#18181B]/50">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[#71717A]">Status History</h4>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {loadingHistory ? (
                  <p className="text-center py-8 text-xs text-[#71717A]">Loading history...</p>
                ) : statusHistory.length === 0 ? (
                  <p className="text-center py-8 text-xs text-[#71717A]">No status history available.</p>
                ) : (
                  <div className="divide-y divide-[#27272A]">
                    {statusHistory.map((h) => (
                      <div key={h.id} className="px-4 py-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${
                            h.status === "online" ? "bg-[#22C55E]" :
                            h.status === "away" ? "bg-[#F59E0B]" :
                            h.status === "dnd" ? "bg-[#EF4444]" : "bg-[#71717A]"
                          }`} />
                          <span className="text-xs font-medium capitalize">{h.status}</span>
                        </div>
                        <span className="text-[10px] text-[#52525B]">
                          {new Date(h.created_at).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="privacy" className="space-y-6 mt-4">
            {/* Data Export */}
            <div className="bg-[#121212] border border-[#27272A] rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Export size={20} className="text-[#6366F1] shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-bold mb-1" style={{ fontFamily: 'Manrope' }}>Export Your Data</h4>
                  <p className="text-xs text-[#71717A] mb-3">
                    Download all your data as JSON: profile, messages, DMs, memberships, files metadata.
                    GDPR Art. 15 / Art. 20.
                  </p>
                  <Button onClick={handleExport} disabled={exporting} data-testid="export-data-button"
                    className="bg-[#6366F1] hover:bg-[#4F46E5] text-sm h-9">
                    {exporting ? "Exporting..." : "Download Export"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Account Deletion */}
            <div className="bg-[#121212] border border-[#EF4444]/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Trash size={20} className="text-[#EF4444] shrink-0 mt-0.5" />
                <div className="flex-1">
                  <h4 className="text-sm font-bold mb-1 text-[#EF4444]" style={{ fontFamily: 'Manrope' }}>Delete Account</h4>
                  <p className="text-xs text-[#71717A] mb-2">
                    Permanently delete your account. This will:
                  </p>
                  <ul className="text-xs text-[#71717A] space-y-1 mb-3 list-disc pl-4">
                    <li>Delete your profile and login</li>
                    <li>Anonymize your channel messages</li>
                    <li>Delete all your DMs</li>
                    <li>Remove you from all servers</li>
                    <li>Delete your E2EE keys and uploaded files</li>
                  </ul>
                  <p className="text-xs text-[#A1A1AA] mb-2">
                    Type <span className="font-mono text-[#EF4444]">{user?.username}</span> to confirm:
                  </p>
                  <input
                    value={confirmDelete} onChange={e => setConfirmDelete(e.target.value)}
                    placeholder="Your username" data-testid="confirm-delete-input"
                    className="w-full bg-[#0A0A0A] border border-[#27272A] rounded px-3 py-1.5 text-sm text-white mb-3 outline-none focus:border-[#EF4444]"
                  />
                  <Button onClick={handleDelete}
                    disabled={deleting || confirmDelete !== user?.username}
                    data-testid="delete-account-button"
                    className="bg-[#EF4444] hover:bg-[#DC2626] text-sm h-9 disabled:opacity-40">
                    {deleting ? "Deleting..." : "Delete Account Permanently"}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
