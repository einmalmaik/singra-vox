/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { useCallback } from "react";
import { toast } from "sonner";
import { pushNotification } from "@/lib/notificationsStore";
import { mergeMessages, removeMember, removeVoiceUser, upsertById, upsertMember, upsertVoiceState } from "./mainLayoutState";

function playVoiceTone(audioCtxRef, type) {
  try {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    const context = audioCtxRef.current;
    if (context.state === "suspended") {
      context.resume();
    }
    const frequencies = type === "join" ? [880, 1047] : [1047, 659];
    frequencies.forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      const startTime = context.currentTime + index * 0.12;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.08, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.18);
      oscillator.start(startTime);
      oscillator.stop(startTime + 0.18);
    });
  } catch {
    // Browsers may block audio until user interaction. The workspace should
    // keep functioning even when join/leave tones cannot be played.
  }
}

/**
 * Translates raw workspace WebSocket payloads into domain state mutations.
 * Keeping this outside MainLayout prevents the page shell from becoming the
 * source of truth for every event-specific transition.
 */
export function useMainLayoutEventHandler({
  t,
  navigate,
  userId,
  config,
  setUser,
  refreshUnread,
  notificationPreferencesRef,
  userStatusRef,
  audioCtxRef,
  voiceRef,
  setTypingUsers,
  serverWorkspace,
  directMessages,
  loadServers,
  handleRemovedFromServer,
}) {
  return useCallback(async (data) => {
    switch (data.type) {
      case "new_message":
        if (data.channel_id === serverWorkspace.refs.currentChannelRef.current?.id) {
          serverWorkspace.mutators.setMessages((previous) => mergeMessages(previous, data.message));
          setTypingUsers((previous) => {
            const channelTyping = { ...(previous[data.channel_id] || {}) };
            delete channelTyping[data.message.author_id];
            return { ...previous, [data.channel_id]: channelTyping };
          });
        } else {
          void refreshUnread();
        }
        break;

      case "message_edit":
        serverWorkspace.mutators.setMessages((previous) => previous.map((message) => (
          message.id === data.message.id ? data.message : message
        )));
        break;

      case "message_delete":
        serverWorkspace.mutators.setMessages((previous) => previous.filter((message) => message.id !== data.message_id));
        break;

      case "typing":
        if (!data.channel_id) {
          break;
        }
        setTypingUsers((previous) => {
          const channelTyping = { ...(previous[data.channel_id] || {}), [data.user_id]: data.username };
          return { ...previous, [data.channel_id]: channelTyping };
        });
        window.setTimeout(() => {
          setTypingUsers((previous) => {
            const channelTyping = { ...(previous[data.channel_id] || {}) };
            delete channelTyping[data.user_id];
            return { ...previous, [data.channel_id]: channelTyping };
          });
        }, 3000);
        break;

      case "dm_message":
        if (data.message.sender_id === directMessages.refs.currentDmUserRef.current?.id) {
          directMessages.mutators.setDmMessages((previous) => (
            previous.some((message) => message.id === data.message.id)
              ? previous
              : [...previous, data.message]
          ));
        }
        void directMessages.actions.loadDmConversations();
        void refreshUnread();
        break;

      case "server_updated":
        serverWorkspace.mutators.setServers((previous) => upsertById(previous, data.server));
        if (serverWorkspace.refs.currentServerRef.current?.id === data.server.id) {
          serverWorkspace.mutators.setCurrentServer((previous) => ({ ...(previous || {}), ...data.server }));
        }
        break;

      case "server_deleted":
        serverWorkspace.mutators.setServers((previous) => previous.filter((server) => server.id !== data.server_id));
        if (serverWorkspace.refs.currentServerRef.current?.id === data.server_id) {
          await handleRemovedFromServer(data.server_id, t("server.deleted"));
        }
        break;

      case "channel_create":
        serverWorkspace.mutators.setChannels((previous) => (
          previous.some((channel) => channel.id === data.channel.id) ? previous : [...previous, data.channel]
        ));
        break;

      case "channel_updated":
        serverWorkspace.mutators.setChannels((previous) => previous.map((channel) => (
          channel.id === data.channel.id ? { ...channel, ...data.channel } : channel
        )));
        if (serverWorkspace.refs.currentChannelRef.current?.id === data.channel.id) {
          serverWorkspace.mutators.setCurrentChannel((previous) => ({ ...(previous || {}), ...data.channel }));
        }
        break;

      case "channel_delete":
        serverWorkspace.mutators.setChannels((previous) => previous.filter((channel) => channel.id !== data.channel_id));
        if (serverWorkspace.refs.currentChannelRef.current?.id === data.channel_id) {
          serverWorkspace.mutators.setCurrentChannel(null);
          serverWorkspace.actions.clearChannelTimeline();
        }
        break;

      case "role_created":
        serverWorkspace.mutators.setRoles((previous) => (
          previous.some((role) => role.id === data.role.id) ? previous : [...previous, data.role]
        ));
        break;

      case "role_updated":
        serverWorkspace.mutators.setRoles((previous) => previous.map((role) => (
          role.id === data.role.id ? { ...role, ...data.role } : role
        )));
        break;

      case "role_deleted":
        serverWorkspace.mutators.setRoles((previous) => previous.filter((role) => role.id !== data.role_id));
        serverWorkspace.mutators.setMembers((previous) => previous.map((member) => ({
          ...member,
          roles: (member.roles || []).filter((roleId) => roleId !== data.role_id),
        })));
        break;

      case "member_joined":
      case "member_updated":
        if (data.member) {
          serverWorkspace.mutators.setMembers((previous) => upsertMember(previous, data.member));
        }
        break;

      case "presence_update":
        serverWorkspace.mutators.setMembers((previous) => previous.map((member) => (
          member.user_id === data.user_id
            ? { ...member, user: { ...(member.user || {}), ...(data.user || {}) } }
            : member
        )));
        directMessages.mutators.setDmConversations((previous) => previous.map((conversation) => (
          conversation.user?.id === data.user_id
            ? { ...conversation, user: { ...(conversation.user || {}), ...(data.user || {}) } }
            : conversation
        )));
        serverWorkspace.mutators.setMessages((previous) => previous.map((message) => (
          message.author_id === data.user_id
            ? { ...message, author: { ...(message.author || {}), ...(data.user || {}) } }
            : message
        )));
        directMessages.mutators.setDmMessages((previous) => previous.map((message) => (
          message.sender_id === data.user_id
            ? { ...message, sender: { ...(message.sender || {}), ...(data.user || {}) } }
            : message
        )));
        if (directMessages.refs.currentDmUserRef.current?.id === data.user_id) {
          directMessages.mutators.setCurrentDmUser((previous) => ({ ...(previous || {}), ...(data.user || {}) }));
        }
        if (userId === data.user_id) {
          setUser((previous) => ({ ...(previous || {}), ...(data.user || {}) }));
        }
        break;

      case "member_kicked":
      case "member_banned":
        serverWorkspace.mutators.setMembers((previous) => removeMember(previous, data.user_id));
        serverWorkspace.mutators.setChannels((previous) => removeVoiceUser(previous, data.user_id));
        if (data.user_id === userId && data.server_id === serverWorkspace.refs.currentServerRef.current?.id) {
          await handleRemovedFromServer(
            data.server_id,
            data.type === "member_kicked" ? t("server.removedFromServer") : t("server.bannedFromServer"),
          );
        }
        break;

      case "member_left":
        serverWorkspace.mutators.setMembers((previous) => removeMember(previous, data.user_id));
        serverWorkspace.mutators.setChannels((previous) => removeVoiceUser(previous, data.user_id));
        break;

      case "member_unbanned":
        if (data.member) {
          serverWorkspace.mutators.setMembers((previous) => upsertMember(previous, data.member));
        }
        if (data.user_id === userId) {
          await loadServers();
        }
        break;

      case "server_left":
        if (data.user_id === userId) {
          await handleRemovedFromServer(data.server_id, t("server.left"));
        }
        break;

      case "voice_join":
        serverWorkspace.mutators.setChannels((previous) => upsertVoiceState(previous, data.channel_id, data.state));
        if (data.state?.user_id !== userId && userStatusRef.current !== "dnd") {
          playVoiceTone(audioCtxRef, "join");
        }
        break;

      case "voice_leave":
        serverWorkspace.mutators.setChannels((previous) => removeVoiceUser(previous, data.user_id, data.channel_id));
        if (data.user_id !== userId && userStatusRef.current !== "dnd") {
          playVoiceTone(audioCtxRef, "leave");
        }
        break;

      case "voice_state_update":
        serverWorkspace.mutators.setChannels((previous) => previous.map((channel) => {
          if (channel.id !== data.channel_id) {
            return channel;
          }
          return {
            ...channel,
            voice_states: (channel.voice_states || []).map((state) => (
              state.user_id === data.user_id ? { ...state, ...data.state } : state
            )),
          };
        }));
        break;

      case "voice_force_leave":
        if (voiceRef.current) {
          await voiceRef.current.disconnect();
          voiceRef.current = null;
        }
        serverWorkspace.mutators.setChannels((previous) => removeVoiceUser(previous, userId, data.channel_id));
        break;

      case "notification":
        pushNotification(data.notification);
        if (userStatusRef.current === "dnd") {
          break;
        }
        toast(data.notification.title, {
          description: data.notification.body,
          action: data.notification.link ? {
            label: "View",
            onClick: () => navigate(data.notification.link),
          } : undefined,
        });
        if (
          config?.isDesktop
          && notificationPreferencesRef.current?.desktop_push_enabled !== false
          && document.visibilityState !== "visible"
        ) {
          import("@tauri-apps/plugin-notification").then(({ sendNotification }) => {
            sendNotification({ title: data.notification.title, body: data.notification.body });
          }).catch(() => {});
        } else if (
          !config?.isDesktop
          && notificationPreferencesRef.current?.web_push_enabled !== false
          && typeof window !== "undefined"
          && "Notification" in window
          && Notification.permission === "granted"
          && document.visibilityState !== "visible"
        ) {
          const browserNotification = new Notification(data.notification.title, {
            body: data.notification.body,
          });
          browserNotification.onclick = () => {
            window.focus();
            if (data.notification.link) {
              navigate(data.notification.link);
            }
          };
        }
        break;

      default:
        break;
    }
  }, [audioCtxRef, config?.isDesktop, directMessages.actions, directMessages.mutators, directMessages.refs.currentDmUserRef, handleRemovedFromServer, loadServers, navigate, notificationPreferencesRef, refreshUnread, serverWorkspace.actions, serverWorkspace.mutators, serverWorkspace.refs.currentChannelRef, serverWorkspace.refs.currentServerRef, setTypingUsers, setUser, t, userId, userStatusRef, voiceRef]);
}
