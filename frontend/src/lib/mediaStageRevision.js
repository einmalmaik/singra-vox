/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
export const EMPTY_LOCAL_MEDIA_STATE = Object.freeze({
  hasCamera: false,
  hasCameraTrack: false,
  cameraTrackRevision: 0,
  hasScreenShare: false,
  hasScreenShareTrack: false,
  screenShareTrackRevision: 0,
  hasScreenShareAudio: false,
});

function buildTrackRefStageState(trackRef = {}) {
  return [
    trackRef.id || "unknown",
    trackRef.state || "missing",
    Number(trackRef.revision || 0),
    Number(Boolean(trackRef.hasAudio)),
    trackRef.subscriptionStatus || "none",
    trackRef.streamState || "none",
  ].join(":");
}

function buildTrackRefSignature(trackRefs = []) {
  return [...trackRefs]
    .map((trackRef) => buildTrackRefStageState(trackRef))
    .sort()
    .join("|");
}

export function buildMediaStageRevision({
  selectedTrackRefId = null,
  trackRefs = [],
} = {}) {
  const selectedTrackRef = selectedTrackRefId
    ? trackRefs.find((trackRef) => trackRef.id === selectedTrackRefId) || null
    : null;

  return [
    selectedTrackRefId || "none",
    buildTrackRefStageState(selectedTrackRef),
    buildTrackRefSignature(trackRefs),
  ].join(":");
}
