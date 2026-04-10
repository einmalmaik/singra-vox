/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { ArrowsDownUp, ChatCircleDots, MagnifyingGlass, Plus, ShieldCheck, UserPlus, UsersThree } from "@phosphor-icons/react";
import E2EEStatus from "@/components/security/E2EEStatus";
import GroupDMSection from "@/components/dm/GroupDMSection";
import GroupDMChat from "@/components/dm/GroupDMChat";
import FriendsPanel from "@/components/friends/FriendsPanel";
import RelayDMChat from "@/components/friends/RelayDMChat";
import { resolveAssetUrl } from "@/lib/assetUrls";
import DirectMessageComposer from "./DirectMessageComposer";
import DecryptedDirectMessageContent from "./DecryptedDirectMessageContent";

function sortDmConversations(conversations, mode) {
  return [...conversations].sort((left, right) => {
    if (mode === "unread") {
      const unreadDiff = (right.unread_count || 0) - (left.unread_count || 0);
      if (unreadDiff !== 0) {
        return unreadDiff;
      }
    }
    if (mode === "name") {
      return (left.user?.display_name || "").localeCompare(right.user?.display_name || "");
    }
    const leftTime = left.last_message?.created_at ? new Date(left.last_message.created_at).getTime() : 0;
    const rightTime = right.last_message?.created_at ? new Date(right.last_message.created_at).getTime() : 0;
    return rightTime - leftTime;
  });
}

/**
 * Presentational DM workspace. All data, handlers and derived UI state come
 * from the MainLayout controller so the view stays isolated and easily testable.
 */
export default function DirectMessagesWorkspaceView({
  t,
  config,
  e2eeReady,
  isDesktopCapable,
  sidebar,
  activePane,
}) {
  const sortedConversations = sortDmConversations(sidebar.dmConversations, sidebar.dmSortMode);

  return (
    <>
      <div className="workspace-panel w-[280px] flex flex-col overflow-hidden" data-testid="dm-sidebar">
        <div className="h-12 flex items-center px-4 border-b workspace-divider bg-zinc-900/25 shrink-0 gap-2">
          <h3 className="text-sm font-bold text-white flex-1" style={{ fontFamily: "Manrope" }}>{t("server.directMessages")}</h3>
          <button
            onClick={sidebar.onCycleSortMode}
            title={sidebar.sortTitle}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-white/5 transition-colors relative"
            data-testid="dm-sort-btn"
          >
            <ArrowsDownUp size={14} />
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-cyan-500" style={{ display: sidebar.dmSortMode !== "recent" ? "block" : "none" }} />
          </button>
          <button
            onClick={sidebar.onToggleSearch}
            title="Neue Direktnachricht"
            className={`p-1.5 rounded-lg transition-colors ${sidebar.dmSearchOpen ? "bg-cyan-500/15 text-cyan-400" : "text-zinc-500 hover:text-zinc-300 hover:bg-white/5"}`}
            data-testid="dm-new-btn"
          >
            <Plus size={14} />
          </button>
        </div>

        <div className="flex gap-0.5 border-b workspace-divider bg-zinc-950/30 px-2 py-1.5 shrink-0" data-testid="dm-tabs">
          {[
            { id: "dms", label: "DMs", icon: <ChatCircleDots size={13} /> },
            { id: "groups", label: "Gruppen", icon: <UsersThree size={13} /> },
            { id: "friends", label: "Freunde", icon: <UserPlus size={13} /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => sidebar.onSelectTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors ${
                sidebar.dmTab === tab.id
                  ? "bg-cyan-500/12 text-cyan-300"
                  : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
              }`}
              data-testid={`dm-tab-${tab.id}`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {sidebar.dmTab === "dms" && sidebar.dmSearchOpen && (
          <div className="px-3 pt-2 pb-1 border-b workspace-divider bg-zinc-900/15 shrink-0">
            <div className="relative">
              <MagnifyingGlass size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
              <input
                autoFocus
                type="text"
                value={sidebar.dmSearchQuery}
                onChange={(event) => sidebar.onChangeSearchQuery(event.target.value)}
                placeholder="Nutzer suchen..."
                className="w-full rounded-xl bg-zinc-900/70 border border-white/8 pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-cyan-400/50 focus:ring-1 focus:ring-cyan-400/20"
                data-testid="dm-search-input"
              />
            </div>
            {sidebar.dmSearchLoading && (
              <p className="text-xs text-zinc-600 mt-1 px-1">Suche...</p>
            )}
            {!sidebar.dmSearchLoading && sidebar.dmSearchQuery.length >= 2 && sidebar.dmSearchResults.length === 0 && (
              <p className="text-xs text-zinc-600 mt-1 px-1">Keine Nutzer gefunden</p>
            )}
            {sidebar.dmSearchResults.length > 0 && (
              <div className="mt-1 space-y-0.5 max-h-[140px] overflow-y-auto">
                {sidebar.dmSearchResults.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => void sidebar.onSelectDmUser(user)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-white/5 text-zinc-300 hover:text-white transition-colors"
                    data-testid={`dm-search-result-${user.username}`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-zinc-800 flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden">
                      {user.avatar_url ? (
                        <img src={resolveAssetUrl(user.avatar_url, config?.assetBase)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        user.display_name?.[0]?.toUpperCase() || "?"
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{user.display_name || user.username}</p>
                      <p className="text-xs text-zinc-600 truncate">@{user.username}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {sidebar.dmTab === "dms" && (
          <div className="flex-1 overflow-y-auto p-3 space-y-1" data-testid="dm-conversations-list">
            {sortedConversations.map((conversation) => (
              <button
                key={conversation.user.id}
                onClick={() => void sidebar.onSelectDmUser(conversation.user)}
                data-testid={`dm-conv-${conversation.user.username}`}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${
                  activePane.currentDmUser?.id === conversation.user.id
                    ? "bg-cyan-500/12 text-white workspace-cyan-glow"
                    : "text-[#A1A1AA] hover:bg-white/5 hover:text-white"
                }`}
              >
                <div className="w-9 h-9 rounded-xl bg-zinc-800/80 flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden">
                  {conversation.user.avatar_url ? (
                    <img src={resolveAssetUrl(conversation.user.avatar_url, config?.assetBase)} alt={conversation.user.display_name || conversation.user.username || "avatar"} className="h-full w-full object-cover" />
                  ) : (
                    conversation.user.display_name?.[0]?.toUpperCase() || "?"
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{conversation.user.display_name}</p>
                  {conversation.last_message ? (
                    <p className="text-xs text-[#71717A] truncate">{conversation.last_message.content}</p>
                  ) : (
                    <p className="text-xs text-[#52525B] italic truncate">Noch keine Nachrichten</p>
                  )}
                </div>
                {conversation.unread_count > 0 && (
                  <span className="bg-cyan-500 text-zinc-950 text-xs rounded-full w-5 h-5 flex items-center justify-center shrink-0 font-bold">
                    {conversation.unread_count > 9 ? "9+" : conversation.unread_count}
                  </span>
                )}
              </button>
            ))}

            {sidebar.dmConversations.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 py-12 px-4" data-testid="dm-empty-state">
                <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 flex items-center justify-center">
                  <ChatCircleDots size={22} weight="duotone" className="text-zinc-500" />
                </div>
                <p className="text-xs text-zinc-600 text-center leading-relaxed">
                  Noch keine Direktnachrichten.<br />Klick auf ein Mitglied um zu starten.
                </p>
              </div>
            )}
          </div>
        )}

        {sidebar.dmTab === "groups" && (
          <div className="flex-1 overflow-y-auto" data-testid="group-dm-tab">
            <GroupDMSection
              groups={sidebar.groupDMs}
              selectedGroupId={activePane.currentGroupDM?.id}
              onSelectGroup={sidebar.onSelectGroupDm}
              onGroupsChanged={sidebar.onGroupsChanged}
            />
          </div>
        )}

        {sidebar.dmTab === "friends" && (
          <div className="flex-1 overflow-y-auto" data-testid="friends-tab">
            <FriendsPanel onStartRelayDm={sidebar.onStartRelayDm} />
          </div>
        )}
      </div>

      {activePane.currentGroupDM ? (
        <div className="workspace-panel flex-1 flex flex-col overflow-hidden" data-testid="group-dm-chat-area">
          <GroupDMChat group={activePane.currentGroupDM} config={config} />
        </div>
      ) : activePane.relayDmFriend ? (
        <div className="workspace-panel flex-1 flex flex-col overflow-hidden" data-testid="relay-dm-chat-area">
          <RelayDMChat friendship={activePane.relayDmFriend} config={config} />
        </div>
      ) : activePane.currentDmUser ? (
        <div className="workspace-panel flex-1 flex flex-col overflow-hidden" data-testid="dm-chat-area">
          <div className="h-12 flex items-center px-4 border-b workspace-divider bg-zinc-900/25 shrink-0">
            <div className="w-8 h-8 rounded-xl bg-zinc-800/80 flex items-center justify-center text-xs font-bold mr-3">
              {activePane.currentDmUser.avatar_url ? (
                <img src={resolveAssetUrl(activePane.currentDmUser.avatar_url, config?.assetBase)} alt={activePane.currentDmUser.display_name || activePane.currentDmUser.username || "avatar"} className="h-full w-full rounded-xl object-cover" />
              ) : (
                activePane.currentDmUser.display_name?.[0]?.toUpperCase()
              )}
            </div>
            <span className="font-semibold text-sm">{activePane.currentDmUser.display_name}</span>
            <span className="ml-2 text-xs text-[#71717A]">@{activePane.currentDmUser.username}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {!e2eeReady ? (
              <E2EEStatus
                variant="guard"
                scope="dm"
                ready={e2eeReady}
                isDesktopCapable={isDesktopCapable}
                className="workspace-card p-6"
              />
            ) : (
              <>
                {activePane.dmTrustNotice && (
                  <E2EEStatus
                    variant="notice"
                    messageKey="e2ee.deviceListChanged"
                    className="mb-4"
                  />
                )}
                {activePane.dmHasOlderMessages && (
                  <div className="flex justify-center pb-2">
                    <button
                      type="button"
                      onClick={() => void activePane.onLoadOlderDmMessages()}
                      disabled={activePane.loadingOlderDmMessages}
                      className="rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-300 transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {activePane.loadingOlderDmMessages ? t("common.loading") : t("chat.loadOlderMessages")}
                    </button>
                  </div>
                )}
                {activePane.dmMessages.map((message) => (
                  <div key={message.id} className="flex gap-3 fade-in" data-testid={`dm-msg-${message.id}`}>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#27272A] text-xs font-bold">
                      {message.sender?.avatar_url ? (
                        <img src={resolveAssetUrl(message.sender.avatar_url, config?.assetBase)} alt={message.sender?.display_name || message.sender?.username || "avatar"} className="h-full w-full object-cover" />
                      ) : (
                        message.sender?.display_name?.[0]?.toUpperCase() || "?"
                      )}
                    </div>
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold">{message.sender?.display_name}</span>
                        <span className="text-[10px] text-[#71717A]">{new Date(message.created_at).toLocaleTimeString()}</span>
                      </div>
                      <p className="text-sm text-[#E4E4E7] mt-0.5">
                        {message.is_encrypted || message.is_e2ee ? (
                          <span className="flex items-center gap-1">
                            <ShieldCheck size={12} weight="fill" className="text-[#6366F1]" />
                            <DecryptedDirectMessageContent msg={message} config={config} />
                          </span>
                        ) : message.content}
                      </p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
          {isDesktopCapable ? (
            <DirectMessageComposer
              userId={activePane.currentDmUser.id}
              e2eeReady={e2eeReady}
              onSent={activePane.onDmSent}
            />
          ) : null}
        </div>
      ) : (
        <div className="workspace-panel flex-1 flex flex-col items-center justify-center gap-4" data-testid="dm-no-selection">
          <div className="w-16 h-16 rounded-3xl bg-zinc-800/50 flex items-center justify-center">
            <ChatCircleDots size={28} weight="duotone" className="text-zinc-600" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-sm font-semibold text-zinc-400">{t("dm.selectConversation")}</p>
            <p className="text-xs text-zinc-600">Wahle eine Unterhaltung aus oder klick<br />auf ein Mitglied um zu schreiben.</p>
          </div>
        </div>
      )}
    </>
  );
}
