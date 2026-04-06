/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
/**
 * LiveKitTransport – Schicht für LiveKit-Room-Lifecycle
 *
 * Verantwortlich für:
 *  - Room erstellen, verbinden, trennen
 *  - Track publizieren / zurückziehen
 *  - Room-Events via Callback-Map nach oben weiterleiten
 *  - switchActiveDevice, startAudio, setE2EEEnabled
 *
 * Kein WebAudio, kein Tauri, keine API-Calls.
 * VoiceEngine injiziert die Callbacks im Konstruktor.
 */

import { Room, RoomEvent, Track } from "livekit-client";

export class LiveKitTransport {
  /**
   * @param {Object} callbacks
   * @param {Function} [callbacks.onTrackSubscribed]
   * @param {Function} [callbacks.onTrackUnsubscribed]
   * @param {Function} [callbacks.onTrackMuted]
   * @param {Function} [callbacks.onTrackUnmuted]
   * @param {Function} [callbacks.onTrackSubscriptionStatusChanged]
   * @param {Function} [callbacks.onActiveSpeakersChanged]
   * @param {Function} [callbacks.onDisconnected]
   */
  constructor(callbacks = {}) {
    /** @type {Room|null} */
    this.room = null;
    this._callbacks = callbacks;
  }

  // ── Room-Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Erstellt einen neuen Room, bindet Events und verbindet ihn mit dem Server.
   * @param {string} serverUrl
   * @param {string} participantToken
   * @param {Object} roomOptions  Optionen für den Room-Konstruktor (z.B. encryption)
   */
  async connect(serverUrl, participantToken, roomOptions = {}) {
    if (this.room) {
      await this.disconnect();
    }
    this.room = new Room(roomOptions);
    this._bindEvents();
    await this.room.connect(serverUrl, participantToken);
    return this.room;
  }

  async disconnect() {
    if (!this.room) return;
    this.room.disconnect();
    this.room = null;
  }

  // ── Track-Management ────────────────────────────────────────────────────────

  async publishTrack(track, options = {}) {
    return this.room?.localParticipant.publishTrack(track, options);
  }

  async unpublishTrack(track, stopOnUnpublish = false) {
    return this.room?.localParticipant.unpublishTrack(track, stopOnUnpublish);
  }

  // ── Room-Capabilities ───────────────────────────────────────────────────────

  async startAudio() {
    if (typeof this.room?.startAudio === "function") {
      await this.room.startAudio();
    }
  }

  async setE2EEEnabled(enabled) {
    if (typeof this.room?.setE2EEEnabled === "function") {
      await this.room.setE2EEEnabled(enabled);
    }
  }

  async switchActiveDevice(kind, deviceId) {
    if (typeof this.room?.switchActiveDevice === "function") {
      await this.room.switchActiveDevice(kind, deviceId);
    }
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  get remoteParticipants() {
    return this.room?.remoteParticipants ?? new Map();
  }

  get localParticipant() {
    return this.room?.localParticipant ?? null;
  }

  get isConnected() {
    return Boolean(this.room);
  }

  // ── Interne Event-Bindung ───────────────────────────────────────────────────

  _bindEvents() {
    if (!this.room) return;
    const cb = this._callbacks;

    this.room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      cb.onTrackSubscribed?.(track, publication, participant);
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      cb.onTrackUnsubscribed?.(track, publication, participant);
    });

    this.room.on(RoomEvent.TrackMuted, (publication, participant) => {
      cb.onTrackMuted?.(publication, participant);
    });

    this.room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      cb.onTrackUnmuted?.(publication, participant);
    });

    this.room.on(RoomEvent.TrackSubscriptionStatusChanged, (publication, status, participant) => {
      cb.onTrackSubscriptionStatusChanged?.(publication, status, participant);
    });

    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      cb.onActiveSpeakersChanged?.(speakers);
    });

    this.room.on(RoomEvent.Disconnected, () => {
      cb.onDisconnected?.();
    });
  }
}
