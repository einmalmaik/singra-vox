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
import { clampUnit, clampVolume, computeRms, getAudioContextCtor } from "./voiceShared";

export const localAudioMethods = {
  async setInputDevice(deviceId) {
    await this.setPreferences({ inputDeviceId: deviceId });
  },

  async setOutputDevice(deviceId) {
    await this.setPreferences({ outputDeviceId: deviceId });
  },

  async setInputVolume(volume) {
    await this.setPreferences({ inputVolume: clampVolume(volume) });
  },

  async setOutputVolume(volume) {
    await this.setPreferences({ outputVolume: clampVolume(volume) });
  },

  async setParticipantVolume(userId, volume) {
    await this.setPreferences({
      perUserVolumes: {
        [userId]: clampVolume(volume),
      },
    });
    this._applyParticipantAudio(userId);
  },

  async setParticipantLocalMute(userId, muted) {
    await this.setPreferences({
      locallyMutedParticipants: {
        [userId]: Boolean(muted),
      },
    });
    this._applyParticipantAudio(userId);
  },

  async muteParticipant(userId, muted) {
    await this.setParticipantLocalMute(userId, muted);
  },

  toggleMute() {
    return this.setMuted(!this.isMuted);
  },

  toggleDeafen() {
    return this.setDeafened(!this.isDeafened);
  },

  setMuted(muted) {
    this.isMuted = Boolean(muted);
    void this._applyMuteState();
    this._emit("mute_change", { isMuted: this.isMuted });
    return this.isMuted;
  },

  setDeafened(deafened) {
    this.isDeafened = Boolean(deafened);
    this._applyRemoteAudioState();
    this._emitSpeakingState();
    this._emit("deafen_change", { isDeafened: this.isDeafened });
    return this.isDeafened;
  },

  setPTT(enabled) {
    this.preferences.pttEnabled = enabled;
    void this._applyMuteState();
  },

  setPTTActive(active) {
    this.pttActive = active;
    void this._applyMuteState();
  },

  async startMicTest() {
    if (this.micTestActive) {
      return;
    }

    await this._ensureAudioContext();

    const inputStream = this.localInputStream || await navigator.mediaDevices.getUserMedia({
      audio: this._audioConstraints(),
    });

    if (!this.localInputStream) {
      this.monitorStream = inputStream;
    }

    await this._attachAnalysisToStream(inputStream);
    await this._startMonitoringStream(inputStream);
    this.micTestActive = true;
    this.preferences.micTestEnabled = true;
    await this._applyMuteState();
    this._emit("mic_test_state", { enabled: true });
  },

  async stopMicTest() {
    if (!this.micTestActive && !this.monitorAudioElement) {
      return;
    }

    this.micTestActive = false;
    this.preferences.micTestEnabled = false;
    this._stopMonitoringStream();
    if (this.monitorStream && this.monitorStream !== this.localInputStream) {
      this.monitorStream.getTracks().forEach((track) => track.stop());
    }
    this.monitorStream = null;

    if (!this.localInputStream) {
      this._stopInputAnalysis();
    }

    await this._applyMuteState();
    this._emit("mic_test_state", { enabled: false });
  },

  getAudioLevel() {
    return this.localAudioLevel;
  },

  async getDevices(kind = "audioinput") {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === kind);
  },

  async restartLocalTrack() {
    if (!this.room) {
      return;
    }
    await this._publishLocalTrack();
    await this._applyMuteState();
  },

  async _probeInput() {
    try {
      const probeStream = await navigator.mediaDevices.getUserMedia({
        audio: this._audioConstraints(),
      });
      probeStream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      this.logger.warn("probe input failed, will retry on publish", { event: "input_probe" }, error);
    }
  },

  async _ensureAudioContext() {
    if (this.audioContext) {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      return;
    }

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      return;
    }

    this.audioContext = new AudioContextCtor();
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  },

  async _publishLocalTrack() {
    if (!this.room) {
      return;
    }

    if (this.localTrackPublication?.track) {
      await this.room.localParticipant.unpublishTrack(this.localTrackPublication.track, false);
    }
    this.localTrackPublication = null;
    this._stopLocalTrackResources();

    this.localInputStream = await navigator.mediaDevices.getUserMedia({
      audio: this._audioConstraints(),
    });
    const sourceTrack = this.localInputStream.getAudioTracks()[0];
    if (!sourceTrack) {
      throw new Error("No audio track available");
    }

    let publishedTrack = sourceTrack;
    if (this.audioContext) {
      const sourceNode = this.audioContext.createMediaStreamSource(this.localInputStream);
      this.inputGainNode = this.audioContext.createGain();
      this.inputDestination = this.audioContext.createMediaStreamDestination();
      sourceNode.connect(this.inputGainNode);
      this.inputGainNode.connect(this.inputDestination);
      this._applyInputGain();
      publishedTrack = this.inputDestination.stream.getAudioTracks()[0] || sourceTrack;
    }

    await this._attachAnalysisToStream(this.localInputStream);

    this.localPublishedTrack = publishedTrack;
    this.localTrackPublication = await this.room.localParticipant.publishTrack(publishedTrack, {
      source: Track.Source.Microphone,
      name: "microphone",
    });
  },

  _stopLocalTrackResources() {
    if (this.localPublishedTrack && this.localInputStream) {
      this.localInputStream.getTracks().forEach((track) => track.stop());
    } else if (this.localPublishedTrack) {
      this.localPublishedTrack.stop();
    }

    this.localPublishedTrack = null;
    this.localInputStream = null;
    this.inputGainNode = null;
    this.inputDestination = null;
    if (!this.micTestActive) {
      this._stopInputAnalysis();
    }
  },

  async _applyMuteState() {
    const shouldEnableMic = !(
      this.isMuted
      || this.micTestActive
      || (this.preferences.pttEnabled && !this.pttActive)
    );

    if (this.inputGainNode) {
      this.inputGainNode.gain.value = shouldEnableMic
        ? clampVolume(this.preferences.inputVolume, 0, 200) / 100
        : 0;
    }

    if (this.localPublishedTrack) {
      this.localPublishedTrack.enabled = shouldEnableMic;
    }

    if (this.localTrackPublication?.track) {
      try {
        if (shouldEnableMic) {
          await this.localTrackPublication.track.unmute();
        } else {
          await this.localTrackPublication.track.mute();
        }
      } catch {
        // The gain gate above is the hard fallback when wrappers disagree.
      }
    }
  },

  _applyInputGain() {
    if (this.inputGainNode) {
      this.inputGainNode.gain.value = clampVolume(this.preferences.inputVolume, 0, 200) / 100;
    }
  },

  _applyRemoteAudioState() {
    const participantIds = new Set(
      Array.from(this.audioElements.values()).map((state) => state.participantId),
    );
    this.room?.remoteParticipants?.forEach((participant) => {
      const participantUserId = this._resolveParticipantUserId(participant);
      if (participantUserId) {
        participantIds.add(participantUserId);
      }
    });

    participantIds.forEach((participantId) => {
      this._applyParticipantAudio(participantId);
    });
  },

  _applyParticipantAudio(userId) {
    const baseVolume = clampVolume(this.preferences.outputVolume, 0, 200) / 100;
    const participantVolume = clampVolume(
      this.preferences.perUserVolumes[userId] ?? 100,
      0,
      200,
    ) / 100;
    const locallyMuted = Boolean(this.preferences.locallyMutedParticipants?.[userId]);
    const shouldReceiveAudio = !(this.isDeafened || locallyMuted);
    const desiredVolume = shouldReceiveAudio ? Math.min(2, baseVolume * participantVolume) : 0;

    this.room?.remoteParticipants?.forEach((remoteParticipant) => {
      const participantUserId = this._resolveParticipantUserId(remoteParticipant);
      if (participantUserId !== userId) {
        return;
      }

      remoteParticipant.audioTrackPublications?.forEach((publication) => {
        if (!publication) {
          return;
        }

        if (typeof publication.setSubscribed === "function" && publication.isDesired !== shouldReceiveAudio) {
          publication.setSubscribed(shouldReceiveAudio);
        }

        if (typeof remoteParticipant.setVolume === "function") {
          const source = publication.source === Track.Source.ScreenShareAudio
            ? Track.Source.ScreenShareAudio
            : Track.Source.Microphone;
          remoteParticipant.setVolume(desiredVolume, source);
        }

        if (typeof publication.track?.setVolume === "function") {
          publication.track.setVolume(desiredVolume);
        }
      });
    });

    this.audioElements.forEach((state) => {
      if (state.participantId !== userId) {
        return;
      }

      state.element.muted = !shouldReceiveAudio;
      state.element.volume = desiredVolume;

      if (typeof state.publication?.track?.setVolume === "function") {
        state.publication.track.setVolume(desiredVolume);
      }

      if (!shouldReceiveAudio && state.track && state.attached) {
        try {
          state.track.detach(state.element);
        } catch {
          // Ignore detach races during rapid local mute/deafen toggles.
        }
        state.attached = false;
        state.element.srcObject = null;
      } else if (shouldReceiveAudio && state.track && !state.attached) {
        state.track.attach(state.element);
        state.attached = true;
      }

      if (shouldReceiveAudio) {
        if (state.playbackPaused) {
          state.playbackPaused = false;
          void state.element.play().catch(() => {
            state.playbackPaused = true;
          });
        }
      } else if (!state.playbackPaused) {
        state.element.pause();
        state.playbackPaused = true;
      }

      state.subscriptionEnabled = shouldReceiveAudio;
    });
  },

  _syncAudioPublicationState(participantId, publication, status = null) {
    if (!participantId) {
      return;
    }

    const publicationSource = publication?.source || null;
    this.audioElements.forEach((state) => {
      if (state.participantId !== participantId) {
        return;
      }
      if (publicationSource && state.source !== publicationSource) {
        return;
      }

      state.publication = publication || state.publication;
      if (publication?.track) {
        state.track = publication.track;
      }
      if (status) {
        state.subscriptionEnabled = status === "subscribed";
      } else if (typeof publication?.isSubscribed === "boolean") {
        state.subscriptionEnabled = publication.isSubscribed;
      }
    });
  },

  async _applyOutputDevice() {
    if (!this.room) {
      return;
    }

    const deviceId = this.preferences.outputDeviceId;
    if (!deviceId) {
      return;
    }

    try {
      if (typeof this.room.switchActiveDevice === "function") {
        await this.room.switchActiveDevice("audiooutput", deviceId);
      }
    } catch {
      await Promise.all(
        Array.from(this.audioElements.values()).map(async ({ element }) => {
          if (typeof element.setSinkId === "function") {
            try {
              await element.setSinkId(deviceId);
            } catch {
              // Ignore unsupported sink changes on this browser.
            }
          }
        }),
      );
    }
  },

  async _attachAnalysisToStream(stream) {
    await this._ensureAudioContext();
    if (!this.audioContext || !stream) {
      return;
    }

    if (this.analysisStream === stream && this.analyserNode) {
      return;
    }

    this._stopInputAnalysis();
    this.analysisStream = stream;
    this.analysisSourceNode = this.audioContext.createMediaStreamSource(stream);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analysisData = new Uint8Array(this.analyserNode.fftSize);
    this.analysisSourceNode.connect(this.analyserNode);
    this._tickInputLevel();
  },

  _tickInputLevel() {
    if (!this.analyserNode || !this.analysisData) {
      return;
    }

    this.analyserNode.getByteTimeDomainData(this.analysisData);
    const rms = computeRms(this.analysisData);
    this.autoSensitivityFloor = (this.autoSensitivityFloor * 0.96) + (rms * 0.04);
    if (this.preferences.autoInputSensitivity) {
      this.currentInputThreshold = clampUnit(this.autoSensitivityFloor * 2.8, 0.015, 0.22);
    } else {
      this.currentInputThreshold = this._resolveInputThreshold();
    }

    const normalizedLevel = clampUnit(rms * 6, 0, 1);
    this._emit("input_level", {
      level: normalizedLevel,
      rms,
      threshold: this.currentInputThreshold,
      aboveThreshold: rms >= this.currentInputThreshold,
    });

    this.analysisFrame = window.requestAnimationFrame(() => this._tickInputLevel());
  },

  _stopInputAnalysis() {
    if (this.analysisFrame) {
      window.cancelAnimationFrame(this.analysisFrame);
    }
    this.analysisFrame = null;
    this.analysisData = null;
    this.analysisStream = null;

    if (this.analysisSourceNode) {
      try {
        this.analysisSourceNode.disconnect();
      } catch {
        // ignore disconnect errors on disposed nodes
      }
    }
    if (this.analyserNode) {
      try {
        this.analyserNode.disconnect();
      } catch {
        // ignore disconnect errors on disposed nodes
      }
    }

    this.analysisSourceNode = null;
    this.analyserNode = null;
  },

  async _startMonitoringStream(stream) {
    await this._ensureAudioContext();
    if (!this.audioContext || !stream) {
      return;
    }

    this._stopMonitoringStream();

    this.monitorSourceNode = this.audioContext.createMediaStreamSource(stream);
    this.monitorGainNode = this.audioContext.createGain();
    this.monitorDestination = this.audioContext.createMediaStreamDestination();
    this.monitorSourceNode.connect(this.monitorGainNode);
    this.monitorGainNode.gain.value = clampVolume(this.preferences.inputVolume, 0, 200) / 100;
    this.monitorGainNode.connect(this.monitorDestination);

    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.playsInline = true;
    audio.style.display = "none";
    audio.srcObject = this.monitorDestination.stream;
    audio.volume = clampVolume(this.preferences.inputVolume, 0, 200) / 100;
    document.body.appendChild(audio);

    if (this.preferences.outputDeviceId && typeof audio.setSinkId === "function") {
      try {
        await audio.setSinkId(this.preferences.outputDeviceId);
      } catch {
        // ignore unsupported sink changes
      }
    }

    await audio.play().catch(() => {});
    this.monitorAudioElement = audio;
  },

  _stopMonitoringStream() {
    if (this.monitorAudioElement) {
      this.monitorAudioElement.pause();
      this.monitorAudioElement.remove();
      this.monitorAudioElement = null;
    }

    if (this.monitorSourceNode) {
      try {
        this.monitorSourceNode.disconnect();
      } catch {}
    }
    if (this.monitorGainNode) {
      try {
        this.monitorGainNode.disconnect();
      } catch {}
    }
    if (this.monitorDestination) {
      try {
        this.monitorDestination.disconnect?.();
      } catch {}
    }

    this.monitorSourceNode = null;
    this.monitorGainNode = null;
    this.monitorDestination = null;
  },

  _resolveInputThreshold() {
    const sensitivity = clampVolume(this.preferences.inputSensitivity ?? 40, 0, 100);
    return 0.015 + ((sensitivity / 100) * 0.185);
  },

  _requiresTrackRestart(nextPreferences) {
    return [
      "inputDeviceId",
      "noiseSuppression",
      "echoCancellation",
      "autoGainControl",
    ].some((key) => Object.prototype.hasOwnProperty.call(nextPreferences, key));
  },

  _audioConstraints() {
    const constraints = {
      echoCancellation: this.preferences.echoCancellation,
      noiseSuppression: this.preferences.noiseSuppression,
      autoGainControl: this.preferences.autoGainControl,
    };

    if (this.preferences.inputDeviceId) {
      constraints.deviceId = { exact: this.preferences.inputDeviceId };
    }

    return constraints;
  },
};
