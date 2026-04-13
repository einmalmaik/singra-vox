/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "@/lib/api";
import { getCachedDmMessages, getPersistedWorkspaceState, setCachedDmMessages } from "@/lib/chatPersistence";
import { fetchMessageHistoryPage, fetchMessageHistoryWindow, mergeTimelineMessages } from "@/lib/messageHistory";

/**
 * Owns direct-message, group-DM and relay-DM state so the page shell can
 * compose a workspace without embedding view-specific state transitions.
 */
export function useDirectMessagesState({
  userId,
  view,
  e2eeReady,
  fetchDmRecipients,
  inspectRecipientTrust,
}) {
  const currentDmUserRef = useRef(null);
  const [dmConversations, setDmConversations] = useState([]);
  const [dmSortMode, setDmSortMode] = useState("recent");
  const [currentDmUser, setCurrentDmUser] = useState(null);
  const [dmMessages, setDmMessages] = useState([]);
  const [dmHistoryCursor, setDmHistoryCursor] = useState(null);
  const [dmHasOlderMessages, setDmHasOlderMessages] = useState(false);
  const [loadingOlderDmMessages, setLoadingOlderDmMessages] = useState(false);
  const [dmTrustNotice, setDmTrustNotice] = useState(false);
  const [dmSearchOpen, setDmSearchOpen] = useState(false);
  const [dmSearchQuery, setDmSearchQuery] = useState("");
  const [dmSearchResults, setDmSearchResults] = useState([]);
  const [dmSearchLoading, setDmSearchLoading] = useState(false);
  const [dmTab, setDmTab] = useState("dms");
  const [groupDMs, setGroupDMs] = useState([]);
  const [currentGroupDM, setCurrentGroupDM] = useState(null);
  const [relayDmFriend, setRelayDmFriend] = useState(null);

  useEffect(() => {
    currentDmUserRef.current = currentDmUser;
  }, [currentDmUser]);

  useEffect(() => {
    if (!userId || !currentDmUser?.id) {
      return;
    }
    setCachedDmMessages(userId, currentDmUser.id, dmMessages);
  }, [currentDmUser?.id, dmMessages, userId]);

  useEffect(() => {
    let cancelled = false;

    if (!currentDmUser?.id || !e2eeReady) {
      setDmTrustNotice(false);
      return undefined;
    }

    (async () => {
      try {
        const recipients = await fetchDmRecipients(currentDmUser.id);
        const result = await inspectRecipientTrust({
          scopeKind: "dm",
          scopeId: currentDmUser.id,
          recipientsResponse: recipients,
        });
        if (!cancelled) {
          setDmTrustNotice(Boolean(result.changed));
        }
      } catch {
        if (!cancelled) {
          setDmTrustNotice(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentDmUser?.id, e2eeReady, fetchDmRecipients, inspectRecipientTrust]);

  const loadDmConversations = useCallback(async () => {
    try {
      const response = await api.get("/dm/conversations");
      setDmConversations(response.data);
    } catch {
      setDmConversations([]);
    }
  }, []);

  const loadGroupDMs = useCallback(async () => {
    try {
      const response = await api.get("/groups");
      setGroupDMs(response.data || []);
    } catch {
      setGroupDMs([]);
    }
  }, []);

  const selectDmUser = useCallback(async (dmUser) => {
    if (!dmUser) {
      return;
    }
    setDmSearchOpen(false);
    setDmSearchQuery("");
    setDmSearchResults([]);
    setCurrentGroupDM(null);
    setRelayDmFriend(null);
    setCurrentDmUser(dmUser);
    const cachedMessages = getCachedDmMessages(userId, dmUser.id);
    if (cachedMessages.length > 0) {
      setDmMessages(cachedMessages);
    }
    setDmHistoryCursor(null);
    setDmHasOlderMessages(false);
    try {
      const history = await fetchMessageHistoryWindow(`/dm/${dmUser.id}`);
      setDmMessages(mergeTimelineMessages(cachedMessages, history.messages));
      setDmHistoryCursor(history.nextBefore);
      setDmHasOlderMessages(history.hasMoreBefore);
    } catch {
      setDmMessages(cachedMessages);
      setDmHistoryCursor(null);
      setDmHasOlderMessages(false);
    }
  }, [userId]);

  const loadOlderDmMessages = useCallback(async () => {
    if (!currentDmUserRef.current?.id || !dmHasOlderMessages || loadingOlderDmMessages) {
      return;
    }

    setLoadingOlderDmMessages(true);
    try {
      const envelope = await fetchMessageHistoryPage(`/dm/${currentDmUserRef.current.id}`, {
        before: dmHistoryCursor,
      });
      setDmMessages((previous) => mergeTimelineMessages(envelope.messages, previous));
      setDmHistoryCursor(envelope.nextBefore);
      setDmHasOlderMessages(envelope.hasMoreBefore);
    } finally {
      setLoadingOlderDmMessages(false);
    }
  }, [dmHasOlderMessages, dmHistoryCursor, loadingOlderDmMessages]);

  useEffect(() => {
    if (!dmSearchOpen || dmSearchQuery.length < 2) {
      setDmSearchResults([]);
      return undefined;
    }
    setDmSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await api.get(`/users/search?q=${encodeURIComponent(dmSearchQuery)}`);
        setDmSearchResults((response.data || []).filter((user) => user.id !== userId));
      } catch {
        setDmSearchResults([]);
      } finally {
        setDmSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [dmSearchOpen, dmSearchQuery, userId]);

  useEffect(() => {
    if (view !== "dm" || currentDmUser || dmConversations.length === 0 || !userId) {
      return;
    }
    const persistedState = getPersistedWorkspaceState(userId);
    if (!persistedState.dmUserId) {
      return;
    }
    const persistedConversation = dmConversations.find((conversation) => conversation.user?.id === persistedState.dmUserId);
    if (persistedConversation?.user) {
      void selectDmUser(persistedConversation.user);
    }
  }, [currentDmUser, dmConversations, selectDmUser, userId, view]);

  const toggleSearch = useCallback(() => {
    setDmSearchOpen((previous) => !previous);
    setDmSearchQuery("");
    setDmSearchResults([]);
  }, []);

  const cycleSortMode = useCallback(() => {
    setDmSortMode((mode) => (mode === "recent" ? "unread" : mode === "unread" ? "name" : "recent"));
  }, []);

  const selectGroupDm = useCallback((group) => {
    setCurrentGroupDM(group);
    setCurrentDmUser(null);
    setRelayDmFriend(null);
  }, []);

  const startRelayDm = useCallback((friendship) => {
    setRelayDmFriend(friendship);
    setCurrentGroupDM(null);
    setCurrentDmUser(null);
  }, []);

  const appendDmMessage = useCallback((message) => {
    setDmMessages((previous) => [...previous, message]);
  }, []);

  const state = useMemo(() => ({
    dmConversations,
    dmSortMode,
    currentDmUser,
    dmMessages,
    dmHasOlderMessages,
    loadingOlderDmMessages,
    dmTrustNotice,
    dmSearchOpen,
    dmSearchQuery,
    dmSearchResults,
    dmSearchLoading,
    dmTab,
    groupDMs,
    currentGroupDM,
    relayDmFriend,
  }), [
    currentDmUser,
    currentGroupDM,
    dmConversations,
    dmHasOlderMessages,
    dmMessages,
    dmSearchLoading,
    dmSearchOpen,
    dmSearchQuery,
    dmSearchResults,
    dmSortMode,
    dmTab,
    dmTrustNotice,
    groupDMs,
    loadingOlderDmMessages,
    relayDmFriend,
  ]);

  const refs = useMemo(() => ({
    currentDmUserRef,
  }), []);

  const actions = useMemo(() => ({
    loadDmConversations,
    loadGroupDMs,
    selectDmUser,
    loadOlderDmMessages,
    toggleSearch,
    cycleSortMode,
    setDmSearchQuery,
    setDmTab,
    selectGroupDm,
    startRelayDm,
    appendDmMessage,
  }), [
    appendDmMessage,
    cycleSortMode,
    loadDmConversations,
    loadGroupDMs,
    loadOlderDmMessages,
    selectDmUser,
    selectGroupDm,
    startRelayDm,
    toggleSearch,
  ]);

  const mutators = useMemo(() => ({
    setDmConversations,
    setCurrentDmUser,
    setDmMessages,
    setCurrentGroupDM,
    setRelayDmFriend,
    setDmTrustNotice,
    setDmSearchResults,
  }), []);

  return useMemo(() => ({
    state,
    refs,
    actions,
    mutators,
  }), [actions, mutators, refs, state]);
}
