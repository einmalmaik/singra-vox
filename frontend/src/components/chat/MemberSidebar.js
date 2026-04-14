/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

/**
 * MemberSidebar – Zeigt die Mitgliederliste mit Role Hoisting.
 *
 * Mitglieder werden nach ihrer höchsten "gehoisteten" Rolle gruppiert
 * (wie bei Discord). Rollen mit `hoist: true` erscheinen als eigene
 * Sektionen, sortiert nach Position (höchste zuerst). Mitglieder ohne
 * gehoistete Rolle landen in "Online" bzw. "Offline".
 *
 * Architektur:
 *   - `groupMembersByRole()` ist eine pure Funktion (testbar, wiederverwendbar)
 *   - `MemberItem` ist eine eigenständige Komponente (wiederverwendbar)
 *   - Alle Texte über i18n
 */
import { useMemo, useState, useEffect } from "react";
import { Crown, ChatCircle, UserMinus, Prohibit, Timer, MagnifyingGlass, GameController, Code, MusicNotes, Monitor, Dot } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import api from "@/lib/api";
import { toast } from "sonner";
import { formatAppError } from "@/lib/appErrors";
import { buildServerCapabilities } from "@/lib/serverPermissions";
import { useRuntime } from "@/contexts/RuntimeContext";
import { resolveAssetUrl } from "@/lib/assetUrls";

// ── Status-Utilities ────────────────────────────────────────────────────────

const ACTIVE_STATUSES = new Set(["online", "away", "dnd"]);

// Aktivitäts-Icons nach Typ
const ACTIVITY_ICONS = {
  playing:   GameController,
  coding:    Code,
  listening: MusicNotes,
  streaming: Monitor,
  custom:    Dot,
};

function isActiveStatus(status) {
  return ACTIVE_STATUSES.has(status);
}

function statusIndicatorClass(status) {
  switch (status) {
    case "online": return "status-online";
    case "away":   return "status-away";
    case "dnd":    return "status-dnd";
    default:       return "status-offline";
  }
}

// ── Role Hoisting Logic ─────────────────────────────────────────────────────
// Pure Funktion: Gruppiert Members nach ihrer höchsten gehoisteten Rolle.
// Rückgabe: Array von { role, members } Objekten + "online" + "offline" Gruppen.

export function groupMembersByRole(members, roles) {
  // Gehoistete Rollen nach Position sortieren (höchste zuerst)
  const hoistedRoles = (roles || [])
    .filter((r) => r.hoist && !r.is_default)
    .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

  // Lookup: roleId → role (für schnellen Zugriff)
  const roleById = new Map((roles || []).map((r) => [r.id, r]));

  // Gruppen initialisieren
  const groups = new Map();
  for (const role of hoistedRoles) {
    groups.set(role.id, { role, members: [] });
  }

  const onlineUngrouped = [];
  const offlineMembers = [];

  for (const member of members) {
    const status = member.user?.status || "offline";
    const isActive = isActiveStatus(status);

    if (!isActive) {
      offlineMembers.push(member);
      continue;
    }

    // Höchste gehoistete Rolle finden
    let placed = false;
    if (member.roles?.length) {
      // Member-Rollen nach Position sortieren (höchste zuerst)
      const memberRolesSorted = member.roles
        .map((rid) => roleById.get(rid))
        .filter(Boolean)
        .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));

      for (const role of memberRolesSorted) {
        if (groups.has(role.id)) {
          groups.get(role.id).members.push(member);
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      onlineUngrouped.push(member);
    }
  }

  // Ergebnis zusammenbauen: Gehoistete Gruppen (nur mit Members) + Online + Offline
  const result = [];
  for (const group of groups.values()) {
    if (group.members.length > 0) {
      result.push({
        key: `role-${group.role.id}`,
        label: group.role.name,
        color: group.role.color,
        members: group.members,
      });
    }
  }
  if (onlineUngrouped.length > 0) {
    result.push({
      key: "online",
      label: null, // Wird via i18n gesetzt
      color: null,
      members: onlineUngrouped,
    });
  }
  if (offlineMembers.length > 0) {
    result.push({
      key: "offline",
      label: null,
      color: null,
      members: offlineMembers,
    });
  }
  return result;
}

// ── MemberItem Komponente ───────────────────────────────────────────────────

function MemberItem({ member, roles, server, user, capabilities, config, activities, onStartDM, onKick, onBan, onMute, t }) {
  const memberStatus = member.user?.status || "offline";
  const isActive = isActiveStatus(memberStatus);
  const isSelf = member.user?.id === user?.id;
  const isServerOwner = server?.owner_id === member.user?.id;
  const canModerate = capabilities.canMuteMembers || capabilities.canKickMembers || capabilities.canBanMembers;

  // Rich Presence: Aktivität des Members finden
  const activity = activities?.find((a) => a.user_id === member.user?.id);
  const activityIcon = activity ? ACTIVITY_ICONS[activity.type] || ACTIVITY_ICONS.custom : null;

  const roleColor = useMemo(() => {
    if (!member.roles?.length || !roles?.length) return "#A1A1AA";
    const memberRolesSorted = member.roles
      .map((rid) => roles.find((r) => r.id === rid))
      .filter(Boolean)
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
    return memberRolesSorted[0]?.color || "#A1A1AA";
  }, [member.roles, roles]);

  const isAdmin = server?.owner_id === member.user?.id || member.roles?.some((rid) => {
    const r = roles?.find((role) => role.id === rid);
    return r?.permissions?.manage_server;
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-white/5 transition-colors text-left group"
          data-testid={`member-${member.user?.username}`}
        >
          <div className="relative">
            <div className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-xs font-bold ${
              isActive ? "bg-zinc-800/85" : "bg-zinc-800/45"
            }`} style={{ color: roleColor }}>
              {member.user?.avatar_url ? (
                <img src={resolveAssetUrl(member.user.avatar_url, config?.assetBase)} alt="" className="h-full w-full object-cover" />
              ) : (
                member.user?.display_name?.[0]?.toUpperCase() || "?"
              )}
            </div>
            <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#121212] ${
              statusIndicatorClass(memberStatus)
            }`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <span className={`text-sm truncate ${isActive ? "text-white" : "text-[#71717A]"}`}
                style={{ color: isActive ? roleColor : undefined }}>
                {member.user?.display_name || member.user?.username}
              </span>
              {isAdmin && <Crown size={12} weight="fill" className="text-[#F59E0B] shrink-0" />}
            </div>
            {/* Rich Presence Aktivität */}
            {activity && activityIcon && (
              <div className="flex items-center gap-1 mt-0.5" data-testid={`activity-${member.user?.username}`}>
                {(() => { const Icon = activityIcon; return <Icon size={10} weight="fill" className="text-zinc-500 shrink-0" />; })()}
                <span className="text-[10px] text-zinc-500 truncate">{activity.name}</span>
              </div>
            )}
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="workspace-panel-solid text-white w-48">
        <div className="px-3 py-2 border-b border-[#27272A]">
          <p className="text-sm font-semibold" style={{ color: roleColor }}>
            {member.user?.display_name}
          </p>
          <p className="text-xs text-[#71717A]">@{member.user?.username}</p>
        </div>
        {!isSelf && (
          <>
            <DropdownMenuItem onClick={() => onStartDM(member.user)} className="cursor-pointer text-[#A1A1AA] focus:text-white focus:bg-[#27272A]"
              data-testid={`dm-member-${member.user?.username}`}>
              <ChatCircle size={16} className="mr-2" /> {t("memberList.message")}
            </DropdownMenuItem>
            {canModerate && <DropdownMenuSeparator className="bg-[#27272A]" />}
            {capabilities.canMuteMembers && (
              <DropdownMenuItem onClick={() => onMute(member.user?.id)} className="cursor-pointer text-[#F59E0B] focus:text-[#F59E0B] focus:bg-[#27272A]"
                data-testid={`mute-member-${member.user?.username}`}>
                <Timer size={16} className="mr-2" /> {t("memberList.mute")}
              </DropdownMenuItem>
            )}
            {capabilities.canKickMembers && !isServerOwner && (
              <DropdownMenuItem onClick={() => onKick(member.user?.id)} className="cursor-pointer text-[#EF4444] focus:text-[#EF4444] focus:bg-[#27272A]"
                data-testid={`kick-member-${member.user?.username}`}>
                <UserMinus size={16} className="mr-2" /> {t("memberList.kick")}
              </DropdownMenuItem>
            )}
            {capabilities.canBanMembers && !isServerOwner && (
              <DropdownMenuItem onClick={() => onBan(member.user?.id)} className="cursor-pointer text-[#EF4444] focus:text-[#EF4444] focus:bg-[#27272A]"
                data-testid={`ban-member-${member.user?.username}`}>
                <Prohibit size={16} className="mr-2" /> {t("memberList.ban")}
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Hauptkomponente ─────────────────────────────────────────────────────────

export default function MemberSidebar({ members, roles, serverId, server, user, viewerContext, onStartDM, onRefreshMembers }) {
  const { t } = useTranslation();
  const { config } = useRuntime();
  const [searchQuery, setSearchQuery] = useState("");
  const [activities, setActivities] = useState([]);
  const capabilities = buildServerCapabilities({ user, server, viewerContext });

  // Rich Presence: Aktivitäten für diesen Server laden
  useEffect(() => {
    if (!serverId) return undefined;
    let cancelled = false;

    const fetchActivities = async () => {
      try {
        const res = await api.get(`/presence/server/${serverId}`);
        if (!cancelled) setActivities(res.data.activities || []);
      } catch {
        // Leise fehlschlagen – Presence ist nicht kritisch
      }
    };

    fetchActivities();
    // Alle 20s aktualisieren (etwas langsamer als das Sende-Intervall)
    const interval = setInterval(fetchActivities, 20_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [serverId]);

  // Member-Suche: Name oder Username
  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const q = searchQuery.toLowerCase();
    return members.filter((m) => {
      const name = (m.user?.display_name || "").toLowerCase();
      const uname = (m.user?.username || "").toLowerCase();
      return name.includes(q) || uname.includes(q);
    });
  }, [members, searchQuery]);

  // Role Hoisting: Gruppierung nach höchster gehoisteter Rolle
  const groups = useMemo(
    () => groupMembersByRole(filteredMembers, roles),
    [filteredMembers, roles],
  );

  const handleKick = async (userId) => {
    try {
      await api.delete(`/servers/${serverId}/members/${userId}`);
      toast.success(t("memberList.kicked"));
      onRefreshMembers();
    } catch (err) {
      toast.error(formatAppError(t, err, { fallbackKey: "serverSettings.memberActionGenericFailed" }));
    }
  };

  const handleBan = async (userId) => {
    try {
      await api.post(`/servers/${serverId}/moderation/ban`, { user_id: userId, reason: t("serverSettings.defaultBanReason") });
      toast.success(t("memberList.banned"));
      onRefreshMembers();
    } catch (err) {
      toast.error(formatAppError(t, err, { fallbackKey: "serverSettings.memberActionGenericFailed" }));
    }
  };

  const handleMute = async (userId) => {
    try {
      await api.post(`/servers/${serverId}/moderation/mute`, { user_id: userId, duration_minutes: 10 });
      toast.success(t("memberList.muted"));
    } catch (err) {
      toast.error(formatAppError(t, err, { fallbackKey: "serverSettings.memberActionGenericFailed" }));
    }
  };

  return (
    <div className="workspace-panel w-[240px] h-full min-h-0 flex flex-col shrink-0 overflow-hidden" data-testid="member-sidebar">
      {/* Header mit Suche */}
      <div className="shrink-0 border-b workspace-divider bg-zinc-900/25">
        <div className="h-14 flex items-center px-4">
          <h3 className="text-sm font-bold text-white" style={{ fontFamily: "Manrope" }}>
            {t("server.members")}
          </h3>
          <span className="ml-auto text-xs text-zinc-500">{members.length}</span>
        </div>
        <div className="px-3 pb-3">
          <div className="relative">
            <MagnifyingGlass size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("memberList.search")}
              className="w-full bg-zinc-800/60 border border-zinc-700/40 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-cyan-500/40 transition-colors"
              data-testid="member-search-input"
            />
          </div>
        </div>
      </div>

      {/* Gruppierte Mitgliederliste */}
      <div className="flex-1 min-h-0 overflow-y-auto py-3 px-3" data-testid="member-list-scroll">
        {groups.map((group, idx) => (
          <div key={group.key} className={idx > 0 ? "mt-4" : ""}>
            <p className="workspace-section-label px-2 mb-1.5 flex items-center gap-1.5"
               data-testid={`member-group-${group.key}`}>
              {group.color && (
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: group.color }} />
              )}
              <span>
                {group.label || (group.key === "offline" ? t("memberList.offline") : t("memberList.online"))}
              </span>
              <span className="text-zinc-600 ml-auto">{group.members.length}</span>
            </p>
            {group.members.map((m) => (
              <MemberItem
                key={m.user_id}
                member={m}
                roles={roles}
                server={server}
                user={user}
                capabilities={capabilities}
                config={config}
                activities={activities}
                onStartDM={onStartDM}
                onKick={handleKick}
                onBan={handleBan}
                onMute={handleMute}
                t={t}
              />
            ))}
          </div>
        ))}

        {groups.length === 0 && searchQuery && (
          <p className="text-xs text-zinc-500 text-center py-8">
            {t("memberList.noResults")}
          </p>
        )}
      </div>
    </div>
  );
}
