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

export const VIDEO_TRACK_STATE_PENDING = "pending";
export const VIDEO_TRACK_STATE_READY = "ready";
export const EMPTY_LOCAL_MEDIA_STATE = Object.freeze({
  hasCamera: false,
  hasCameraTrack: false,
  cameraTrackRevision: 0,
  hasScreenShare: false,
  hasScreenShareTrack: false,
  screenShareTrackRevision: 0,
  hasScreenShareAudio: false,
});

function normalizeSource(source) {
  return source || Track.Source.Unknown;
}

function compareTrackRefs(a, b) {
  return a.id.localeCompare(b.id);
}

export function buildVideoTrackRefId({ participantId, source, isLocal = false } = {}) {
  const scope = isLocal ? "local" : "remote";
  return `${scope}:${participantId || "unknown"}:${normalizeSource(source)}`;
}

export function sortVideoTrackRefs(trackRefs = []) {
  return [...trackRefs].sort(compareTrackRefs);
}

export function indexVideoTrackRefs(trackRefs = []) {
  return new Map(trackRefs.map((trackRef) => [trackRef.id, trackRef]));
}

export function findVideoTrackRef(
  trackRefs = [],
  { participantId = null, source = null, preferLocal = false } = {},
) {
  const normalizedSource = normalizeSource(source);
  const matches = trackRefs.filter((trackRef) => (
    trackRef.participantId === participantId
    && normalizeSource(trackRef.source) === normalizedSource
  ));

  if (!matches.length) {
    return null;
  }

  return matches.find((trackRef) => Boolean(trackRef.isLocal) === Boolean(preferLocal))
    || matches[0];
}

export function buildLocalMediaStateFromTrackRefs(trackRefs = [], { localUserId = null } = {}) {
  const localTrackRefs = trackRefs.filter((trackRef) => (
    trackRef.isLocal && (!localUserId || trackRef.participantId === localUserId)
  ));
  const cameraTrackRef = localTrackRefs.find((trackRef) => trackRef.source === Track.Source.Camera) || null;
  const screenShareTrackRef = localTrackRefs.find((trackRef) => trackRef.source === Track.Source.ScreenShare) || null;

  return {
    hasCamera: Boolean(cameraTrackRef),
    hasCameraTrack: cameraTrackRef?.state === VIDEO_TRACK_STATE_READY,
    cameraTrackRevision: cameraTrackRef?.revision || 0,
    hasScreenShare: Boolean(screenShareTrackRef),
    hasScreenShareTrack: screenShareTrackRef?.state === VIDEO_TRACK_STATE_READY,
    screenShareTrackRevision: screenShareTrackRef?.revision || 0,
    hasScreenShareAudio: Boolean(screenShareTrackRef?.hasAudio),
  };
}

export function buildRemoteMediaParticipantsFromTrackRefs(trackRefs = [], { localUserId = null } = {}) {
  const participants = new Map();

  trackRefs.forEach((trackRef) => {
    if (!trackRef?.participantId || trackRef.participantId === localUserId) {
      return;
    }

    const nextState = participants.get(trackRef.participantId) || {
      userId: trackRef.participantId,
      hasCamera: false,
      hasScreenShare: false,
      hasScreenShareAudio: false,
      cameraTrackRevision: 0,
      screenShareTrackRevision: 0,
    };

    if (trackRef.source === Track.Source.Camera) {
      nextState.hasCamera = true;
      nextState.cameraTrackRevision = Math.max(
        nextState.cameraTrackRevision,
        trackRef.revision || 0,
      );
    }

    if (trackRef.source === Track.Source.ScreenShare) {
      nextState.hasScreenShare = true;
      nextState.hasScreenShareAudio = nextState.hasScreenShareAudio || Boolean(trackRef.hasAudio);
      nextState.screenShareTrackRevision = Math.max(
        nextState.screenShareTrackRevision,
        trackRef.revision || 0,
      );
    }

    participants.set(trackRef.participantId, nextState);
  });

  return [...participants.values()].sort((a, b) => a.userId.localeCompare(b.userId));
}
