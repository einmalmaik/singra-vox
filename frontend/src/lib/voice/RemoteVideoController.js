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
import {
  buildLocalMediaStateFromTrackRefs,
  buildRemoteMediaParticipantsFromTrackRefs,
  buildVideoTrackRefId,
  findVideoTrackRef,
  sortVideoTrackRefs,
} from "@/lib/videoTrackRefs";

const ACTIVE_STREAM_STATE = "active";
const PLAYBACK_RECOVERY_DELAY_MS = 150;

function resolvePublicationId(publication) {
  return publication?.trackSid || publication?.sid || null;
}

function resolveTrackId(track) {
  return track?.sid || track?.mediaStreamTrack?.id || null;
}

function resolvePublicationStreamState(publication, track = publication?.track || null) {
  if (track?.streamState != null) {
    return track.streamState;
  }
  if (publication?.streamState != null) {
    return publication.streamState;
  }
  return track ? ACTIVE_STREAM_STATE : null;
}

function buildTrackRefProjectionSignature(trackRef, { publication = null, track = null } = {}) {
  return JSON.stringify({
    id: trackRef.id,
    participantId: trackRef.participantId || null,
    participantIdentity: trackRef.participantIdentity || null,
    source: trackRef.source || null,
    isAvailable: Boolean(trackRef.isAvailable),
    hasAudio: Boolean(trackRef.hasAudio),
    isLocal: Boolean(trackRef.isLocal),
    provider: trackRef.provider || null,
    sourceKind: trackRef.sourceKind || null,
    sourceLabel: trackRef.sourceLabel || null,
    publicationId: resolvePublicationId(publication),
    trackId: resolveTrackId(track),
    subscriptionStatus: publication?.subscriptionStatus || null,
    isMuted: Boolean(publication?.isMuted),
  });
}

export const remoteVideoMethods = {
  _getLocalVideoTrack(source) {
    if (source === Track.Source.Camera) {
      return this.cameraTrack;
    }
    if (source === Track.Source.ScreenShare) {
      return this.screenShareTracks.find((track) => track.kind === Track.Kind.Video) || null;
    }
    return null;
  },

  _getRemoteParticipantByIdentity(participantIdentity) {
    if (!this.room?.remoteParticipants || !participantIdentity) {
      return null;
    }

    if (typeof this.room.remoteParticipants.get === "function") {
      return this.room.remoteParticipants.get(participantIdentity) || null;
    }

    return Array.from(this.room.remoteParticipants.values?.() || [])
      .find((participant) => participant?.identity === participantIdentity) || null;
  },

  _findRemoteVideoPublication(participantIdentity, source) {
    const participant = this._getRemoteParticipantByIdentity(participantIdentity);
    if (!participant?.trackPublications) {
      return { participant, publication: null };
    }

    let publication = null;
    participant.trackPublications.forEach?.((candidate) => {
      if (publication) {
        return;
      }

      const candidateSource = candidate?.source || candidate?.track?.source || Track.Source.Unknown;
      const candidateKind = candidate?.kind || candidate?.track?.kind || null;
      if (candidateKind === Track.Kind.Video && candidateSource === source) {
        publication = candidate;
      }
    });

    return { participant, publication };
  },

  _getNativeScreenShareProxyPublicationState() {
    if (!this.nativeScreenShare?.participantIdentity) {
      return { participant: null, publication: null };
    }

    return this._findRemoteVideoPublication(
      this.nativeScreenShare.participantIdentity,
      Track.Source.ScreenShare,
    );
  },

  _isPublicationSubscribed(publication) {
    if (!publication) {
      return false;
    }
    if (typeof publication.isSubscribed === "boolean") {
      return publication.isSubscribed;
    }
    return publication.subscriptionStatus === "subscribed";
  },

  _isRemoteVideoPublicationAvailable(publication) {
    // In the JS SDK, adaptive stream may keep a subscribed video track in a
    // paused streamState until it is attached to a visible HTMLVideoElement.
    // Treating paused as unavailable creates a browser-only deadlock where the
    // stage never calls track.attach(), so the stream never resumes.
    return Boolean(
      publication?.track
      && this._isPublicationSubscribed(publication)
      && !publication?.isMuted
    );
  },

  _buildVideoTrackRefEntry(trackRef, { publication = null, track = null } = {}) {
    return {
      trackRef,
      signature: buildTrackRefProjectionSignature(trackRef, { publication, track }),
    };
  },

  _coalesceStableVideoTrackRefs(trackRefEntries, { commit = false } = {}) {
    const previousTrackRefsById = this.videoTrackRefsById || new Map();
    const previousSignaturesById = this.videoTrackRefProjectionSignaturesById || new Map();
    const nextTrackRefsById = new Map();
    const nextSignaturesById = new Map();

    trackRefEntries.forEach(({ trackRef, signature }) => {
      const previousTrackRef = previousTrackRefsById.get(trackRef.id) || null;
      const stableTrackRef = previousTrackRef && previousSignaturesById.get(trackRef.id) === signature
        ? previousTrackRef
        : trackRef;

      nextTrackRefsById.set(trackRef.id, stableTrackRef);
      nextSignaturesById.set(trackRef.id, signature);
    });

    if (commit) {
      this.videoTrackRefsById = nextTrackRefsById;
      this.videoTrackRefProjectionSignaturesById = nextSignaturesById;
    }

    return sortVideoTrackRefs(Array.from(nextTrackRefsById.values()));
  },

  _syncRemoteVideoPublication(participant, publication) {
    if (!participant || !publication) {
      return null;
    }

    const publicationKind = publication.kind || publication.track?.kind || null;
    if (publicationKind !== Track.Kind.Video) {
      return null;
    }

    const participantEntry = this._syncParticipantStateFromLiveKit(participant);
    if (!participantEntry) {
      return null;
    }

    const participantIdentity = this._resolveParticipantIdentity(participant);
    const source = publication.source || publication.track?.source || Track.Source.Unknown;

    return {
      participantIdentity,
      participantId: participantEntry.userId,
      source,
      publication,
      track: publication.track || null,
    };
  },

  _syncExistingRemoteVideoPublications() {
    if (!this.room?.remoteParticipants) {
      return false;
    }

    let didTouch = false;
    this.room.remoteParticipants.forEach?.((participant) => {
      this._syncParticipantStateFromLiveKit(participant);
      participant.trackPublications?.forEach?.((publication) => {
        const publicationKind = publication?.kind || publication?.track?.kind || null;
        if (publicationKind !== Track.Kind.Video) {
          return;
        }

        didTouch = true;
      });
    });

    if (didTouch) {
      this._emitRemoteMediaUpdate();
    }
    return didTouch;
  },

  _buildVideoTrackRefEntries() {
    // Track refs are a UI projection only. They intentionally describe which
    // stream slot exists and whether it is currently attachable, but they do
    // not cache LiveKit transport objects.
    const remoteScreenShareAudioParticipantIds = new Set(
      Array.from(this.audioElements.values())
        .filter((audioState) => audioState?.source === Track.Source.ScreenShareAudio)
        .map((audioState) => audioState.participantId)
        .filter(Boolean),
    );
    const localCameraTrack = this._getLocalVideoTrack(Track.Source.Camera);
    const nativeScreenShareProxyState = this._getNativeScreenShareProxyPublicationState();
    const nativeScreenShareProxyTrack = nativeScreenShareProxyState.publication?.track || null;
    const localScreenShareTrack = this._getLocalVideoTrack(Track.Source.ScreenShare)
      || nativeScreenShareProxyTrack
      || null;
    const localScreenShareAvailable = this.screenShareTracks.some((track) => track.kind === Track.Kind.Video)
      ? Boolean(localScreenShareTrack)
      : this._isRemoteVideoPublicationAvailable(nativeScreenShareProxyState.publication);
    const localTrackRefs = [];

    if (localCameraTrack) {
      localTrackRefs.push(this._buildVideoTrackRefEntry({
        id: buildVideoTrackRefId({
          participantId: this.userId,
          source: Track.Source.Camera,
          isLocal: true,
        }),
        participantId: this.userId,
        participantIdentity: this.userId,
        source: Track.Source.Camera,
        isAvailable: true,
        hasAudio: false,
        isLocal: true,
        provider: "livekit-local",
      }, {
        track: localCameraTrack,
      }));
    }

    if (this.nativeScreenShare || this.screenShareTracks.some((track) => track.kind === Track.Kind.Video)) {
      localTrackRefs.push(this._buildVideoTrackRefEntry({
        id: buildVideoTrackRefId({
          participantId: this.userId,
          source: Track.Source.ScreenShare,
          isLocal: true,
        }),
        participantId: this.userId,
        participantIdentity: this.nativeScreenShare?.participantIdentity || this.userId,
        source: Track.Source.ScreenShare,
        isAvailable: localScreenShareAvailable,
        hasAudio: Boolean(this.nativeScreenShare?.hasAudio)
          || this.screenShareTracks.some((track) => track.source === Track.Source.ScreenShareAudio),
        isLocal: true,
        provider: this.nativeScreenShare?.provider || "livekit-local",
        sourceKind: this.nativeScreenShare?.sourceKind || null,
        sourceLabel: this.nativeScreenShare?.sourceLabel || null,
      }, {
        publication: nativeScreenShareProxyState.publication,
        track: localScreenShareTrack,
      }));
    }

    const remoteTrackRefs = [];
    this.room?.remoteParticipants?.forEach((participant) => {
      const participantIdentity = this._resolveParticipantIdentity(participant);
      const participantEntry = this._syncParticipantStateFromLiveKit(participant);
      if (!participantIdentity || !participantEntry?.userId || participantEntry.userId === this.userId) {
        return;
      }

      participant.trackPublications?.forEach?.((publication) => {
        const source = publication?.source || publication?.track?.source || Track.Source.Unknown;
        const kind = publication?.kind || publication?.track?.kind || null;
        if (kind !== Track.Kind.Video) {
          return;
        }

        const track = publication.track || null;
        remoteTrackRefs.push(this._buildVideoTrackRefEntry({
          id: buildVideoTrackRefId({
            participantId: participantEntry.userId,
            source,
            isLocal: false,
          }),
          participantId: participantEntry.userId,
          participantIdentity,
          source,
          isAvailable: this._isRemoteVideoPublicationAvailable(publication),
          hasAudio: source === Track.Source.ScreenShare
            ? remoteScreenShareAudioParticipantIds.has(participantEntry.userId)
            : false,
          isLocal: false,
          provider: participantIdentity?.startsWith("screen-share:")
            ? "tauri-native-livekit"
            : "livekit-remote",
        }, {
          publication,
          track,
        }));
      });
    });

    return [
      ...localTrackRefs,
      ...remoteTrackRefs,
    ];
  },

  _buildVideoTrackRefs() {
    return this._coalesceStableVideoTrackRefs(this._buildVideoTrackRefEntries());
  },

  _syncVideoTrackRefs() {
    const trackRefs = this._coalesceStableVideoTrackRefs(
      this._buildVideoTrackRefEntries(),
      { commit: true },
    );
    return trackRefs;
  },

  listVideoTrackRefs() {
    this._syncVideoTrackRefs();
    return sortVideoTrackRefs(
      Array.from(this.videoTrackRefsById.values())
        .filter(Boolean),
    );
  },

  getVideoTrackRef(trackRefId) {
    this._syncVideoTrackRefs();
    return this.videoTrackRefsById.get(trackRefId) || null;
  },

  getVideoTrackRefId(participantId, source, { preferLocal = false } = {}) {
    const trackRef = findVideoTrackRef(
      this._syncVideoTrackRefs(),
      {
        participantId,
        source,
        preferLocal,
      },
    );

    return trackRef?.id || null;
  },

  _resolveStageTrack(participantId, source) {
    const trackRefId = this.getVideoTrackRefId(participantId, source, {
      preferLocal: participantId === this.userId,
    });
    return trackRefId
      ? this.videoTrackRefsById.get(trackRefId)?.track || null
      : null;
  },

  _buildRemoteMediaParticipants() {
    return buildRemoteMediaParticipantsFromTrackRefs(
      this._buildVideoTrackRefs(),
      { localUserId: this.userId },
    );
  },

  _emitRemoteMediaUpdate() {
    const trackRefs = this._syncVideoTrackRefs();

    this._emit("media_tracks_update", {
      trackRefs,
      participants: buildRemoteMediaParticipantsFromTrackRefs(trackRefs, {
        localUserId: this.userId,
      }),
      local: {
        userId: this.userId,
        ...buildLocalMediaStateFromTrackRefs(trackRefs, {
          localUserId: this.userId,
        }),
      },
    });
  },

  _resolveTrackBinding(trackRefId) {
    if (!trackRefId) {
      return null;
    }

    // Resolve the binding from the current Room/local-media state every time so
    // the stage never depends on stale cached transport objects.
    const trackRef = this.getVideoTrackRef(trackRefId);
    if (!trackRef) {
      return null;
    }

    if (trackRef.isLocal && trackRef.source === Track.Source.Camera) {
      return {
        trackRef,
        participant: null,
        publication: null,
        track: this.cameraTrack || null,
      };
    }

    if (trackRef.isLocal && trackRef.source === Track.Source.ScreenShare) {
      const localTrack = this._getLocalVideoTrack(Track.Source.ScreenShare);
      if (localTrack) {
        return {
          trackRef,
          participant: null,
          publication: null,
          track: localTrack,
        };
      }

      const proxyIdentity = this.nativeScreenShare?.participantIdentity || trackRef.participantIdentity;
      const { participant, publication } = this._findRemoteVideoPublication(
        proxyIdentity,
        Track.Source.ScreenShare,
      );

      return {
        trackRef,
        participant,
        publication,
        track: publication?.track || null,
      };
    }

    const { participant, publication } = this._findRemoteVideoPublication(
      trackRef.participantIdentity,
      trackRef.source,
    );

    return {
      trackRef,
      participant,
      publication,
      track: publication?.track || null,
    };
  },

  _isTrackBindingAttachable(binding) {
    if (!binding?.track) {
      return false;
    }
    if (!binding.publication) {
      return true;
    }
    return this._isRemoteVideoPublicationAvailable(binding.publication);
  },

  _clearTrackRefPlaybackRecovery(trackRefId = null) {
    if (!this.trackRefPlaybackRecoveryTimers?.size) {
      return;
    }

    if (trackRefId) {
      const timer = this.trackRefPlaybackRecoveryTimers.get(trackRefId);
      if (timer) {
        clearTimeout(timer);
        this.trackRefPlaybackRecoveryTimers.delete(trackRefId);
      }
      return;
    }

    this.trackRefPlaybackRecoveryTimers.forEach((timer) => clearTimeout(timer));
    this.trackRefPlaybackRecoveryTimers.clear();
  },

  ensureTrackRefPlayback(trackRefId) {
    const binding = this._resolveTrackBinding(trackRefId);
    const publication = binding?.publication || null;

    if (
      publication
      && typeof publication.setSubscribed === "function"
      && (
        !binding?.track
        || !this._isPublicationSubscribed(publication)
      )
    ) {
      this.logger.debug("track playback intent requested", {
        event: "track_playback_intent",
        trackRefId,
        participantId: binding?.trackRef?.participantId || null,
        source: binding?.trackRef?.source || null,
        subscriptionStatus: publication.subscriptionStatus || null,
        isSubscribed: this._isPublicationSubscribed(publication),
        streamState: resolvePublicationStreamState(publication),
        isMuted: Boolean(publication.isMuted),
        hasTrack: Boolean(binding?.track),
      });
      publication.setSubscribed(true);
    }

    return this._isTrackBindingAttachable(binding);
  },

  recoverTrackRefPlayback(trackRefId) {
    const binding = this._resolveTrackBinding(trackRefId);
    const publication = binding?.publication || null;
    if (!publication || typeof publication.setSubscribed !== "function") {
      return false;
    }

    this._clearTrackRefPlaybackRecovery(trackRefId);
    this.logger.debug("track playback recovery requested", {
      event: "track_playback_recovery",
      trackRefId,
      participantId: binding?.trackRef?.participantId || null,
      source: binding?.trackRef?.source || null,
      subscriptionStatus: publication.subscriptionStatus || null,
      streamState: resolvePublicationStreamState(publication),
      isMuted: Boolean(publication.isMuted),
      hasTrack: Boolean(binding?.track),
    });

    try {
      if (publication.isDesired === false || publication.subscriptionStatus === "unsubscribed") {
        publication.setSubscribed(true);
        return true;
      }

      publication.setSubscribed(false);
      const recoveryTimer = setTimeout(() => {
        this.trackRefPlaybackRecoveryTimers.delete(trackRefId);
        try {
          const latestPublication = this._resolveTrackBinding(trackRefId)?.publication || publication;
          latestPublication?.setSubscribed?.(true);
        } catch (error) {
          this.logger.warn("track playback recovery resubscribe failed", {
            event: "track_playback_recovery_resubscribe",
            trackRefId,
          }, error);
        }
      }, PLAYBACK_RECOVERY_DELAY_MS);

      this.trackRefPlaybackRecoveryTimers.set(trackRefId, recoveryTimer);
      return true;
    } catch (error) {
      this.logger.warn("track playback recovery failed", {
        event: "track_playback_recovery_failed",
        trackRefId,
      }, error);
      return false;
    }
  },

  attachTrackRefElement(trackRefId, element) {
    if (!element) {
      return null;
    }

    this.logger.debug("track attach requested", {
      event: "track_attach_requested",
      trackRefId,
    });
    const binding = this._resolveTrackBinding(trackRefId);
    const trackRef = binding?.trackRef || null;
    const track = binding?.track || null;
    if (!this._isTrackBindingAttachable(binding)) {
      this.logger.debug("track attach deferred because no track is available yet", {
        event: "track_attach_pending",
        trackRefId,
        participantId: trackRef?.participantId || null,
        source: trackRef?.source || null,
        hasTrack: Boolean(track),
        subscriptionStatus: binding?.publication?.subscriptionStatus || null,
        isSubscribed: this._isPublicationSubscribed(binding?.publication),
        streamState: resolvePublicationStreamState(binding?.publication, track),
        isMuted: Boolean(binding?.publication?.isMuted),
      });
      return null;
    }

    element.autoplay = true;
    element.playsInline = true;
    element.muted = true;
    track.attach(element);
    this.logger.debug("track attached to stage element", {
      event: "track_attach_bound",
      trackRefId,
      participantId: trackRef?.participantId || null,
      source: trackRef?.source || null,
    });

    return () => {
      try {
        element.pause?.();
        track.detach(element);
        this.logger.debug("track detached from stage element", {
          event: "track_attach_released",
          trackRefId,
          participantId: trackRef?.participantId || null,
          source: trackRef?.source || null,
        });
      } catch {
        // Ignore detach races during rapid overlay changes.
      }
    };
  },

  attachParticipantMediaElement(participantId, source, element) {
    const normalizedSource = source || Track.Source.Camera;
    const trackRefId = this.getVideoTrackRefId(participantId, normalizedSource, {
      preferLocal: participantId === this.userId,
    });
    if (!trackRefId) {
      return null;
    }
    return this.attachTrackRefElement(trackRefId, element);
  },
};
