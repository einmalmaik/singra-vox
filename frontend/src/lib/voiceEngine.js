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
 * voiceEngine.js – Zentrale Steuerung für Voice, Kamera und Bildschirmfreigabe
 *
 * Architektur:
 *   VoiceEngine verwaltet den kompletten Medien-Lifecycle für einen Voice-Channel:
 *   - Mikrofon (Capture, Gain, Mute/PTT, Rauschunterdrückung)
 *   - Kamera (Toggle, Device-Wechsel)
 *   - Bildschirmfreigabe (Browser getDisplayMedia + Tauri native capture)
 *   - Screen-Share Audio (GainNode-Pipeline für Lautstärkeregler)
 *   - Remote-Audio (pro-User Lautstärke, lokales Stummschalten, Deafen)
 *   - Spracherkennung (Active Speaker Detection via LiveKit)
 *   - E2EE-Medien-Verschlüsselung (optional, für private Kanäle)
 *
 * Events:
 *   Nutzer registrieren Listener via addStateListener() oder setzen onStateChange.
 *   Events: connected, disconnected, mute_change, deafen_change, camera_change,
 *           screen_share_change, media_tracks_update, speaking_update, input_level,
 *           mic_test_state, peer_connected, peer_disconnected
 *
 * Erweiterung:
 *   Neue Qualitätsprofile → screenSharePresets.js
 *   LiveKit-Transport-Abstraktion → LiveKitTransport.js (noch nicht vollständig migriert)
 *   Audio-Analyse → AudioAnalyzer.js
 */

import api from "@/lib/api";
import { Room, RoomEvent, Track, DisconnectReason, createLocalScreenTracks, createLocalVideoTrack } from "livekit-client";
import { getDefaultVoicePreferences } from "@/lib/voicePreferences";
import { getDesktopCaptureFrame, startDesktopCapture, stopDesktopCapture } from "@/lib/desktop";
import { DEFAULT_SCREEN_SHARE_PRESET_ID, buildScreenSharePublishOptions } from "@/lib/screenSharePresets";
import { AudioAnalyzer } from "@/lib/AudioAnalyzer";

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function clampVolume(value, min = 0, max = 200) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function clampUnit(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

// Legacy shim – kept for the synthetic video track helper below
function getAudioContextCtor() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

function computeRms(dataArray) {
  if (!dataArray?.length) return 0;
  let sum = 0;
  for (let i = 0; i < dataArray.length; i += 1) {
    const sample = (dataArray[i] - 128) / 128;
    sum += sample * sample;
  }
  return Math.sqrt(sum / dataArray.length);
}

function createSyntheticVideoTrackDescriptor(mediaStreamTrack, source, stop) {
  const mediaStream = new MediaStream([mediaStreamTrack]);
  return {
    kind: Track.Kind.Video,
    source,
    mediaStreamTrack,
    unpublishTarget: mediaStreamTrack,
    attach(element) {
      if (!element) {
        return element;
      }
      element.srcObject = mediaStream;
      element.autoplay = true;
      element.playsInline = true;
      return element;
    },
    detach(element) {
      if (element?.srcObject === mediaStream) {
        element.srcObject = null;
      }
      return [];
    },
    stop,
  };
}

export class VoiceEngine {
  constructor() {
    this.room = null;
    this.serverId = null;
    this.channelId = null;
    this.userId = "default";
    this.isMuted = false;
    this.isDeafened = false;
    this.pttActive = false;
    this.preferences = getDefaultVoicePreferences();
    this.runtimeConfig = null;
    // Audio and video can arrive from multiple sources per participant
    // (microphone, screen-share audio, camera, screen-share video). We track
    // them separately so adding a screen share does not overwrite the user's
    // microphone path.
    this.audioElements = new Map();
    this.remoteVideoTracks = new Map();
    this.onStateChange = null;
    this.listeners = new Set();

    this.localSpeaking = false;
    this.localAudioLevel = 0;
    this.remoteSpeakerIds = [];
    this.activeSpeakerIds = [];
    this.autoSensitivityFloor = 0.015;
    this.currentInputThreshold = this._resolveInputThreshold();
    this.micTestActive = false;

    this.audioContext = null;
    this.inputGainNode = null;
    this.inputDestination = null;
    this.localInputStream = null;
    this.localPublishedTrack = null;
    this.localTrackPublication = null;

    this.monitorSourceNode = null;
    this.monitorGainNode = null;
    this.monitorDestination = null;
    this.monitorAudioElement = null;
    this.monitorStream = null;
    this.mediaE2EEController = null;

    this.analysisSourceNode = null;
    this.analyserNode = null;
    this.analysisFrame = null;
    this.analysisData = null;
    this.analysisStream = null;
    this.cameraTrack = null;
    this.screenShareTracks = [];
    this.nativeScreenShare = null;

    // ── Screen-Share Audio Gain ──────────────────────────────────────────────
    // Ermöglicht es dem Nutzer, die Lautstärke des geteilten System-/Spielaudios
    // zur Laufzeit zu regeln. Der GainNode sitzt zwischen dem rohen
    // getDisplayMedia-Audio und dem an LiveKit publizierten Track.
    this.screenShareAudioGain = null;       // GainNode
    this.screenShareAudioSourceNode = null; // MediaStreamSource vom Capture
    this.screenShareAudioDest = null;       // MediaStreamDestination
    this.screenShareAudioVolume = 100;      // 0-200%, Default 100%
  }

  addStateListener(listener) {
    if (typeof listener !== "function") return () => {};
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

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
  }

  getPreferences() {
    return {
      ...this.preferences,
      perUserVolumes: { ...this.preferences.perUserVolumes },
      locallyMutedParticipants: { ...this.preferences.locallyMutedParticipants },
    };
  }

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
      this.monitorAudioElement.volume = clampVolume(this.preferences.inputVolume, 0, 200) / 100;
    }

    if (Object.prototype.hasOwnProperty.call(nextPreferences, "micTestEnabled")) {
      if (this.preferences.micTestEnabled) {
        await this.startMicTest();
      } else {
        await this.stopMicTest();
      }
    }
  }

  async setInputDevice(deviceId) {
    await this.setPreferences({ inputDeviceId: deviceId });
  }

  async setOutputDevice(deviceId) {
    await this.setPreferences({ outputDeviceId: deviceId });
  }

  async setInputVolume(volume) {
    await this.setPreferences({ inputVolume: clampVolume(volume) });
  }

  async setOutputVolume(volume) {
    await this.setPreferences({ outputVolume: clampVolume(volume) });
  }

  async setParticipantVolume(userId, volume) {
    await this.setPreferences({
      perUserVolumes: {
        [userId]: clampVolume(volume),
      },
    });
    this._applyParticipantAudio(userId);
  }

  async setParticipantLocalMute(userId, muted) {
    await this.setPreferences({
      locallyMutedParticipants: {
        [userId]: Boolean(muted),
      },
    });
    this._applyParticipantAudio(userId);
  }

  async muteParticipant(userId, muted) {
    await this.setParticipantLocalMute(userId, muted);
  }

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
    if (tokenResponse.data.e2ee_required && typeof this.room.setE2EEEnabled === "function") {
      await this.room.setE2EEEnabled(true);
    }

    if (typeof this.room.startAudio === "function") {
      await this.room.startAudio();
    }

    await this._ensureAudioContext();
    await this._publishLocalTrack();
    await this._applyOutputDevice();
    this._applyRemoteAudioState();
    await this._applyMuteState();
    this._emit("connected");
  }

  handleSignal() {
    // LiveKit uses its own SFU transport, so browser-side signaling is not needed.
  }

  toggleMute() {
    return this.setMuted(!this.isMuted);
  }

  toggleDeafen() {
    return this.setDeafened(!this.isDeafened);
  }

  setMuted(muted) {
    this.isMuted = Boolean(muted);
    void this._applyMuteState();
    this._emit("mute_change", { isMuted: this.isMuted });
    return this.isMuted;
  }

  setDeafened(deafened) {
    this.isDeafened = Boolean(deafened);
    this._applyRemoteAudioState();
    this._emitSpeakingState();
    this._emit("deafen_change", { isDeafened: this.isDeafened });
    return this.isDeafened;
  }

  setPTT(enabled) {
    this.preferences.pttEnabled = enabled;
    void this._applyMuteState();
  }

  setPTTActive(active) {
    this.pttActive = active;
    void this._applyMuteState();
  }

  async startMicTest() {
    if (this.micTestActive) return;

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
  }

  async stopMicTest() {
    if (!this.micTestActive && !this.monitorAudioElement) return;

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
  }

  getAudioLevel() {
    return this.localAudioLevel;
  }

  async getDevices(kind = "audioinput") {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === kind);
  }

  async restartLocalTrack() {
    if (!this.room) return;
    await this._publishLocalTrack();
    await this._applyMuteState();
  }

  async disconnect() {
    this.audioElements.forEach(({ element }) => {
      element.pause();
      element.remove();
    });
    this.audioElements.clear();
    this.remoteVideoTracks.clear();

    if (this.room && this.localTrackPublication?.track) {
      await this.room.localParticipant.unpublishTrack(this.localTrackPublication.track, false);
    }

    this.localTrackPublication = null;
    await this.stopCamera();
    await this.stopScreenShare();
    this._stopLocalTrackResources();
    await this.stopMicTest();

    if (this.room) {
      this.room.disconnect();
    }
    this.room = null;
    this.mediaE2EEController = null;
    this._resetSpeakingState();
    this._emitRemoteMediaUpdate();
    this._emit("disconnected");
  }

  async syncEncryptedMediaParticipants(participantUserIds, reason = "membership") {
    if (!this.mediaE2EEController) {
      return { rotated: false, keyVersion: null, participantUserIds: [] };
    }
    return this.mediaE2EEController.syncParticipantSet(participantUserIds, reason);
  }

  async toggleCamera() {
    if (!this.room) return false;
    if (this.cameraTrack) {
      await this.stopCamera();
      return false;
    }
    const options = this.preferences.cameraDeviceId
      ? { deviceId: { exact: this.preferences.cameraDeviceId } }
      : undefined;
    this.cameraTrack = await createLocalVideoTrack(options);
    await this.room.localParticipant.publishTrack(this.cameraTrack);
    this._emitRemoteMediaUpdate();
    this._emit("camera_change", { enabled: true });
    return true;
  }

  async stopCamera() {
    if (!this.room || !this.cameraTrack) return;
    await this.room.localParticipant.unpublishTrack(this.cameraTrack, false);
    this.cameraTrack.stop();
    this.cameraTrack = null;
    this._emitRemoteMediaUpdate();
    this._emit("camera_change", { enabled: false });
  }

  async toggleScreenShare(options = {}) {
    if (!this.room) return false;
    if (this.screenShareTracks.length > 0) {
      await this.stopScreenShare();
      return false;
    }
    return this.startScreenShare(options);
  }

  /**
   * Startet eine Browser-basierte Bildschirmfreigabe via getDisplayMedia.
   *
   * Ablauf:
   * 1. createLocalScreenTracks() ruft getDisplayMedia auf (Nutzer wählt Quelle)
   * 2. Video-Track: contentHint="detail" für scharfe Text-/UI-Darstellung
   * 3. Audio-Track (optional): wird durch einen GainNode geleitet, damit der
   *    Nutzer die Spielaudio-Lautstärke zur Laufzeit über setScreenShareAudioVolume()
   *    regulieren kann
   * 4. Alle Tracks werden an LiveKit publiziert mit den gewählten Qualitäts-Einstellungen
   *
   * @param {Object} options
   * @param {boolean} [options.audio=false]           - Systemaudio mitteilen?
   * @param {string}  [options.displaySurface="monitor"] - "monitor" | "window" | "browser"
   * @param {Object}  [options.resolution]            - { width, height, frameRate }
   * @param {string}  [options.qualityPreset]         - Preset-ID aus screenSharePresets.js
   * @param {boolean} [options.nativeCapture=false]    - Tauri-nativer Capture-Pfad
   * @param {string}  [options.sourceId]               - Native capture source ID
   * @param {string}  [options.sourceKind]             - Native capture source kind
   * @param {string}  [options.sourceLabel]            - Native capture source label
   * @returns {Promise<boolean>} true wenn erfolgreich gestartet
   */
  async startScreenShare(options = {}) {
    if (!this.room) return false;
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

    // Tauri-nativer Capture-Pfad (eigener Frame-Loop, kein getDisplayMedia)
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

    // ── Browser-Capture via getDisplayMedia ─────────────────────────────────

    // AudioContext sicherstellen für den Audio-GainNode (falls Audio gewünscht)
    if (audio) {
      await this._ensureAudioContext();
    }

    this.screenShareTracks = await createLocalScreenTracks({
      // Screen-Share-Audio ist ein separater Track vom Mikrofon.
      // Als Boolean übergeben, damit getDisplayMedia native System-/Tab-Audio
      // aushandeln kann statt Mikrofon-Constraints zu verwenden.
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

    // Video-Track: contentHint="detail" sorgt für scharfe Darstellung von
    // Text, UI-Elementen und Spielgrafik (Chromium/Firefox optimiert entsprechend)
    const screenShareVideoTrack = this.screenShareTracks.find((track) => track.kind === Track.Kind.Video);
    if (screenShareVideoTrack?.mediaStreamTrack) {
      screenShareVideoTrack.mediaStreamTrack.contentHint = "detail";
    }

    // Bei Track-Ende (Nutzer klickt "Freigabe beenden" im Browser-Picker)
    // automatisch aufräumen
    this.screenShareTracks.forEach((track) => {
      track.mediaStreamTrack?.addEventListener("ended", () => {
        if (this.screenShareTracks.includes(track)) {
          void this.stopScreenShare();
        }
      }, { once: true });
    });

    // ── Audio-Track durch GainNode leiten (Lautstärke-Regler) ──────────────
    // Falls Audio aktiv ist, pipen wir den rohen getDisplayMedia-Audio-Track
    // durch einen GainNode. So kann der Nutzer die Spielaudio-Lautstärke
    // mit setScreenShareAudioVolume() zur Laufzeit regeln.
    const screenShareAudioTrackRaw = this.screenShareTracks.find(
      (track) => track.kind === Track.Kind.Audio || track.source === Track.Source.ScreenShareAudio,
    );
    let processedAudioTrack = null;

    if (screenShareAudioTrackRaw?.mediaStreamTrack && this.audioContext) {
      processedAudioTrack = this._processScreenShareAudioTrack(
        screenShareAudioTrackRaw.mediaStreamTrack,
      );
    }

    // ── Tracks an LiveKit publizieren ──────────────────────────────────────
    await Promise.all(
      this.screenShareTracks.map((track, index) => {
        const isVideo = track.kind === Track.Kind.Video;
        const isAudio = !isVideo;

        if (isVideo) {
          return this.room.localParticipant.publishTrack(
            track,
            {
              ...screenSharePublishOptions,
              name: `screen-share-video-${index}-${Date.now()}`,
              source: Track.Source.ScreenShare,
              stream: screenShareStreamName,
            },
          );
        }

        // Audio: Falls wir einen verarbeiteten Track haben (GainNode),
        // publizieren wir diesen statt dem Rohen
        const audioTrackToPublish = processedAudioTrack || track;
        return this.room.localParticipant.publishTrack(
          audioTrackToPublish,
          {
            name: `screen-share-audio-${index}-${Date.now()}`,
            source: Track.Source.ScreenShareAudio,
            stream: screenShareStreamName,
          },
        );
      }),
    );

    const hasAudio = Boolean(screenShareAudioTrackRaw);
    this._emitRemoteMediaUpdate();
    this._emit("screen_share_change", {
      enabled: true,
      provider: "browser",
      sourceId: null,
      sourceKind: displaySurface,
      sourceLabel: null,
      hasAudio,
      actualCaptureSettings: screenShareVideoTrack?.mediaStreamTrack?.getSettings?.() || null,
    });
    return true;
  }

  async stopScreenShare() {
    if (!this.room || this.screenShareTracks.length === 0) return;
    if (this.nativeScreenShare) {
      await this._stopNativeDesktopScreenShare();
      return;
    }
    await Promise.all(
      this.screenShareTracks.map((track) => this.room.localParticipant.unpublishTrack(track.unpublishTarget || track, false)),
    );
    this.screenShareTracks.forEach((track) => track.stop?.());
    this.screenShareTracks = [];
    this._cleanupScreenShareAudioGain();
    this._emitRemoteMediaUpdate();
    this._emit("screen_share_change", {
      enabled: false,
      provider: null,
      sourceId: null,
      sourceKind: null,
      sourceLabel: null,
      hasAudio: false,
      actualCaptureSettings: null,
    });
  }

  /**
   * Stellt die Lautstärke des geteilten System-/Spielaudios ein.
   *
   * @param {number} volume - 0-200 (Prozent), wobei 100 = Originallautstärke
   *
   * Der Wert wird sofort am internen GainNode angewendet (falls ein
   * Screen-Share mit Audio aktiv ist). Kann auch VOR dem Start eines
   * Screen-Shares aufgerufen werden – der Wert wird dann beim nächsten
   * startScreenShare() übernommen.
   */
  setScreenShareAudioVolume(volume) {
    this.screenShareAudioVolume = clampVolume(volume, 0, 200);
    if (this.screenShareAudioGain) {
      this.screenShareAudioGain.gain.value = this.screenShareAudioVolume / 100;
    }
  }

  /**
   * Räumt die Web-Audio-Pipeline für Screen-Share-Audio auf.
   * Wird beim Stoppen eines Screen-Shares automatisch aufgerufen.
   */
  _cleanupScreenShareAudioGain() {
    try {
      this.screenShareAudioSourceNode?.disconnect();
      this.screenShareAudioGain?.disconnect();
      this.screenShareAudioDest?.disconnect?.();
    } catch {
      // Disconnect-Fehler bei bereits getrennte Nodes ignorieren
    }
    this.screenShareAudioSourceNode = null;
    this.screenShareAudioGain = null;
    this.screenShareAudioDest = null;
  }

  /**
   * Leitet einen rohen Audio-MediaStreamTrack durch einen GainNode,
   * sodass der Nutzer die Lautstärke zur Laufzeit regeln kann.
   *
   * @param {MediaStreamTrack} rawAudioTrack - Roher AudioTrack von getDisplayMedia
   * @returns {MediaStreamTrack} - Verarbeiteter Track (gleicher Track falls kein AudioContext)
   */
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
  }

  async _startNativeDesktopScreenShare({
    audio,
    resolution,
    qualityPreset,
    sourceId,
    sourceKind,
    sourceLabel,
  }) {
    const session = await startDesktopCapture({
      sourceId,
      requestedWidth: resolution.width,
      requestedHeight: resolution.height,
      requestedFrameRate: resolution.frameRate,
    });

    const canvas = document.createElement("canvas");
    canvas.width = resolution.width;
    canvas.height = resolution.height;
    const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!context) {
      throw new Error("The native screen share canvas could not be initialized.");
    }

    this.nativeScreenShare = {
      sourceId,
      sourceKind: sourceKind || session?.sourceKind || "display",
      sourceLabel: sourceLabel || session?.sourceLabel || "Desktop capture",
      requestedFrameRate: resolution.frameRate,
      qualityPreset,
      frameId: null,
      drawInFlight: false,
      canvas,
      context,
      pumpTimer: null,
      frameIntervalMs: Math.max(Math.round(1000 / Math.max(resolution.frameRate || 30, 1)), 16),
      lastFrameSettings: null,
    };

    // Pull at least one frame before publishing so the local stage and the
    // remote viewers do not start with a black canvas track.
    const firstFrameReady = await this._waitForNativeDesktopFrame();
    if (!firstFrameReady) {
      await this._stopNativeDesktopScreenShare({ keepTracksArray: false });
      throw new Error("The desktop capture started, but no video frame arrived.");
    }

    if (this.nativeScreenShare.lastFrameSettings?.width && this.nativeScreenShare.lastFrameSettings?.height) {
      canvas.width = this.nativeScreenShare.lastFrameSettings.width;
      canvas.height = this.nativeScreenShare.lastFrameSettings.height;
    }

    // captureStream(0) gibt uns volle Kontrolle: Frames werden NUR gerendert
    // wenn wir explizit requestFrame() aufrufen – direkt nach putImageData.
    // captureStream(fps) rendert asynchron und kann veraltete Canvas-Zustände
    // erfassen, was zu schwarzen/eingefrorenen Streams in WebView2 führt.
    const mediaStream = canvas.captureStream(0);
    const mediaStreamTrack = mediaStream.getVideoTracks()[0];
    if (!mediaStreamTrack) {
      await this._stopNativeDesktopScreenShare({ keepTracksArray: false });
      throw new Error("The native screen share track could not be created.");
    }
    mediaStreamTrack.contentHint = "detail";

    const descriptor = createSyntheticVideoTrackDescriptor(
      mediaStreamTrack,
      Track.Source.ScreenShare,
      () => mediaStreamTrack.stop(),
    );

    this.nativeScreenShare.mediaStream = mediaStream;
    this.nativeScreenShare.mediaStreamTrack = mediaStreamTrack;
    this.nativeScreenShare.descriptor = descriptor;
    this.screenShareTracks = [descriptor];
    const screenSharePublishOptions = buildScreenSharePublishOptions(qualityPreset);
    const screenShareStreamName = `native-screen-share-${Date.now()}`;

    await this.room.localParticipant.publishTrack(mediaStreamTrack, {
      ...screenSharePublishOptions,
      name: `${screenShareStreamName}-video`,
      source: Track.Source.ScreenShare,
      stream: screenShareStreamName,
    });

    this._scheduleNativeDesktopFramePump(this.nativeScreenShare.frameIntervalMs);

    this._emitRemoteMediaUpdate();
    this._emit("screen_share_change", {
      enabled: true,
      provider: "tauri-native",
      sourceId,
      sourceKind: this.nativeScreenShare.sourceKind,
      sourceLabel: this.nativeScreenShare.sourceLabel,
      hasAudio: false,
      actualCaptureSettings: this.nativeScreenShare.lastFrameSettings || {
        width: resolution.width,
        height: resolution.height,
        frameRate: resolution.frameRate,
      },
      audioRequested: Boolean(audio),
    });
    return true;
  }

  async _waitForNativeDesktopFrame() {
    // 60 Versuche × 100ms = 6s Timeout – gibt crabgrab genug Zeit,
    // den ersten Frame zu erfassen (besonders bei großen Displays)
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const updated = await this._pumpNativeDesktopFrame();
      if (updated) {
        return true;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return false;
  }

  _scheduleNativeDesktopFramePump(delayMs = 16) {
    if (!this.nativeScreenShare || this.nativeScreenShare.pumpTimer) {
      return;
    }

    this.nativeScreenShare.pumpTimer = window.setTimeout(async () => {
      if (!this.nativeScreenShare) {
        return;
      }

      this.nativeScreenShare.pumpTimer = null;
      try {
        await this._pumpNativeDesktopFrame();
      } finally {
        if (this.nativeScreenShare) {
          this._scheduleNativeDesktopFramePump(this.nativeScreenShare.frameIntervalMs);
        }
      }
    }, Math.max(delayMs, 16));
  }

  async _pumpNativeDesktopFrame() {
    if (!this.nativeScreenShare || this.nativeScreenShare.drawInFlight) {
      return false;
    }

    this.nativeScreenShare.drawInFlight = true;
    try {
      const frame = await getDesktopCaptureFrame(this.nativeScreenShare.frameId);
      if (!frame?.data?.length) {
        return false;
      }

      if (
        this.nativeScreenShare.canvas.width !== frame.width
        || this.nativeScreenShare.canvas.height !== frame.height
      ) {
        this.nativeScreenShare.canvas.width = frame.width;
        this.nativeScreenShare.canvas.height = frame.height;
      }

      const rgbaView = frame.data instanceof Uint8ClampedArray
        ? frame.data
        : new Uint8ClampedArray(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength);
      const imageData = new ImageData(rgbaView, frame.width, frame.height);
      this.nativeScreenShare.context.putImageData(imageData, 0, 0);

      // Explizit requestFrame() aufrufen – mit captureStream(0) ist das PFLICHT,
      // damit der Stream ein neues Frame an LiveKit weiterleitet.
      if (typeof this.nativeScreenShare.mediaStreamTrack?.requestFrame === "function") {
        this.nativeScreenShare.mediaStreamTrack.requestFrame();
      }

      this.nativeScreenShare.frameId = frame.frameId;
      this.nativeScreenShare.lastFrameSettings = {
        width: frame.width,
        height: frame.height,
        frameRate: this.nativeScreenShare.requestedFrameRate,
      };

      this._emit("screen_share_change", {
        enabled: true,
        provider: "tauri-native",
        sourceId: this.nativeScreenShare.sourceId,
        sourceKind: this.nativeScreenShare.sourceKind,
        sourceLabel: this.nativeScreenShare.sourceLabel,
        hasAudio: false,
        actualCaptureSettings: this.nativeScreenShare.lastFrameSettings,
      });
      return true;
    } finally {
      if (this.nativeScreenShare) {
        this.nativeScreenShare.drawInFlight = false;
      }
    }
  }

  async _stopNativeDesktopScreenShare({ keepTracksArray = false } = {}) {
    if (!this.room) {
      return;
    }

    const activeShare = this.nativeScreenShare;
    if (activeShare?.pumpTimer) {
      window.clearTimeout(activeShare.pumpTimer);
    }

    if (activeShare?.mediaStreamTrack) {
      await this.room.localParticipant.unpublishTrack(activeShare.mediaStreamTrack, false);
    }

    activeShare?.mediaStream?.getTracks?.().forEach((track) => track.stop());
    activeShare?.descriptor?.stop?.();

    await stopDesktopCapture().catch(() => null);

    if (!keepTracksArray) {
      this.screenShareTracks = [];
    }
    this.nativeScreenShare = null;
    this._emitRemoteMediaUpdate();
    this._emit("screen_share_change", {
      enabled: false,
      provider: null,
      sourceId: null,
      sourceKind: null,
      sourceLabel: null,
      hasAudio: false,
      actualCaptureSettings: null,
    });
  }

  /**
   * Hängt einen Video-Track (Kamera oder Screen-Share) an ein <video>-Element.
   *
   * Gibt eine Detach-Funktion zurück wenn der Track erfolgreich angehängt wurde,
   * oder **null** wenn kein Track verfügbar ist. Der Aufrufer (VoiceMediaStage)
   * nutzt diesen Rückgabewert, um zu entscheiden ob ein Retry nötig ist.
   *
   * @param {string} participantId  - User-ID oder LiveKit-Identity
   * @param {string} source         - "screen_share" | "camera"
   * @param {HTMLVideoElement} element
   * @returns {Function|null} Detach-Callback oder null bei fehlendem Track
   */
  attachParticipantMediaElement(participantId, source, element) {
    if (!element) {
      return null;
    }

    const normalizedSource = source || Track.Source.Camera;
    const track = participantId === this.userId
      ? this._getLocalVideoTrack(normalizedSource)
      : this.remoteVideoTracks.get(this._trackKey(participantId, normalizedSource))?.track;

    // Kein Track verfügbar → null zurückgeben damit der Aufrufer retrien kann
    if (!track) {
      return null;
    }

    element.autoplay = true;
    element.playsInline = true;
    // Eigenen Stream stumm schalten um Echo-Feedback zu vermeiden
    element.muted = participantId === this.userId;
    track.attach(element);

    // play() kann durch Browser-Autoplay-Policy blockiert werden.
    // Wir versuchen es sofort und nochmal nach einer kurzen Verzögerung.
    const tryPlay = () => {
      void element.play?.().catch(() => {
        // Wird vom VoiceMediaStage-Retry-Mechanismus aufgefangen
      });
    };
    tryPlay();
    // Zweiter Versuch nach 150ms – hilft bei Chromium wenn der Track
    // noch nicht vollständig decodiert ist (typisch bei Screen-Share)
    const playRetryTimer = setTimeout(tryPlay, 150);

    return () => {
      clearTimeout(playRetryTimer);
      try {
        element.pause?.();
        track.detach(element);
      } catch {
        // Detach-Fehler bei schnellen Overlay-Wechseln ignorieren
      }
    };
  }

  async _probeInput() {
    try {
      const probeStream = await navigator.mediaDevices.getUserMedia({
        audio: this._audioConstraints(),
      });
      probeStream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      // In Tauri WebViews permissions may not be available until first real capture.
      // We allow joinChannel to proceed and request mic when actually publishing.
      console.warn("[VoiceEngine] _probeInput failed (will retry on publish):", err.message);
    }
  }

  async _ensureAudioContext() {
    if (this.audioContext) {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      return;
    }

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) return;
    this.audioContext = new AudioContextCtor();
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  async _publishLocalTrack() {
    if (!this.room) return;

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
  }

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
  }

  async _applyMuteState() {
    const shouldEnableMic = !(
      this.isMuted
      || this.micTestActive
      || (this.preferences.pttEnabled && !this.pttActive)
    );

    if (this.inputGainNode) {
      // Gate the published signal at the gain stage so mute/PTT stays strict
      // even if a wrapper-level mute behaves differently across runtimes.
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
        // The explicit gain/track gates above are the hard fallback if a
        // platform-specific wrapper call does not behave exactly as expected.
      }
    }
  }

  _applyInputGain() {
    if (this.inputGainNode) {
      this.inputGainNode.gain.value = clampVolume(this.preferences.inputVolume, 0, 200) / 100;
    }
  }

  _applyRemoteAudioState() {
    const participantIds = new Set(
      Array.from(this.audioElements.values()).map((state) => state.participantId),
    );
    this.room?.remoteParticipants?.forEach((participant) => {
      if (participant?.identity) {
        participantIds.add(participant.identity);
      }
    });
    participantIds.forEach((participantId) => {
      this._applyParticipantAudio(participantId);
    });
  }

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

    // Control the LiveKit subscription at the publication layer, not only on
    // the attached HTMLAudioElement. This keeps local deafen/mute authoritative
    // even when remote PTT or track restarts cause a fresh media pipeline.
    const remoteParticipant = this.room?.remoteParticipants?.get(userId);
    remoteParticipant?.audioTrackPublications?.forEach((publication) => {
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

      // Pausing the attached element makes local deafen immediate even if the
      // transport-level subscription change takes an extra roundtrip.
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
  }

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
  }

  async _applyOutputDevice() {
    if (!this.room) return;

    const deviceId = this.preferences.outputDeviceId;
    if (!deviceId) return;

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
  }

  async _attachAnalysisToStream(stream) {
    await this._ensureAudioContext();
    if (!this.audioContext || !stream) return;

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
  }

  _tickInputLevel() {
    if (!this.analyserNode || !this.analysisData) return;

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
  }

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
  }

  async _startMonitoringStream(stream) {
    await this._ensureAudioContext();
    if (!this.audioContext || !stream) return;

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
  }

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
  }

  _resolveInputThreshold() {
    const sensitivity = clampVolume(this.preferences.inputSensitivity ?? 40, 0, 100);
    return 0.015 + ((sensitivity / 100) * 0.185);
  }

  _bindRoomEvents() {
    if (!this.room) return;

    this.room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
      const source = track.source || Track.Source.Unknown;
      const trackKey = this._trackKey(participant.identity, source);

      if (track.kind === Track.Kind.Audio) {
        const audioEl = track.attach();
        audioEl.autoplay = true;
        audioEl.playsInline = true;
        audioEl.style.display = "none";
        document.body.appendChild(audioEl);
        this.audioElements.set(trackKey, {
          element: audioEl,
          track,
          participantId: participant.identity,
          source,
          publication,
          subscriptionEnabled: true,
          attached: true,
          playbackPaused: false,
        });
        this._applyParticipantAudio(participant.identity);

        if (this.preferences.outputDeviceId && typeof audioEl.setSinkId === "function") {
          try {
            await audioEl.setSinkId(this.preferences.outputDeviceId);
          } catch {
            // Ignore unsupported sink changes on this browser.
          }
        }
      } else if (track.kind === Track.Kind.Video) {
        this.remoteVideoTracks.set(trackKey, {
          track,
          participantId: participant.identity,
          source,
        });
      }

      this._emitRemoteMediaUpdate();
      this._emit("peer_connected", { userId: participant.identity, source, kind: track.kind });
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      const source = track.source || Track.Source.Unknown;
      const trackKey = this._trackKey(participant.identity, source);

      if (track.kind === Track.Kind.Audio) {
        const existing = this.audioElements.get(trackKey);
        if (existing) {
          track.detach(existing.element);
          existing.element.remove();
          this.audioElements.delete(trackKey);
        }
      } else if (track.kind === Track.Kind.Video) {
        this.remoteVideoTracks.delete(trackKey);
      }

      this._setRemoteSpeakerIds(
        this.remoteSpeakerIds.filter((speakerId) => speakerId !== participant.identity),
      );
      this._applyParticipantAudio(participant.identity);
      this._emitRemoteMediaUpdate();
      this._emit("peer_disconnected", { userId: participant.identity, source, kind: track.kind });
    });

    const reapplyRemoteAudioState = (publication, participant, status = null) => {
      if (!participant?.identity || participant.identity === this.userId) {
        return;
      }
      if (publication?.kind && publication.kind !== Track.Kind.Audio) {
        return;
      }

      // Remote PTT toggles the upstream track mute state very frequently. Re-applying
      // the local receive policy on every publication transition keeps deafen/local
      // mute authoritative even when LiveKit re-enables a track internally.
      this._syncAudioPublicationState(participant.identity, publication, status);
      this._applyParticipantAudio(participant.identity);
    };

    this.room.on(RoomEvent.TrackMuted, (publication, participant) => {
      reapplyRemoteAudioState(publication, participant);
    });

    this.room.on(RoomEvent.TrackUnmuted, (publication, participant) => {
      reapplyRemoteAudioState(publication, participant);
    });

    this.room.on(RoomEvent.TrackSubscriptionStatusChanged, (publication, status, participant) => {
      reapplyRemoteAudioState(publication, participant, status);
    });

    this.room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const remoteSpeakerIds = [];
      let localSpeaking = false;
      let localAudioLevel = 0;

      speakers.forEach((participant) => {
        if (participant.identity === this.userId) {
          localSpeaking = true;
          localAudioLevel = participant.audioLevel || 0;
          return;
        }
        remoteSpeakerIds.push(participant.identity);
      });

      this.localSpeaking = localSpeaking;
      this.localAudioLevel = localAudioLevel;
      this.remoteSpeakerIds = remoteSpeakerIds;
      this._emitSpeakingState();
    });

    this.room.on(RoomEvent.Disconnected, (reason) => {
      this.audioElements.forEach(({ element }) => element.remove());
      this.audioElements.clear();
      this.remoteVideoTracks.clear();
      this._resetSpeakingState();
      this._emitRemoteMediaUpdate();
      // Disconnect-Grund weiterleiten damit das Frontend zwischen
      // gewolltem Leave und Kick durch Duplicate-Identity unterscheiden kann.
      // DisconnectReason: 1=CLIENT_INITIATED, 2=DUPLICATE_IDENTITY, etc.
      const reasonCode = typeof reason === "number" ? reason : -1;
      this._emit("disconnected", {
        reason: reasonCode,
        wasClientInitiated: reasonCode === DisconnectReason.CLIENT_INITIATED,
        wasDuplicateIdentity: reasonCode === DisconnectReason.DUPLICATE_IDENTITY,
      });
    });
  }

  _setRemoteSpeakerIds(activeSpeakerIds) {
    this.remoteSpeakerIds = activeSpeakerIds;
    this._emitSpeakingState();
  }

  _getVisibleActiveSpeakerIds() {
    if (this.isDeafened) {
      return [];
    }

    return this.remoteSpeakerIds.filter(
      (speakerId) => !this.preferences.locallyMutedParticipants?.[speakerId],
    );
  }

  _emitSpeakingState() {
    this.activeSpeakerIds = this._getVisibleActiveSpeakerIds();
    this._emit("speaking_update", {
      localSpeaking: this.localSpeaking,
      activeSpeakerIds: [...this.activeSpeakerIds],
      audioLevel: this.localAudioLevel,
    });
  }

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
  }

  _getLocalVideoTrack(source) {
    if (source === Track.Source.Camera) {
      return this.cameraTrack;
    }
    if (source === Track.Source.ScreenShare) {
      return this.screenShareTracks.find((track) => track.kind === Track.Kind.Video) || null;
    }
    return null;
  }

  _trackKey(participantId, source) {
    return `${participantId}:${source || "unknown"}`;
  }

  _buildRemoteMediaParticipants() {
    const participants = new Map();

    this.remoteVideoTracks.forEach(({ participantId, source }) => {
      const nextState = participants.get(participantId) || {
        userId: participantId,
        hasCamera: false,
        hasScreenShare: false,
        hasScreenShareAudio: false,
      };
      if (source === Track.Source.Camera) {
        nextState.hasCamera = true;
      }
      if (source === Track.Source.ScreenShare) {
        nextState.hasScreenShare = true;
      }
      participants.set(participantId, nextState);
    });

    this.audioElements.forEach(({ participantId, source }) => {
      if (source !== Track.Source.ScreenShareAudio) {
        return;
      }
      const nextState = participants.get(participantId) || {
        userId: participantId,
        hasCamera: false,
        hasScreenShare: false,
        hasScreenShareAudio: false,
      };
      nextState.hasScreenShareAudio = true;
      participants.set(participantId, nextState);
    });

    return Array.from(participants.values());
  }

  _emitRemoteMediaUpdate() {
    this._emit("media_tracks_update", {
      participants: this._buildRemoteMediaParticipants(),
      local: {
        userId: this.userId,
        hasCamera: Boolean(this.cameraTrack),
        hasScreenShare: this.screenShareTracks.some((track) => track.kind === Track.Kind.Video),
        hasScreenShareAudio: this.screenShareTracks.some((track) => track.source === Track.Source.ScreenShareAudio),
      },
    });
  }

  _requiresTrackRestart(nextPreferences) {
    return [
      "inputDeviceId",
      "noiseSuppression",
      "echoCancellation",
      "autoGainControl",
    ].some((key) => Object.prototype.hasOwnProperty.call(nextPreferences, key));
  }

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
  }

  _emit(type, extra = {}) {
    const payload = { type, ...extra };
    this.onStateChange?.(payload);
    this.listeners.forEach((listener) => listener(payload));
  }
}
