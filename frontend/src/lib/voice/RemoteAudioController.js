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

export const remoteAudioMethods = {
  async _attachRemoteAudioTrack(track, publication, participantEntry, participantIdentity, source) {
    if (track.kind !== Track.Kind.Audio || !participantEntry?.userId || !participantIdentity) {
      return false;
    }

    const trackKey = this._trackKey(participantIdentity, source);
    const existing = this.audioElements.get(trackKey);
    if (existing) {
      try {
        existing.track?.detach?.(existing.element);
      } catch {
        // Ignore stale detach failures while swapping subscriptions.
      }
      existing.element?.remove?.();
      this.audioElements.delete(trackKey);
    }

    const audioEl = track.attach();
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.style.display = "none";
    document.body.appendChild(audioEl);
    this.audioElements.set(trackKey, {
      element: audioEl,
      track,
      participantId: participantEntry.userId,
      participantIdentity,
      source,
      publication,
      subscriptionEnabled: true,
      attached: true,
      playbackPaused: false,
    });
    this._applyParticipantAudio(participantEntry.userId);

    if (this.preferences.outputDeviceId && typeof audioEl.setSinkId === "function") {
      try {
        await audioEl.setSinkId(this.preferences.outputDeviceId);
      } catch {
        // Ignore unsupported sink changes on this browser.
      }
    }

    return true;
  },

  _detachRemoteAudioTrack(track, participantIdentity, source) {
    if (track.kind !== Track.Kind.Audio || !participantIdentity) {
      return false;
    }

    const existing = this.audioElements.get(this._trackKey(participantIdentity, source));
    if (!existing) {
      return false;
    }

    track.detach(existing.element);
    existing.element.remove();
    this.audioElements.delete(this._trackKey(participantIdentity, source));
    return true;
  },
};
