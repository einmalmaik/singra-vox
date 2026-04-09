/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
import { Track } from "livekit-client";

const SCREEN_SHARE_PROXY_IDENTITY_PREFIX = "screen-share";

function normalizeSource(source) {
  return source || Track.Source.Unknown;
}

function buildTrackKey(participantIdentity, source) {
  return `${participantIdentity}:${normalizeSource(source)}`;
}

function buildNextTrackRevision(previousTrackState, nextTrack) {
  if (!nextTrack) {
    return previousTrackState?.revision || 0;
  }
  if (previousTrackState?.track === nextTrack) {
    return previousTrackState?.revision || 1;
  }
  return (previousTrackState?.revision || 0) + 1;
}

function parseScreenShareProxyOwnerUserId(participantIdentity) {
  if (!participantIdentity?.startsWith(`${SCREEN_SHARE_PROXY_IDENTITY_PREFIX}:`)) {
    return null;
  }

  const segments = participantIdentity.split(":");
  if (segments.length < 3) {
    return null;
  }

  return segments[segments.length - 1] || null;
}

function resolveParticipantIdentity(participant) {
  return participant?.identity || participant?.participantIdentity || null;
}

function resolveParticipantAttributes(participant) {
  return participant?.attributes || participant?.participantAttributes || {};
}

function buildParticipantEntry(participantIdentity, previousEntry, participant) {
  const nextAttributes = {
    ...(previousEntry?.attributes || {}),
    ...resolveParticipantAttributes(participant),
  };
  const ownerUserId = nextAttributes.owner_user_id
    || participant?.participantId
    || previousEntry?.userId
    || parseScreenShareProxyOwnerUserId(participantIdentity)
    || participantIdentity;

  return {
    participantIdentity,
    userId: ownerUserId,
    attributes: nextAttributes,
    previousUserId: previousEntry?.userId || null,
  };
}

export class ParticipantMediaRegistry {
  constructor() {
    this.participantsByIdentity = new Map();
    this.videoTracksByKey = new Map();
  }

  clear() {
    this.participantsByIdentity.clear();
    this.videoTracksByKey.clear();
  }

  upsertParticipant(participant) {
    const participantIdentity = resolveParticipantIdentity(participant);
    if (!participantIdentity) {
      return null;
    }

    const previousEntry = this.participantsByIdentity.get(participantIdentity);
    const nextEntry = buildParticipantEntry(participantIdentity, previousEntry, participant);
    this.participantsByIdentity.set(participantIdentity, nextEntry);

    this.videoTracksByKey.forEach((trackState, trackKey) => {
      if (trackState.participantIdentity !== participantIdentity) {
        return;
      }
      this.videoTracksByKey.set(trackKey, {
        ...trackState,
        participantId: nextEntry.userId,
      });
    });

    return nextEntry;
  }

  upsertVideoTrack({ participant, track, source }) {
    const participantEntry = this.upsertParticipant(participant);
    if (!participantEntry) {
      return null;
    }

    const normalizedSource = normalizeSource(source);
    const trackKey = buildTrackKey(participantEntry.participantIdentity, normalizedSource);
    const previousTrackState = this.videoTracksByKey.get(trackKey) || null;
    const nextTrackState = {
      trackKey,
      track,
      source: normalizedSource,
      participantIdentity: participantEntry.participantIdentity,
      participantId: participantEntry.userId,
      revision: buildNextTrackRevision(previousTrackState, track),
    };

    this.videoTracksByKey.set(trackKey, nextTrackState);
    return nextTrackState;
  }

  removeVideoTrack(participantIdentity, source) {
    if (!participantIdentity) {
      return false;
    }
    return this.videoTracksByKey.delete(buildTrackKey(participantIdentity, source));
  }

  getVideoTrackByIdentity(participantIdentity, source) {
    if (!participantIdentity) {
      return null;
    }
    return this.videoTracksByKey.get(buildTrackKey(participantIdentity, source)) || null;
  }

  findVideoTrackByUserId(userId, source) {
    const normalizedSource = normalizeSource(source);
    let preferredTrack = null;

    this.videoTracksByKey.forEach((trackState) => {
      if (trackState.participantId !== userId || trackState.source !== normalizedSource) {
        return;
      }
      if (!preferredTrack || trackState.participantIdentity === userId) {
        preferredTrack = trackState;
      }
    });

    return preferredTrack;
  }

  listRemoteMediaParticipants({ localUserId, audioStates = [] } = {}) {
    const participants = new Map();

    this.videoTracksByKey.forEach((trackState) => {
      if (!trackState.participantId || trackState.participantId === localUserId) {
        return;
      }

      const nextState = participants.get(trackState.participantId) || {
        userId: trackState.participantId,
        hasCamera: false,
        hasScreenShare: false,
        hasScreenShareAudio: false,
        cameraTrackRevision: 0,
        screenShareTrackRevision: 0,
      };

      if (trackState.source === Track.Source.Camera) {
        nextState.hasCamera = true;
        nextState.cameraTrackRevision = Math.max(
          nextState.cameraTrackRevision,
          trackState.revision || 0,
        );
      }
      if (trackState.source === Track.Source.ScreenShare) {
        nextState.hasScreenShare = true;
        nextState.screenShareTrackRevision = Math.max(
          nextState.screenShareTrackRevision,
          trackState.revision || 0,
        );
      }
      participants.set(trackState.participantId, nextState);
    });

    audioStates.forEach((audioState) => {
      if (!audioState?.participantId || audioState.participantId === localUserId) {
        return;
      }
      if (audioState.source !== Track.Source.ScreenShareAudio) {
        return;
      }

      const nextState = participants.get(audioState.participantId) || {
        userId: audioState.participantId,
        hasCamera: false,
        hasScreenShare: false,
        hasScreenShareAudio: false,
        cameraTrackRevision: 0,
        screenShareTrackRevision: 0,
      };
      nextState.hasScreenShareAudio = true;
      participants.set(audioState.participantId, nextState);
    });

    return Array.from(participants.values());
  }
}

export function createParticipantMediaRegistry() {
  return new ParticipantMediaRegistry();
}
