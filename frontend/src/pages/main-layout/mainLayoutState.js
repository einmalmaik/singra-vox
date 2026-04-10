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
 * Pure workspace helpers shared by the MainLayout domain hooks.
 * They intentionally stay side-effect free so state transitions can be tested
 * without mounting the full page shell.
 */

export function upsertById(list, item) {
  const existingIndex = list.findIndex((entry) => entry.id === item.id);
  if (existingIndex === -1) {
    return [...list, item];
  }

  const next = [...list];
  next[existingIndex] = { ...next[existingIndex], ...item };
  return next;
}

export function upsertMember(list, member) {
  const existingIndex = list.findIndex((entry) => entry.user_id === member.user_id);
  if (existingIndex === -1) {
    return [...list, member];
  }

  const next = [...list];
  next[existingIndex] = {
    ...next[existingIndex],
    ...member,
    user: {
      ...(next[existingIndex].user || {}),
      ...(member.user || {}),
    },
  };
  return next;
}

export function removeMember(list, userId) {
  return list.filter((member) => member.user_id !== userId);
}

export function removeVoiceUser(channels, userId, channelId = null) {
  return channels.map((channel) => {
    if (channel.type !== "voice") {
      return channel;
    }
    if (channelId && channel.id !== channelId) {
      return channel;
    }
    return {
      ...channel,
      voice_states: (channel.voice_states || []).filter((state) => state.user_id !== userId),
    };
  });
}

export function upsertVoiceState(channels, channelId, nextState) {
  return channels.map((channel) => {
    if (channel.type !== "voice") {
      return {
        ...channel,
        voice_states: removeVoiceUser([channel], nextState.user_id)[0]?.voice_states || channel.voice_states,
      };
    }

    if (channel.id === channelId) {
      const existingStates = (channel.voice_states || []).filter((state) => state.user_id !== nextState.user_id);
      return {
        ...channel,
        voice_states: [...existingStates, nextState],
      };
    }

    return {
      ...channel,
      voice_states: (channel.voice_states || []).filter((state) => state.user_id !== nextState.user_id),
    };
  });
}

export function mergeMessages(previousMessages, nextMessage) {
  if (!nextMessage) {
    return previousMessages;
  }

  const mergedMessages = previousMessages.some((message) => message.id === nextMessage.id)
    ? previousMessages.map((message) => (message.id === nextMessage.id ? { ...message, ...nextMessage } : message))
    : [...previousMessages, nextMessage];

  return mergedMessages.slice().sort((left, right) => (
    new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  ));
}
