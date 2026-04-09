/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { Track, RoomEvent } from "livekit-client";
import {
  VIDEO_TRACK_STATE_PENDING,
  VIDEO_TRACK_STATE_READY,
  buildLocalMediaStateFromTrackRefs,
  buildRemoteMediaParticipantsFromTrackRefs,
  buildVideoTrackRefId,
  findVideoTrackRef,
  indexVideoTrackRefs,
  sortVideoTrackRefs,
} from "@/lib/videoTrackRefs";

export const remoteMediaMethods = {
  _resolveParticipantIdentity(participant) {
    return participant?.identity || participant?.participantIdentity || null;
  },

  _syncParticipantStateFromLiveKit(participant) {
    const participantEntry = this.screenShareProxyMap.upsertParticipant(participant);
    if (!participantEntry) {
      return null;
    }

    this.audioElements.forEach((audioState) => {
      if (audioState.participantIdentity !== participantEntry.participantIdentity) {
        return;
      }
      audioState.participantId = participantEntry.userId;
    });

    if (
      participantEntry.previousUserId
      && participantEntry.previousUserId !== participantEntry.userId
    ) {
      this.remoteSpeakerIds = this.remoteSpeakerIds.map((speakerId) => (
        speakerId === participantEntry.previousUserId ? participantEntry.userId : speakerId
      ));
      this.activeSpeakerIds = this.activeSpeakerIds.map((speakerId) => (
        speakerId === participantEntry.previousUserId ? participantEntry.userId : speakerId
      ));
      this._emitSpeakingState();
    }

    return participantEntry;
  },

  _resolveParticipantUserId(participant) {
    return this._syncParticipantStateFromLiveKit(participant)?.userId || null;
  },

  _trackKey(participantIdentity, source) {
    return `${participantIdentity}:${source || "unknown"}`;
  },

  _clearRemoteVideoTrackRevisions() {
    this.remoteVideoTrackRevisions.clear();
  },

  _captureRemoteTrackRevision(participantIdentity, source, track) {
    const key = this._trackKey(participantIdentity, source);
    const previousState = this.remoteVideoTrackRevisions.get(key) || { track: null, revision: 0 };

    if (!track) {
      this.remoteVideoTrackRevisions.set(key, {
        ...previousState,
        track: null,
      });
      return previousState.revision || 0;
    }

    if (previousState.track === track) {
      const nextRevision = previousState.revision || 1;
      this.remoteVideoTrackRevisions.set(key, {
        track,
        revision: nextRevision,
      });
      return nextRevision;
    }

    const nextRevision = (previousState.revision || 0) + 1;
    this.remoteVideoTrackRevisions.set(key, {
      track,
      revision: nextRevision,
    });
    return nextRevision;
  },

  _removeRemoteTrackRevision(participantIdentity, source) {
    this.remoteVideoTrackRevisions.delete(this._trackKey(participantIdentity, source));
  },

  _getLocalVideoTrack(source) {
    if (source === Track.Source.Camera) {
      return this.cameraTrack;
    }
    if (source === Track.Source.ScreenShare) {
      return this.screenShareTracks.find((track) => track.kind === Track.Kind.Video) || null;
    }
    return null;
  },

  _captureLocalTrackRevision(source, track) {
    const slotKey = source === Track.Source.Camera
      ? "camera"
      : (source === Track.Source.ScreenShare ? "screenShare" : null);
    if (!slotKey) {
      return 0;
    }

    const slot = this.localVideoTrackRevisions[slotKey];
    if (!track) {
      slot.track = null;
      return slot.revision;
    }

    if (slot.track !== track) {
      slot.track = track;
      slot.revision += 1;
    }

    return slot.revision;
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

  _syncRemoteVideoPublication(participant, publication, { ensureSubscribed = false } = {}) {
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

    if (ensureSubscribed && typeof publication.setSubscribed === "function" && publication.isDesired !== true) {
      publication.setSubscribed(true);
    }

    const participantIdentity = this._resolveParticipantIdentity(participant);
    const source = publication.source || publication.track?.source || Track.Source.Unknown;
    this._captureRemoteTrackRevision(participantIdentity, source, publication.track || null);

    return {
      participantIdentity,
      participantId: participantEntry.userId,
      source,
      publication,
      track: publication.track || null,
    };
  },

  _ensureTrackRefSubscribed(trackRefId) {
    if (!trackRefId) {
      return false;
    }

    if (!this.videoTrackRefsById.has(trackRefId)) {
      this._syncVideoTrackRefs();
    }

    const trackRef = this.videoTrackRefsById.get(trackRefId) || null;
    if (!trackRef) {
      return false;
    }

    const isProxyBackedLocalTrack = Boolean(
      trackRef.isLocal
      && trackRef.source === Track.Source.ScreenShare
      && trackRef.provider === "tauri-native-livekit"
    );

    if (trackRef.isLocal && !isProxyBackedLocalTrack) {
      return Boolean(trackRef.track);
    }

    const publicationLookupIdentity = isProxyBackedLocalTrack
      ? (this.nativeScreenShare?.participantIdentity || trackRef.participantIdentity)
      : trackRef.participantIdentity;
    const { publication } = this._findRemoteVideoPublication(publicationLookupIdentity, trackRef.source);

    if (!publication) {
      return Boolean(trackRef.track);
    }

    if (typeof publication.setSubscribed === "function" && publication.isDesired !== true) {
      publication.setSubscribed(true);
    }

    return Boolean(publication.track || trackRef.track);
  },

  _syncExistingRemoteVideoPublications({ ensureSubscribed = false } = {}) {
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
        if (ensureSubscribed && typeof publication.setSubscribed === "function" && publication.isDesired !== true) {
          publication.setSubscribed(true);
        }
      });
    });

    if (didTouch) {
      this._emitRemoteMediaUpdate();
    }
    return didTouch;
  },

  _buildVideoTrackRefs() {
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
    const localCameraTrackRevision = this._captureLocalTrackRevision(
      Track.Source.Camera,
      localCameraTrack,
    );
    const localScreenShareTrackRevision = this._captureLocalTrackRevision(
      Track.Source.ScreenShare,
      localScreenShareTrack,
    );
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
        state: VIDEO_TRACK_STATE_READY,
        revision: localCameraTrackRevision,
        hasAudio: false,
        isLocal: true,
        provider: "livekit-local",
        track: localCameraTrack,
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
        state: localScreenShareTrack ? VIDEO_TRACK_STATE_READY : VIDEO_TRACK_STATE_PENDING,
        revision: localScreenShareTrackRevision,
        hasAudio: Boolean(this.nativeScreenShare?.hasAudio)
          || this.screenShareTracks.some((track) => track.source === Track.Source.ScreenShareAudio),
        isLocal: true,
        provider: this.nativeScreenShare?.provider || "livekit-local",
        sourceKind: this.nativeScreenShare?.sourceKind || null,
        sourceLabel: this.nativeScreenShare?.sourceLabel || null,
        publication: nativeScreenShareProxyState.publication || null,
        subscriptionStatus: nativeScreenShareProxyState.publication?.subscriptionStatus || null,
        streamState: nativeScreenShareProxyState.publication?.streamState || null,
        track: localScreenShareTrack,
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
        const revision = this._captureRemoteTrackRevision(participantIdentity, source, track);
        remoteTrackRefs.push({
          id: buildVideoTrackRefId({
            participantId: participantEntry.userId,
            source,
            isLocal: false,
          }),
          participantId: participantEntry.userId,
          participantIdentity,
          source,
          state: track ? VIDEO_TRACK_STATE_READY : VIDEO_TRACK_STATE_PENDING,
          revision,
          hasAudio: source === Track.Source.ScreenShare
            ? remoteScreenShareAudioParticipantIds.has(participantEntry.userId)
            : false,
          isLocal: false,
          provider: participantIdentity?.startsWith("screen-share:")
            ? "tauri-native-livekit"
            : "livekit-remote",
          publication,
          subscriptionStatus: publication.subscriptionStatus || null,
          streamState: publication.streamState || null,
          track,
        });
      });
    });

    return sortVideoTrackRefs([
      ...localTrackRefs,
      ...remoteTrackRefs,
    ]);
  },

  _stripTrackRef(trackRef) {
    if (!trackRef) {
      return null;
    }

    const { track, publication, ...publicTrackRef } = trackRef;
    return publicTrackRef;
  },

  _syncVideoTrackRefs() {
    const trackRefs = this._buildVideoTrackRefs();
    this.videoTrackRefsById = indexVideoTrackRefs(trackRefs);
    return trackRefs;
  },

  listVideoTrackRefs() {
    if (this.videoTrackRefsById.size === 0) {
      this._syncVideoTrackRefs();
    }

    return sortVideoTrackRefs(
      Array.from(this.videoTrackRefsById.values())
        .map((trackRef) => this._stripTrackRef(trackRef))
        .filter(Boolean),
    );
  },

  getVideoTrackRef(trackRefId) {
    if (!this.videoTrackRefsById.has(trackRefId)) {
      this._syncVideoTrackRefs();
    }

    return this._stripTrackRef(this.videoTrackRefsById.get(trackRefId) || null);
  },

  getVideoTrackRefId(participantId, source, { preferLocal = false } = {}) {
    const trackRef = findVideoTrackRef(
      this._syncVideoTrackRefs().map((nextTrackRef) => this._stripTrackRef(nextTrackRef)),
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
      this._buildVideoTrackRefs().map((trackRef) => this._stripTrackRef(trackRef)),
      { localUserId: this.userId },
    );
  },

  _emitRemoteMediaUpdate() {
    const trackRefs = this._syncVideoTrackRefs();
    const publicTrackRefs = trackRefs.map((trackRef) => this._stripTrackRef(trackRef));

    this._emit("media_tracks_update", {
      trackRefs: publicTrackRefs,
      participants: buildRemoteMediaParticipantsFromTrackRefs(publicTrackRefs, {
        localUserId: this.userId,
      }),
      local: {
        userId: this.userId,
        ...buildLocalMediaStateFromTrackRefs(publicTrackRefs, {
          localUserId: this.userId,
        }),
      },
    });
  },

  attachTrackRefElement(trackRefId, element) {
    if (!element) {
      return null;
    }

    if (!this.videoTrackRefsById.has(trackRefId)) {
      this._syncVideoTrackRefs();
    }

    this._ensureTrackRefSubscribed(trackRefId);

    if (!this.videoTrackRefsById.has(trackRefId)) {
      this._syncVideoTrackRefs();
    }

    const trackRef = this.videoTrackRefsById.get(trackRefId) || null;
    const track = trackRef?.track || null;
    if (!track) {
      return null;
    }

    element.autoplay = true;
    element.playsInline = true;
    element.muted = true;
    track.attach(element);

    const tryPlay = () => {
      void element.play?.().catch(() => {});
    };
    tryPlay();
    const playRetryTimer = setTimeout(tryPlay, 150);

    return () => {
      clearTimeout(playRetryTimer);
      try {
        element.pause?.();
        track.detach(element);
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

  _bindRoomEvents() {
    if (!this.room) {
      return;
    }

    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      this._syncParticipantStateFromLiveKit(participant);
      participant.trackPublications?.forEach?.((publication) => {
        const publicationKind = publication?.kind || publication?.track?.kind || null;
        if (publicationKind === Track.Kind.Video && typeof publication.setSubscribed === "function" && publication.isDesired !== true) {
          publication.setSubscribed(true);
        }
      });
      this._emitRemoteMediaUpdate();
    });

    this.room.on(RoomEvent.TrackPublished, (publication, participant) => {
      const publicationKind = publication?.kind || publication?.track?.kind || null;
      if (publicationKind === Track.Kind.Video && typeof publication.setSubscribed === "function" && publication.isDesired !== true) {
        publication.setSubscribed(true);
      }
      this._syncParticipantStateFromLiveKit(participant);
      this._emitRemoteMediaUpdate();
    });

    this.room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
      const source = track.source || Track.Source.Unknown;
      const participantIdentity = this._resolveParticipantIdentity(participant);
      const participantEntry = this._syncParticipantStateFromLiveKit(participant);
      if (!participantIdentity || !participantEntry?.userId) {
        return;
      }
      const trackKey = this._trackKey(participantIdentity, source);

      if (track.kind === Track.Kind.Audio) {
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
      } else if (track.kind === Track.Kind.Video) {
        this._captureRemoteTrackRevision(participantIdentity, source, track);
      }

      this._emitRemoteMediaUpdate();
      this._emit("peer_connected", { userId: participantEntry.userId, source, kind: track.kind });
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      const source = track.source || Track.Source.Unknown;
      const participantIdentity = this._resolveParticipantIdentity(participant);
      const participantUserId = this._resolveParticipantUserId(participant);
      if (!participantIdentity || !participantUserId) {
        return;
      }
      const trackKey = this._trackKey(participantIdentity, source);

      if (track.kind === Track.Kind.Audio) {
        const existing = this.audioElements.get(trackKey);
        if (existing) {
          track.detach(existing.element);
          existing.element.remove();
          this.audioElements.delete(trackKey);
        }
      } else if (track.kind === Track.Kind.Video) {
        this._captureRemoteTrackRevision(participantIdentity, source, null);
      }

      this._setRemoteSpeakerIds(
        this.remoteSpeakerIds.filter((speakerId) => speakerId !== participantUserId),
      );
      this._applyParticipantAudio(participantUserId);
      this._emitRemoteMediaUpdate();
      this._emit("peer_disconnected", { userId: participantUserId, source, kind: track.kind });
    });

    this.room.on(RoomEvent.TrackUnpublished, (publication, participant) => {
      const participantIdentity = this._resolveParticipantIdentity(participant);
      const source = publication?.source || publication?.track?.source || Track.Source.Unknown;
      if (!participantIdentity) {
        return;
      }

      this._removeRemoteTrackRevision(participantIdentity, source);
      this._emitRemoteMediaUpdate();
    });

    this.room.on(RoomEvent.ParticipantAttributesChanged, (_changedAttributes, participant) => {
      const participantEntry = this._syncParticipantStateFromLiveKit(participant);
      if (!participantEntry?.userId) {
        return;
      }

      this._applyParticipantAudio(participantEntry.userId);
      this._emitRemoteMediaUpdate();
    });

    const reapplyRemoteAudioState = (publication, participant, status = null) => {
      const participantUserId = this._resolveParticipantUserId(participant);
      if (!participantUserId || participantUserId === this.userId) {
        return;
      }
      if (publication?.kind && publication.kind !== Track.Kind.Audio) {
        return;
      }

      this._syncAudioPublicationState(participantUserId, publication, status);
      this._applyParticipantAudio(participantUserId);
    };

    this.room.on(RoomEvent.TrackMuted, (publication, participant) => {
      reapplyRemoteAudioState(publication, participant);
    });

    this.room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      reapplyRemoteAudioState(publication, participant);
    });

    this.room.on(RoomEvent.TrackSubscriptionStatusChanged, (publication, status, participant) => {
      reapplyRemoteAudioState(publication, participant, status);
      if ((publication?.kind || publication?.track?.kind) === Track.Kind.Video) {
        this._syncParticipantStateFromLiveKit(participant);
        this._emitRemoteMediaUpdate();
      }
    });

    this.room.on(RoomEvent.TrackStreamStateChanged, (publication, _streamState, participant) => {
      if ((publication?.kind || publication?.track?.kind) !== Track.Kind.Video) {
        return;
      }

      this._syncParticipantStateFromLiveKit(participant);
      this._emitRemoteMediaUpdate();
    });

    this.room.on(RoomEvent.Reconnected, () => {
      this._syncExistingRemoteVideoPublications({ ensureSubscribed: true });
    });

    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const remoteSpeakerIds = new Set();
      let localSpeaking = false;
      let localAudioLevel = 0;

      speakers.forEach((participant) => {
        const participantUserId = this._resolveParticipantUserId(participant);
        if (!participantUserId) {
          return;
        }
        if (participant.identity === this.userId) {
          localSpeaking = true;
          localAudioLevel = participant.audioLevel || 0;
          return;
        }
        if (participantUserId === this.userId) {
          return;
        }
        remoteSpeakerIds.add(participantUserId);
      });

      this.localSpeaking = localSpeaking;
      this.localAudioLevel = localAudioLevel;
      this.remoteSpeakerIds = [...remoteSpeakerIds];
      this._emitSpeakingState();
    });

    this.room.on(RoomEvent.Disconnected, (reason) => {
      this.forceCleanupForUnload("room_disconnected", { disconnectRoom: false });
      this.room = null;
      this.mediaE2EEController = null;
      this._clearRemoteMediaState();
      this._emit("disconnected", this._buildDisconnectedPayload(reason));
    });
  },

  _setRemoteSpeakerIds(activeSpeakerIds) {
    this.remoteSpeakerIds = activeSpeakerIds;
    this._emitSpeakingState();
  },

  _getVisibleActiveSpeakerIds() {
    if (this.isDeafened) {
      return [];
    }

    return this.remoteSpeakerIds.filter(
      (speakerId) => !this.preferences.locallyMutedParticipants?.[speakerId],
    );
  },

  _emitSpeakingState() {
    this.activeSpeakerIds = this._getVisibleActiveSpeakerIds();
    this._emit("speaking_update", {
      localSpeaking: this.localSpeaking,
      activeSpeakerIds: [...this.activeSpeakerIds],
      audioLevel: this.localAudioLevel,
    });
  },

  _resetSpeakingState() {
    this.localSpeaking = false;
    this.localAudioLevel = 0;
    this.remoteSpeakerIds = [];
    this.activeSpeakerIds = [];
    this._emit("speaking_update", {
      localSpeaking: false,
      activeSpeakerIds: [],
      audioLevel: 0,
    });
  },
};
