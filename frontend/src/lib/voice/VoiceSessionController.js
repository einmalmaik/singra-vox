/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import api from "@/lib/api";
import { DisconnectReason, Room } from "livekit-client";
import { getDefaultVoicePreferences } from "@/lib/voicePreferences";

export const voiceSessionMethods = {
  addStateListener(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  },

  async init(optionsOrDeviceId = null) {
    if (typeof optionsOrDeviceId === "string") {
      await this.setInputDevice(optionsOrDeviceId);
      return;
    }

    if (optionsOrDeviceId?.serverId) {
      this.serverId = optionsOrDeviceId.serverId;
      this.channelId = optionsOrDeviceId.channelId;
    }

    if (optionsOrDeviceId?.userId) {
      this.userId = optionsOrDeviceId.userId;
    }

    if (optionsOrDeviceId?.preferences) {
      this.preferences = {
        ...getDefaultVoicePreferences(),
        ...this.preferences,
        ...optionsOrDeviceId.preferences,
      };
      this.currentInputThreshold = this._resolveInputThreshold();
    }

    if (optionsOrDeviceId?.runtimeConfig) {
      this.runtimeConfig = optionsOrDeviceId.runtimeConfig;
    }

    await this._probeInput();
  },

  getPreferences() {
    return {
      ...this.preferences,
      perUserVolumes: { ...this.preferences.perUserVolumes },
      locallyMutedParticipants: { ...this.preferences.locallyMutedParticipants },
    };
  },

  async setPreferences(nextPreferences = {}) {
    this.preferences = {
      ...this.preferences,
      ...nextPreferences,
      perUserVolumes: {
        ...this.preferences.perUserVolumes,
        ...(nextPreferences.perUserVolumes || {}),
      },
      locallyMutedParticipants: {
        ...this.preferences.locallyMutedParticipants,
        ...(nextPreferences.locallyMutedParticipants || {}),
      },
    };

    this.currentInputThreshold = this._resolveInputThreshold();
    this._applyInputGain();
    this._applyRemoteAudioState();
    this._emitSpeakingState();

    if (this.room && this._requiresTrackRestart(nextPreferences)) {
      await this.restartLocalTrack();
    } else if (this.room && this.cameraTrack && Object.prototype.hasOwnProperty.call(nextPreferences, "cameraDeviceId")) {
      const nextCameraDeviceId = this.preferences.cameraDeviceId;
      if (nextCameraDeviceId && typeof this.room.switchActiveDevice === "function") {
        await this.room.switchActiveDevice("videoinput", nextCameraDeviceId);
      } else {
        await this.stopCamera();
        await this.toggleCamera();
      }
    } else if (this.room && Object.prototype.hasOwnProperty.call(nextPreferences, "outputDeviceId")) {
      await this._applyOutputDevice();
    }

    if (this.monitorAudioElement) {
      this.monitorAudioElement.volume = this.preferences.inputVolume / 100;
    }

    if (Object.prototype.hasOwnProperty.call(nextPreferences, "micTestEnabled")) {
      if (this.preferences.micTestEnabled) {
        await this.startMicTest();
      } else {
        await this.stopMicTest();
      }
    }
  },

  async joinChannel() {
    if (!this.serverId || !this.channelId) {
      throw new Error("VoiceEngine requires serverId and channelId before joining");
    }

    const tokenResponse = await api.post("/voice/token", {
      server_id: this.serverId,
      channel_id: this.channelId,
    });

    if (this.room) {
      await this.disconnect();
    }

    let encryptionOptions;
    if (tokenResponse.data.e2ee_required && this.runtimeConfig?.isDesktop) {
      const { createEncryptedMediaController } = await import("@/lib/e2ee/media");
      this.mediaE2EEController = await createEncryptedMediaController(this.runtimeConfig, this.channelId);
      encryptionOptions = this.mediaE2EEController.encryption;
    }

    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      webAudioMix: false,
      autoSubscribe: true,
      encryption: encryptionOptions,
    });

    this._bindRoomEvents();

    await this.room.connect(
      tokenResponse.data.server_url,
      tokenResponse.data.participant_token,
    );

    const safeRun = async (label, event, fn) => {
      try {
        await fn();
      } catch (error) {
        this.logger.warn(`${label} failed during join`, { event }, error);
      }
    };

    await safeRun("e2ee bootstrap", "join_e2ee", async () => {
      if (tokenResponse.data.e2ee_required && typeof this.room.setE2EEEnabled === "function") {
        await this.room.setE2EEEnabled(true);
      }
    });

    await safeRun("room audio start", "join_start_audio", async () => {
      if (typeof this.room.startAudio === "function") {
        await this.room.startAudio();
      }
    });

    await safeRun("audio context", "join_audio_context", () => this._ensureAudioContext());
    await safeRun("local publish", "join_local_publish", () => this._publishLocalTrack());
    await safeRun("output device", "join_output_device", () => this._applyOutputDevice());
    await safeRun("remote audio state", "join_remote_audio", () => this._applyRemoteAudioState());
    await safeRun("remote video sync", "join_remote_video", async () => {
      this._syncExistingRemoteVideoPublications({ ensureSubscribed: true });
    });
    await safeRun("mute state", "join_mute_state", () => this._applyMuteState());
    await safeRun("native screen share state", "join_native_rehydrate", () => this._rehydrateNativeScreenShareSession());

    this._emit("connected");
  },

  handleSignal() {
    // LiveKit uses its own SFU transport, so browser-side signaling is not needed.
  },

  _runLifecycleAction(key, task) {
    return this.runSingleFlight(key, task);
  },

  _buildDisconnectedPayload(reason = DisconnectReason.CLIENT_INITIATED) {
    const reasonCode = typeof reason === "number" ? reason : -1;
    return {
      reason: reasonCode,
      wasClientInitiated: reasonCode === DisconnectReason.CLIENT_INITIATED,
      wasDuplicateIdentity: reasonCode === DisconnectReason.DUPLICATE_IDENTITY,
    };
  },

  _clearRemoteMediaState() {
    this.audioElements.forEach(({ element }) => {
      try {
        element.pause?.();
      } catch {
        // Ignore paused/removed element races during disconnect cleanup.
      }
      element.remove?.();
    });
    this.audioElements.clear();
    this.screenShareProxyMap.clear();
    this._clearRemoteVideoTrackRevisions();
    this._resetSpeakingState();
    this._emitRemoteMediaUpdate();
  },

  _emitScreenShareDisabled(stopReason = "manual", previousCaptureMode = null) {
    this._emitRemoteMediaUpdate();
    this._emit("screen_share_change", {
      enabled: false,
      provider: null,
      sourceId: null,
      sourceKind: null,
      sourceLabel: null,
      hasAudio: false,
      actualCaptureSettings: null,
      captureMode: null,
      previousCaptureMode,
      stopReason,
    });
  },

  forceCleanupForUnload(stopReason = "window_unload", { disconnectRoom = true } = {}) {
    const hadScreenShare = Boolean(this.nativeScreenShare) || this.screenShareTracks.length > 0;
    const hadCamera = Boolean(this.cameraTrack);
    const activeShare = this.nativeScreenShare;
    const previousCaptureMode = null;

    activeShare?.keySubscriptionCleanup?.();
    this.screenShareTracks.forEach((track) => track.stop?.());
    this.screenShareTracks = [];
    this.nativeScreenShare = null;
    this._cleanupScreenShareAudioGain();

    if (this.cameraTrack) {
      this.cameraTrack.stop?.();
      this.cameraTrack = null;
    }

    this._stopLocalTrackResources();
    this._stopMonitoringStream();
    this._stopInputAnalysis();
    this.micTestActive = false;

    if (disconnectRoom && this.room) {
      try {
        void this.room.disconnect();
      } catch {
        // Ignore room teardown failures during page close.
      }
    }

    if (hadCamera) {
      if (!hadScreenShare) {
        this._emitRemoteMediaUpdate();
      }
      this._emit("camera_change", { enabled: false });
    }
    if (hadScreenShare) {
      this._emitScreenShareDisabled(stopReason, previousCaptureMode);
    }
  },

  async disconnect() {
    return this._runLifecycleAction("disconnect", async () => {
      const room = this.room;

      const safeCleanup = async (label, event, task) => {
        try {
          await task();
        } catch (error) {
          this.logger.warn(`${label} cleanup failed`, { event }, error);
        }
      };

      await safeCleanup("screen share", "disconnect_screen_share", () => this.stopScreenShare({ stopReason: "disconnect" }));

      if (room?.localParticipant && this.localTrackPublication?.track) {
        await safeCleanup("microphone", "disconnect_microphone", () => room.localParticipant.unpublishTrack(this.localTrackPublication.track, false));
      }

      this.localTrackPublication = null;
      await safeCleanup("camera", "disconnect_camera", () => this.stopCamera());
      this._stopLocalTrackResources();
      await safeCleanup("mic test", "disconnect_mic_test", () => this.stopMicTest());

      this.room = null;
      this.mediaE2EEController = null;

      if (room) {
        try {
          await room.disconnect();
          return;
        } catch (error) {
          this.logger.warn("room disconnect failed", { event: "disconnect_room" }, error);
        }
      }

      this._clearRemoteMediaState();
      this._emit("disconnected", this._buildDisconnectedPayload());
    });
  },

  async syncEncryptedMediaParticipants(participantUserIds, reason = "membership") {
    if (!this.mediaE2EEController) {
      return { rotated: false, keyVersion: null, participantUserIds: [] };
    }
    return this.mediaE2EEController.syncParticipantSet(participantUserIds, reason);
  },

  _emit(type, extra = {}) {
    const payload = { type, ...extra };
    this.onStateChange?.(payload);
    this.listeners.forEach((listener) => listener(payload));
  },
};
