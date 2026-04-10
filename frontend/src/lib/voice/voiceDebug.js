/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const VOICE_DEBUG_STORAGE_KEY = "singravox.voice_debug";
const VOICE_DEBUG_QUERY_KEY = "voiceDebug";
const MAX_DEBUG_EVENTS = 200;

function hasWindow() {
  return typeof window !== "undefined";
}

function getDebugWindowStore() {
  if (!hasWindow()) {
    return null;
  }

  if (!window.__SINGRA_VOICE_DEBUG__) {
    window.__SINGRA_VOICE_DEBUG__ = {
      enabledAt: null,
      events: [],
      getSnapshot: null,
      lastSnapshot: null,
    };
  }

  return window.__SINGRA_VOICE_DEBUG__;
}

function resolveTrackStreamState(track, publication = null) {
  if (track?.streamState != null) {
    return track.streamState;
  }
  if (publication?.streamState != null) {
    return publication.streamState;
  }
  return track ? "active" : null;
}

function snapshotPublication(publication) {
  const track = publication?.track || null;
  if (!publication) {
    return null;
  }

  return {
    sid: publication.trackSid || publication.sid || null,
    source: publication.source || track?.source || null,
    kind: publication.kind || track?.kind || null,
    isMuted: Boolean(publication.isMuted),
    isDesired: publication.isDesired ?? null,
    isSubscribed: typeof publication.isSubscribed === "boolean"
      ? publication.isSubscribed
      : publication.subscriptionStatus === "subscribed",
    subscriptionStatus: publication.subscriptionStatus || null,
    streamState: resolveTrackStreamState(track, publication),
    trackSid: track?.sid || null,
    mediaStreamTrackId: track?.mediaStreamTrack?.id || null,
  };
}

function snapshotParticipant(participant) {
  const publications = [];

  participant?.trackPublications?.forEach?.((publication) => {
    publications.push(snapshotPublication(publication));
  });

  return {
    sid: participant?.sid || null,
    identity: participant?.identity || null,
    isMicrophoneEnabled: participant?.isMicrophoneEnabled ?? null,
    isCameraEnabled: participant?.isCameraEnabled ?? null,
    isScreenShareEnabled: participant?.isScreenShareEnabled ?? null,
    publications,
  };
}

function snapshotTrackRefBinding(engine, trackRef) {
  if (!trackRef || typeof engine?._resolveTrackBinding !== "function") {
    return null;
  }

  const binding = engine._resolveTrackBinding(trackRef.id);
  if (!binding) {
    return null;
  }

  return {
    participantIdentity: binding.participant?.identity || binding.trackRef?.participantIdentity || null,
    publication: snapshotPublication(binding.publication),
    hasTrack: Boolean(binding.track),
    trackSid: binding.track?.sid || null,
    mediaStreamTrackId: binding.track?.mediaStreamTrack?.id || null,
    isAttachable: typeof engine?._isTrackBindingAttachable === "function"
      ? Boolean(engine._isTrackBindingAttachable(binding))
      : Boolean(binding.track),
  };
}

export function isVoiceDebugEnabled() {
  if (!hasWindow()) {
    return false;
  }

  try {
    if (window.localStorage.getItem(VOICE_DEBUG_STORAGE_KEY) === "1") {
      return true;
    }
  } catch {
    // Ignore storage access failures in restricted shells.
  }

  try {
    const search = new URLSearchParams(window.location.search || "");
    return search.get(VOICE_DEBUG_QUERY_KEY) === "1";
  } catch {
    return false;
  }
}

export function buildVoiceDebugSnapshot(engine) {
  if (!engine) {
    return null;
  }

  const room = engine.room || null;
  const videoTrackRefs = Array.from(engine.videoTrackRefsById?.values?.() || [])
    .filter(Boolean)
    .map((trackRef) => ({
      id: trackRef.id,
      participantId: trackRef.participantId || null,
      participantIdentity: trackRef.participantIdentity || null,
      source: trackRef.source || null,
      isLocal: Boolean(trackRef.isLocal),
      isAvailable: Boolean(trackRef.isAvailable),
      provider: trackRef.provider || null,
      binding: snapshotTrackRefBinding(engine, trackRef),
    }));

  const remoteParticipants = [];
  room?.remoteParticipants?.forEach?.((participant) => {
    remoteParticipants.push(snapshotParticipant(participant));
  });

  return {
    capturedAt: new Date().toISOString(),
    runtime: {
      platform: engine.runtimeConfig?.platform || (engine.runtimeConfig?.isDesktop ? "desktop" : "web"),
      isDesktop: Boolean(engine.runtimeConfig?.isDesktop),
      serverId: engine.serverId || null,
      channelId: engine.channelId || null,
      userId: engine.userId || null,
    },
    room: room ? {
      name: room.name || null,
      state: room.state || null,
      connectionState: room.engine?.client?.currentState || room.engine?.connectionState || null,
      remoteParticipantCount: room.remoteParticipants?.size ?? null,
    } : null,
    localParticipant: snapshotParticipant(room?.localParticipant || null),
    videoTrackRefs,
  };
}

export function attachVoiceDebugEngine(engine) {
  if (!isVoiceDebugEnabled()) {
    return () => {};
  }

  const store = getDebugWindowStore();
  if (!store) {
    return () => {};
  }

  store.enabledAt = store.enabledAt || new Date().toISOString();
  store.getSnapshot = () => buildVoiceDebugSnapshot(engine);
  store.lastSnapshot = buildVoiceDebugSnapshot(engine);

  return () => {
    if (!store || store.getSnapshot == null) {
      return;
    }
    store.lastSnapshot = buildVoiceDebugSnapshot(engine);
    store.getSnapshot = null;
  };
}

export function recordVoiceDebugEvent(level, message, payload = {}) {
  if (!isVoiceDebugEnabled()) {
    return;
  }

  const store = getDebugWindowStore();
  if (!store) {
    return;
  }

  store.events.push({
    capturedAt: new Date().toISOString(),
    level,
    message,
    payload,
  });

  if (store.events.length > MAX_DEBUG_EVENTS) {
    store.events.splice(0, store.events.length - MAX_DEBUG_EVENTS);
  }

  if (typeof store.getSnapshot === "function") {
    try {
      store.lastSnapshot = store.getSnapshot();
    } catch {
      // Keep debug logging non-intrusive.
    }
  }
}
