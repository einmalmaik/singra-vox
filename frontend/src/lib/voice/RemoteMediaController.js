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

  _bindRoomEvents() {
    if (!this.room) {
      return;
    }

    this.room.on(RoomEvent.ParticipantConnected, (participant) => {
      this.logger.debug("participant connected", {
        event: "participant_connected",
        participantIdentity: this._resolveParticipantIdentity(participant),
      });
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
      this.logger.debug("track published", {
        event: "track_published",
        participantIdentity: this._resolveParticipantIdentity(participant),
        source: publication?.source || publication?.track?.source || null,
        kind: publication?.kind || publication?.track?.kind || null,
      });
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
      this.logger.debug("track subscribed", {
        event: "track_subscribed",
        participantIdentity,
        participantId: participantEntry.userId,
        source,
        kind: track.kind,
      });
      if (track.kind === Track.Kind.Audio) {
        await this._attachRemoteAudioTrack(
          track,
          publication,
          participantEntry,
          participantIdentity,
          source,
        );
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
      this.logger.debug("track unsubscribed", {
        event: "track_unsubscribed",
        participantIdentity,
        participantId: participantUserId,
        source,
        kind: track.kind,
      });
      if (track.kind === Track.Kind.Audio) {
        this._detachRemoteAudioTrack(track, participantIdentity, source);
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
        this.logger.debug("video subscription status changed", {
          event: "track_subscription_status_changed",
          participantIdentity: this._resolveParticipantIdentity(participant),
          source: publication?.source || publication?.track?.source || null,
          status,
        });
        this._syncParticipantStateFromLiveKit(participant);
        this._emitRemoteMediaUpdate();
      }
    });

    this.room.on(RoomEvent.TrackStreamStateChanged, (publication, _streamState, participant) => {
      if ((publication?.kind || publication?.track?.kind) !== Track.Kind.Video) {
        return;
      }

      this.logger.debug("video stream state changed", {
        event: "track_stream_state_changed",
        participantIdentity: this._resolveParticipantIdentity(participant),
        source: publication?.source || publication?.track?.source || null,
        streamState: publication?.streamState || null,
      });
      this._syncParticipantStateFromLiveKit(participant);
      this._emitRemoteMediaUpdate();
    });

    this.room.on(RoomEvent.Reconnected, () => {
      this.logger.debug("room reconnected", { event: "room_reconnected" });
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
