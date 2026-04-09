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
import { createLocalScreenTracks, Track } from "livekit-client";
import {
  getNativeScreenShareSession,
  startNativeScreenShare,
  stopNativeScreenShare,
  updateNativeScreenShareAudioVolume,
  updateNativeScreenShareKey,
} from "@/lib/desktop";
import { buildScreenSharePublishOptions, DEFAULT_SCREEN_SHARE_PRESET_ID } from "@/lib/screenSharePresets";
import { buildVoiceRoomName, clampVolume } from "./voiceShared";

export const screenShareMethods = {
  async toggleScreenShare(options = {}) {
    if (!this.room) {
      return false;
    }
    if (this.screenShareTracks.length > 0 || this.nativeScreenShare) {
      await this.stopScreenShare();
      return false;
    }
    return this.startScreenShare(options);
  },

  async _stopNativeDesktopScreenShare({ stopReason = "manual" } = {}) {
    const activeShare = this.nativeScreenShare;
    const previousCaptureMode = null;

    try {
      await Promise.resolve(stopNativeScreenShare?.()).catch(() => null);
    } catch (error) {
      this.logger.warn("native screen share stop failed", { event: "native_screen_share_stop" }, error);
    } finally {
      this._clearNativeScreenShareSync?.();
      activeShare?.keySubscriptionCleanup?.();
      this.nativeScreenShare = null;
      this._emitScreenShareDisabled(stopReason, previousCaptureMode);
    }
  },

  async startScreenShare(options = {}) {
    if (!this.room) {
      return false;
    }

    const {
      audio = false,
      displaySurface = "monitor",
      resolution = { width: 1920, height: 1080, frameRate: 60 },
      qualityPreset = DEFAULT_SCREEN_SHARE_PRESET_ID,
      nativeCapture = false,
      sourceId = null,
      sourceKind = null,
      sourceLabel = null,
    } = options;

    if (this.screenShareTracks.length > 0) {
      await this.stopScreenShare();
    }

    if (nativeCapture && this.runtimeConfig?.isDesktop && sourceId) {
      return this._startNativeDesktopScreenShare({
        audio,
        resolution,
        qualityPreset,
        sourceId,
        sourceKind,
        sourceLabel,
      });
    }

    if (audio) {
      await this._ensureAudioContext();
    }

    this.screenShareTracks = await createLocalScreenTracks({
      audio: Boolean(audio),
      video: { displaySurface },
      resolution,
      systemAudio: audio ? "include" : "exclude",
      surfaceSwitching: "exclude",
      selfBrowserSurface: "exclude",
      suppressLocalAudioPlayback: true,
      contentHint: "detail",
    });

    const screenShareStreamName = `screen-share-${Date.now()}`;
    const screenSharePublishOptions = buildScreenSharePublishOptions(qualityPreset);
    const screenShareVideoTrack = this.screenShareTracks.find((track) => track.kind === Track.Kind.Video);
    if (screenShareVideoTrack?.mediaStreamTrack) {
      screenShareVideoTrack.mediaStreamTrack.contentHint = "detail";
    }

    this.screenShareTracks.forEach((track) => {
      track.mediaStreamTrack?.addEventListener("ended", () => {
        if (this.screenShareTracks.includes(track)) {
          void this.stopScreenShare();
        }
      }, { once: true });
    });

    const screenShareAudioTrackRaw = this.screenShareTracks.find(
      (track) => track.kind === Track.Kind.Audio || track.source === Track.Source.ScreenShareAudio,
    );
    let processedAudioTrack = null;

    if (screenShareAudioTrackRaw?.mediaStreamTrack && this.audioContext) {
      processedAudioTrack = this._processScreenShareAudioTrack(screenShareAudioTrackRaw.mediaStreamTrack);
    }

    await Promise.all(
      this.screenShareTracks.map((track, index) => {
        const isVideo = track.kind === Track.Kind.Video;
        if (isVideo) {
          return this.room.localParticipant.publishTrack(track, {
            ...screenSharePublishOptions,
            name: `screen-share-video-${index}-${Date.now()}`,
            source: Track.Source.ScreenShare,
            stream: screenShareStreamName,
          });
        }

        const audioTrackToPublish = processedAudioTrack || track;
        return this.room.localParticipant.publishTrack(audioTrackToPublish, {
          name: `screen-share-audio-${index}-${Date.now()}`,
          source: Track.Source.ScreenShareAudio,
          stream: screenShareStreamName,
        });
      }),
    );

    const hasAudio = Boolean(screenShareAudioTrackRaw);
    this._emitRemoteMediaUpdate();
    this._scheduleNativeScreenShareSync?.("native_start");
    this._emit("screen_share_change", {
      enabled: true,
      provider: "browser",
      sourceId: null,
      sourceKind: displaySurface,
      sourceLabel: null,
      hasAudio,
      actualCaptureSettings: screenShareVideoTrack?.mediaStreamTrack?.getSettings?.() || null,
      captureMode: null,
    });
    return true;
  },

  async stopScreenShare({ stopReason = "manual" } = {}) {
    return this._runLifecycleAction("stopScreenShare", async () => {
      if (!this.nativeScreenShare && this.screenShareTracks.length === 0) {
        return;
      }

      if (this.nativeScreenShare) {
        await this._stopNativeDesktopScreenShare({ stopReason });
        return;
      }

      const tracksToStop = [...this.screenShareTracks];
      try {
        if (this.room?.localParticipant) {
          await Promise.all(
            tracksToStop.map((track) => this.room.localParticipant.unpublishTrack(track.unpublishTarget || track, false)),
          );
        }
      } catch (error) {
        this.logger.warn("screen share unpublish failed", { event: "screen_share_unpublish" }, error);
      } finally {
        tracksToStop.forEach((track) => track.stop?.());
        this.screenShareTracks = [];
        this._cleanupScreenShareAudioGain();
        this._emitScreenShareDisabled(stopReason);
      }
    });
  },

  setScreenShareAudioVolume(volume) {
    this.screenShareAudioVolume = clampVolume(volume, 0, 200);
    if (this.screenShareAudioGain) {
      this.screenShareAudioGain.gain.value = this.screenShareAudioVolume / 100;
    }
    if (this.nativeScreenShare?.audioRequested) {
      void Promise.resolve(
        updateNativeScreenShareAudioVolume?.(this.screenShareAudioVolume),
      ).catch((error) => {
        this.logger.warn("native screen-share audio volume update failed", {
          event: "native_screen_share_audio_volume",
        }, error);
      });
    }
  },

  _cleanupScreenShareAudioGain() {
    try {
      this.screenShareAudioSourceNode?.disconnect();
      this.screenShareAudioGain?.disconnect();
      this.screenShareAudioDest?.disconnect?.();
    } catch {
      // Ignore disconnect races on already disposed nodes.
    }
    this.screenShareAudioSourceNode = null;
    this.screenShareAudioGain = null;
    this.screenShareAudioDest = null;
  },

  _processScreenShareAudioTrack(rawAudioTrack) {
    if (!this.audioContext || !rawAudioTrack) {
      return rawAudioTrack;
    }

    this._cleanupScreenShareAudioGain();

    const rawStream = new MediaStream([rawAudioTrack]);
    this.screenShareAudioSourceNode = this.audioContext.createMediaStreamSource(rawStream);
    this.screenShareAudioGain = this.audioContext.createGain();
    this.screenShareAudioGain.gain.value = this.screenShareAudioVolume / 100;
    this.screenShareAudioDest = this.audioContext.createMediaStreamDestination();

    this.screenShareAudioSourceNode.connect(this.screenShareAudioGain);
    this.screenShareAudioGain.connect(this.screenShareAudioDest);

    return this.screenShareAudioDest.stream.getAudioTracks()[0] || rawAudioTrack;
  },

  async _rehydrateNativeScreenShareSession() {
    if (!this.runtimeConfig?.isDesktop || !this.room || !this.userId) {
      return null;
    }

    const activeSession = await getNativeScreenShareSession?.().catch(() => null);
    const expectedRoomName = buildVoiceRoomName(this.serverId, this.channelId);
    const expectedParticipantIdentity = this.channelId
      ? `screen-share:${this.channelId}:${this.userId}`
      : null;

    if (
      !activeSession
      || (expectedRoomName && activeSession.roomName !== expectedRoomName)
      || (expectedParticipantIdentity && activeSession.participantIdentity !== expectedParticipantIdentity)
    ) {
      return null;
    }

    const previousCleanup = this.nativeScreenShare?.keySubscriptionCleanup || null;
    this.nativeScreenShare = {
      ...activeSession,
      keySubscriptionCleanup: previousCleanup,
      audioRequested: Boolean(activeSession.hasAudio),
    };

    this._emitRemoteMediaUpdate();
    this._scheduleNativeScreenShareSync?.("native_rehydrate");
    this._emit("screen_share_change", {
      enabled: true,
      provider: activeSession.provider || "tauri-native-livekit",
      sourceId: activeSession.sourceId || null,
      sourceKind: activeSession.sourceKind || null,
      sourceLabel: activeSession.sourceLabel || null,
      hasAudio: Boolean(activeSession.hasAudio),
      actualCaptureSettings: {
        width: activeSession.requestedWidth || null,
        height: activeSession.requestedHeight || null,
        frameRate: activeSession.requestedFrameRate || null,
      },
      captureMode: null,
      audioRequested: Boolean(activeSession.hasAudio),
    });

    return activeSession;
  },

  _collectCurrentVoiceParticipantUserIds() {
    const participantIds = new Set([this.userId]);
    this.room?.remoteParticipants?.forEach((participant) => {
      const resolvedUserId = this._resolveParticipantUserId(participant);
      if (resolvedUserId) {
        participantIds.add(resolvedUserId);
      }
    });
    return [...participantIds];
  },

  async _startNativeDesktopScreenShare({
    audio,
    resolution,
    qualityPreset,
    sourceId,
    sourceKind,
    sourceLabel,
  }) {
    let nativeKeySubscription = null;
    let sharedMediaKeyB64 = null;
    let session = null;

    if (this.mediaE2EEController) {
      await this.syncEncryptedMediaParticipants(
        this._collectCurrentVoiceParticipantUserIds(),
        "native-screen-share-start",
      );
      sharedMediaKeyB64 = this.mediaE2EEController.getNativeBridgeState?.()?.sharedMediaKeyB64 || null;
      if (sharedMediaKeyB64) {
        nativeKeySubscription = this.mediaE2EEController.subscribeNativeKey?.((nextState) => {
          if (!nextState?.sharedMediaKeyB64) {
            return;
          }
          void updateNativeScreenShareKey(nextState.sharedMediaKeyB64, 0).catch((error) => {
            this.logger.warn("native E2EE key sync failed", { event: "native_screen_share_key_sync" }, error);
          });
        }) || null;
      }
    }

    const tokenResponse = await api.post("/voice/native-screen-share-token", {
      server_id: this.serverId,
      channel_id: this.channelId,
    });

    const screenSharePublishOptions = buildScreenSharePublishOptions(qualityPreset);
    try {
      session = await startNativeScreenShare({
        serverUrl: tokenResponse.data.server_url,
        participantToken: tokenResponse.data.participant_token,
        roomName: tokenResponse.data.room_name,
        participantIdentity: tokenResponse.data.participant_identity,
        sourceId,
        audioEnabled: Boolean(audio),
        audioVolume: this.screenShareAudioVolume,
        requestedWidth: resolution.width,
        requestedHeight: resolution.height,
        requestedFrameRate: resolution.frameRate,
        maxBitrate: screenSharePublishOptions?.screenShareEncoding?.maxBitrate || null,
        maxFrameRate: screenSharePublishOptions?.screenShareEncoding?.maxFramerate || resolution.frameRate,
        simulcast: Boolean(screenSharePublishOptions?.simulcast),
        e2eeRequired: Boolean(tokenResponse.data.e2ee_required),
        sharedMediaKeyB64,
      });

      this.nativeScreenShare = {
        ...session,
        sourceKind: sourceKind || session?.sourceKind || "display",
        sourceLabel: sourceLabel || session?.sourceLabel || "Desktop capture",
        qualityPreset,
        hasAudio: Boolean(session?.hasAudio),
        audioRequested: Boolean(session?.hasAudio || audio),
        keySubscriptionCleanup: nativeKeySubscription,
      };
    } catch (error) {
      nativeKeySubscription?.();
      throw error;
    }

    this._emitRemoteMediaUpdate();
    this._emit("screen_share_change", {
      enabled: true,
      provider: "tauri-native-livekit",
      sourceId,
      sourceKind: this.nativeScreenShare.sourceKind,
      sourceLabel: this.nativeScreenShare.sourceLabel,
      hasAudio: Boolean(session?.hasAudio),
      actualCaptureSettings: {
        width: session?.requestedWidth || resolution.width,
        height: session?.requestedHeight || resolution.height,
        frameRate: session?.requestedFrameRate || resolution.frameRate,
      },
      captureMode: null,
      audioRequested: Boolean(session?.hasAudio || audio),
    });
    return true;
  },
};
