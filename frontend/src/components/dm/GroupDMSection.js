/*
 * Singra Vox – Group DM Section
 *
 * Zeigt die Liste der Gruppen-DMs in der DM-Sidebar an.
 * Ermöglicht das Erstellen neuer Gruppen-DMs.
 *
 * Props:
 *   - groups: Array der Gruppen-DMs
 *   - selectedGroupId: Aktuell ausgewählte Gruppe
 *   - onSelectGroup: Callback wenn eine Gruppe ausgewählt wird
 *   - onGroupsChanged: Callback nach Erstellen/Löschen
 *   - resolveAssetUrl: Asset-URL Resolver
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, UsersThree, X } from "@phosphor-icons/react";
import { toast } from "sonner";
import api from "@/lib/api";
import { formatAppError } from "@/lib/appErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function GroupDMSection({
  groups = [],
  selectedGroupId,
  onSelectGroup,
  onGroupsChanged,
  resolveAssetUrl,
}) {
  const { t } = useTranslation();
  const [createOpen, setCreateOpen] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [memberSearch, setMemberSearch] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [creating, setCreating] = useState(false);

  // Mitglieder suchen (Debounce im Parent oder hier)
  const searchUsers = useCallback(async (query) => {
    if (query.length < 2) { setSearchResults([]); return; }
    try {
      const res = await api.get(`/users/search?q=${encodeURIComponent(query)}`);
      setSearchResults(res.data || []);
    } catch {
      setSearchResults([]);
    }
  }, []);

  const addMember = (user) => {
    if (selectedMembers.some((m) => m.id === user.id)) return;
    setSelectedMembers((prev) => [...prev, user]);
    setMemberSearch("");
    setSearchResults([]);
  };

  const removeMember = (userId) => {
    setSelectedMembers((prev) => prev.filter((m) => m.id !== userId));
  };

  const createGroup = async () => {
    if (selectedMembers.length < 1) {
      toast.error("Mindestens ein Mitglied erforderlich");
      return;
    }
    setCreating(true);
    try {
      await api.post("/groups", {
        name: groupName.trim() || undefined,
        member_ids: selectedMembers.map((m) => m.id),
      });
      toast.success("Gruppen-DM erstellt");
      setCreateOpen(false);
      setGroupName("");
      setSelectedMembers([]);
      onGroupsChanged?.();
    } catch (err) {
      toast.error(formatAppError(t, err, { fallbackKey: "dm.groupCreateFailed" }));
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
          Gruppen-DMs
        </p>
        <button
          onClick={() => setCreateOpen(true)}
          className="rounded-lg p-1 text-zinc-500 transition-colors hover:bg-white/5 hover:text-zinc-300"
          data-testid="create-group-dm-btn"
          title="Neue Gruppen-DM"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Gruppen-Liste */}
      <div className="space-y-0.5 px-3" data-testid="group-dm-list">
        {groups.map((group) => {
          const memberNames = (group.members || [])
            .slice(0, 3)
            .map((m) => m.display_name || m.username)
            .join(", ");
          const displayName = group.name || memberNames || "Gruppe";

          return (
            <button
              key={group.id}
              onClick={() => onSelectGroup?.(group)}
              data-testid={`group-dm-${group.id}`}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                selectedGroupId === group.id
                  ? "bg-cyan-500/12 text-white"
                  : "text-[#A1A1AA] hover:bg-white/5 hover:text-white"
              }`}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-800/80">
                <UsersThree size={16} className="text-zinc-400" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName}</p>
                <p className="truncate text-xs text-zinc-500">
                  {(group.members || []).length} Mitglieder
                </p>
              </div>
              {group.unread_count > 0 && (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-[10px] font-bold text-zinc-950">
                  {group.unread_count > 9 ? "9+" : group.unread_count}
                </span>
              )}
            </button>
          );
        })}

        {groups.length === 0 && (
          <p className="py-3 text-center text-xs text-zinc-600">
            Noch keine Gruppen-DMs
          </p>
        )}
      </div>

      {/* Erstellen-Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="workspace-panel-solid max-w-md text-white">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: "Manrope" }}>
              Neue Gruppen-DM
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
                Gruppenname (optional)
              </label>
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="z.B. Projektteam"
                className="bg-zinc-950/70 border-white/10 text-white"
                data-testid="group-dm-name-input"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-[0.15em] text-zinc-500">
                Mitglieder hinzufügen
              </label>
              <Input
                value={memberSearch}
                onChange={(e) => {
                  setMemberSearch(e.target.value);
                  searchUsers(e.target.value);
                }}
                placeholder="Nutzer suchen..."
                className="bg-zinc-950/70 border-white/10 text-white"
                data-testid="group-dm-member-search"
              />

              {/* Suchergebnisse */}
              {searchResults.length > 0 && (
                <div className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-white/8 bg-zinc-950/80 p-1">
                  {searchResults
                    .filter((u) => !selectedMembers.some((m) => m.id === u.id))
                    .map((u) => (
                      <button
                        key={u.id}
                        onClick={() => addMember(u)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-zinc-300 transition-colors hover:bg-white/5"
                      >
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-[10px] font-bold">
                          {u.display_name?.[0]?.toUpperCase() || "?"}
                        </div>
                        <span className="truncate">{u.display_name || u.username}</span>
                        <span className="ml-auto text-xs text-zinc-600">@{u.username}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>

            {/* Ausgewählte Mitglieder */}
            {selectedMembers.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {selectedMembers.map((m) => (
                  <span
                    key={m.id}
                    className="flex items-center gap-1.5 rounded-full border border-white/10 bg-zinc-900/70 px-3 py-1 text-xs text-zinc-300"
                  >
                    {m.display_name || m.username}
                    <button
                      onClick={() => removeMember(m.id)}
                      className="text-zinc-500 transition-colors hover:text-white"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setCreateOpen(false)}
                className="rounded-xl border-white/10 bg-transparent text-zinc-300 hover:bg-white/5"
              >
                Abbrechen
              </Button>
              <Button
                onClick={createGroup}
                disabled={creating || selectedMembers.length < 1}
                className="rounded-xl bg-cyan-400 text-zinc-950 hover:bg-cyan-300"
                data-testid="group-dm-create-submit"
              >
                {creating ? "Erstelle..." : "Erstellen"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
