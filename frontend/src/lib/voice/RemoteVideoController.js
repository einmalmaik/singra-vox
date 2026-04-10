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
  indexVideoTrackRefs,
  sortVideoTrackRefs,
} from "@/lib/videoTrackRefs";

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

  _buildVideoTrackRefs() {
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
    const localTrackRefs = [];

    if (localCameraTrack) {
      localTrackRefs.push({
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
      });
    }

    if (this.nativeScreenShare || this.screenShareTracks.some((track) => track.kind === Track.Kind.Video)) {
      localTrackRefs.push({
        id: buildVideoTrackRefId({
          participantId: this.userId,
          source: Track.Source.ScreenShare,
          isLocal: true,
        }),
        participantId: this.userId,
        participantIdentity: this.nativeScreenShare?.participantIdentity || this.userId,
        source: Track.Source.ScreenShare,
        isAvailable: Boolean(localScreenShareTrack),
        hasAudio: Boolean(this.nativeScreenShare?.hasAudio)
          || this.screenShareTracks.some((track) => track.source === Track.Source.ScreenShareAudio),
        isLocal: true,
        provider: this.nativeScreenShare?.provider || "livekit-local",
        sourceKind: this.nativeScreenShare?.sourceKind || null,
        sourceLabel: this.nativeScreenShare?.sourceLabel || null,
      });
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
        remoteTrackRefs.push({
          id: buildVideoTrackRefId({
            participantId: participantEntry.userId,
            source,
            isLocal: false,
          }),
          participantId: participantEntry.userId,
          participantIdentity,
          source,
          isAvailable: Boolean(track),
          hasAudio: source === Track.Source.ScreenShare
            ? remoteScreenShareAudioParticipantIds.has(participantEntry.userId)
            : false,
          isLocal: false,
          provider: participantIdentity?.startsWith("screen-share:")
            ? "tauri-native-livekit"
            : "livekit-remote",
        });
      });
    });

    return sortVideoTrackRefs([
      ...localTrackRefs,
      ...remoteTrackRefs,
    ]);
  },

  _syncVideoTrackRefs() {
    const trackRefs = this._buildVideoTrackRefs();
    this.videoTrackRefsById = indexVideoTrackRefs(trackRefs);
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

  ensureTrackRefPlayback(trackRefId) {
    const binding = this._resolveTrackBinding(trackRefId);
    const publication = binding?.publication || null;

    if (publication && typeof publication.setSubscribed === "function" && publication.isDesired !== true) {
      this.logger.debug("track playback intent requested", {
        event: "track_playback_intent",
        trackRefId,
        participantId: binding?.trackRef?.participantId || null,
        source: binding?.trackRef?.source || null,
      });
      publication.setSubscribed(true);
      return true;
    }

    return Boolean(binding?.track);
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
    if (!track) {
      this.logger.debug("track attach deferred because no track is available yet", {
        event: "track_attach_pending",
        trackRefId,
        participantId: trackRef?.participantId || null,
        source: trackRef?.source || null,
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
