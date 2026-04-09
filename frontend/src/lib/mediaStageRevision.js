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
  hasScreenShare: false,
  hasScreenShareTrack: false,
  hasScreenShareAudio: false,
});

function buildRemoteMediaSignature(mediaParticipants = []) {
  return [...mediaParticipants]
    .map((participant) => (
      `${participant.userId}:${Number(participant.hasCamera)}:${Number(participant.hasScreenShare)}:${Number(participant.hasScreenShareAudio)}`
    ))
    .sort()
    .join("|");
}

export function buildMediaStageRevision({
  cameraEnabled = false,
  screenShareEnabled = false,
  localMediaState = EMPTY_LOCAL_MEDIA_STATE,
  mediaParticipants = [],
} = {}) {
  const remoteSignature = buildRemoteMediaSignature(mediaParticipants);

  return [
    Number(cameraEnabled),
    Number(screenShareEnabled),
    Number(Boolean(localMediaState?.hasCameraTrack)),
    Number(Boolean(localMediaState?.hasScreenShareTrack)),
    remoteSignature,
  ].join(":");
}
