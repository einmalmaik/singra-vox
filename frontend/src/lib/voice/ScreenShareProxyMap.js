/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

const SCREEN_SHARE_PROXY_IDENTITY_PREFIX = "screen-share";

function resolveParticipantIdentity(participant) {
  return participant?.identity || participant?.participantIdentity || null;
}

function resolveParticipantAttributes(participant) {
  return participant?.attributes || participant?.participantAttributes || {};
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

function buildParticipantEntry(participantIdentity, previousEntry, participant) {
  const nextAttributes = {
    ...(previousEntry?.attributes || {}),
    ...resolveParticipantAttributes(participant),
  };

  const userId = nextAttributes.owner_user_id
    || participant?.participantId
    || previousEntry?.userId
    || parseScreenShareProxyOwnerUserId(participantIdentity)
    || participantIdentity;

  return {
    participantIdentity,
    userId,
    attributes: nextAttributes,
    previousUserId: previousEntry?.userId || null,
  };
}

export class ScreenShareProxyMap {
  constructor() {
    this.participantsByIdentity = new Map();
  }

  clear() {
    this.participantsByIdentity.clear();
  }

  upsertParticipant(participant) {
    const participantIdentity = resolveParticipantIdentity(participant);
    if (!participantIdentity) {
      return null;
    }

    const previousEntry = this.participantsByIdentity.get(participantIdentity) || null;
    const nextEntry = buildParticipantEntry(participantIdentity, previousEntry, participant);
    this.participantsByIdentity.set(participantIdentity, nextEntry);
    return nextEntry;
  }

  getEntry(participantOrIdentity) {
    const participantIdentity = typeof participantOrIdentity === "string"
      ? participantOrIdentity
      : resolveParticipantIdentity(participantOrIdentity);

    if (!participantIdentity) {
      return null;
    }

    return this.participantsByIdentity.get(participantIdentity) || null;
  }

  resolveUserId(participantOrIdentity) {
    return this.getEntry(participantOrIdentity)?.userId || null;
  }

  removeParticipant(participantOrIdentity) {
    const participantIdentity = typeof participantOrIdentity === "string"
      ? participantOrIdentity
      : resolveParticipantIdentity(participantOrIdentity);

    if (!participantIdentity) {
      return false;
    }

    return this.participantsByIdentity.delete(participantIdentity);
  }
}

export function createScreenShareProxyMap() {
  return new ScreenShareProxyMap();
}
