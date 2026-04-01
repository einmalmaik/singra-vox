import api from "@/lib/api";
import { Room, RoomEvent, Track, createLocalScreenTracks, createLocalVideoTrack } from "livekit-client";
import { getDefaultVoicePreferences } from "@/lib/voicePreferences";

function clampVolume(value, min = 0, max = 200) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function clampUnit(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

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

    if (this.room && this._requiresTrackRestart(nextPreferences)) {
      await this.restartLocalTrack();
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
    this.cameraTrack = await createLocalVideoTrack();
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

  async startScreenShare(options = {}) {
    if (!this.room) return false;
    const {
      audio = false,
      displaySurface = "monitor",
      resolution = { width: 1920, height: 1080, frameRate: 60 },
    } = options;

    this.screenShareTracks = await createLocalScreenTracks({
      // Screen-share audio is separate from the microphone track. Requesting it
      // as a boolean lets getDisplayMedia negotiate native system/tab audio
      // support instead of reusing microphone-specific constraints.
      audio: Boolean(audio),
      video: { displaySurface },
      resolution,
      systemAudio: audio ? "include" : "exclude",
      surfaceSwitching: "include",
      selfBrowserSurface: "exclude",
      suppressLocalAudioPlayback: true,
      contentHint: "detail",
    });

    this.screenShareTracks.forEach((track) => {
      track.mediaStreamTrack?.addEventListener("ended", () => {
        if (this.screenShareTracks.includes(track)) {
          void this.stopScreenShare();
        }
      }, { once: true });
    });
    await Promise.all(
      this.screenShareTracks.map((track) => this.room.localParticipant.publishTrack(track)),
    );
    this._emitRemoteMediaUpdate();
    this._emit("screen_share_change", { enabled: true });
    return true;
  }

  async stopScreenShare() {
    if (!this.room || this.screenShareTracks.length === 0) return;
    await Promise.all(
      this.screenShareTracks.map((track) => this.room.localParticipant.unpublishTrack(track, false)),
    );
    this.screenShareTracks.forEach((track) => track.stop());
    this.screenShareTracks = [];
    this._emitRemoteMediaUpdate();
    this._emit("screen_share_change", { enabled: false });
  }

  attachParticipantMediaElement(participantId, source, element) {
    if (!element) {
      return () => {};
    }

    const normalizedSource = source || Track.Source.Camera;
    const track = participantId === this.userId
      ? this._getLocalVideoTrack(normalizedSource)
      : this.remoteVideoTracks.get(this._trackKey(participantId, normalizedSource))?.track;

    if (!track) {
      return () => {};
    }

    element.autoplay = true;
    element.playsInline = true;
    element.muted = participantId === this.userId;
    track.attach(element);

    return () => {
      try {
        track.detach(element);
      } catch {
        // Ignore detach errors during rapid overlay switches.
      }
    };
  }

  async _probeInput() {
    const probeStream = await navigator.mediaDevices.getUserMedia({
      audio: this._audioConstraints(),
    });
    probeStream.getTracks().forEach((track) => track.stop());
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

    this.audioElements.forEach((state) => {
      if (state.participantId !== userId) {
        return;
      }
      state.element.muted = !shouldReceiveAudio;
      state.element.volume = shouldReceiveAudio ? Math.min(2, baseVolume * participantVolume) : 0;

      // Keep the transport subscription aligned with the local mute/deafen
      // state. Relying on the HTMLAudioElement alone proved flaky across web and
      // desktop, while publication.setEnabled(false) stops new data for this
      // client without affecting other listeners.
      const desiredEnabled = shouldReceiveAudio;
      if (state.subscriptionEnabled !== desiredEnabled && typeof state.publication?.setEnabled === "function") {
        state.subscriptionEnabled = desiredEnabled;
        void state.publication.setEnabled(desiredEnabled).catch(() => {
          state.subscriptionEnabled = !desiredEnabled;
        });
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
          participantId: participant.identity,
          source,
          publication,
          subscriptionEnabled: true,
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

      this._setActiveSpeakerIds(
        this.activeSpeakerIds.filter((speakerId) => speakerId !== participant.identity),
      );
      this._emitRemoteMediaUpdate();
      this._emit("peer_disconnected", { userId: participant.identity, source, kind: track.kind });
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
      this.activeSpeakerIds = remoteSpeakerIds;
      this._emit("speaking_update", {
        localSpeaking,
        activeSpeakerIds: [...remoteSpeakerIds],
        audioLevel: localAudioLevel,
      });
    });

    this.room.on(RoomEvent.Disconnected, () => {
      this.audioElements.forEach(({ element }) => element.remove());
      this.audioElements.clear();
      this.remoteVideoTracks.clear();
      this._resetSpeakingState();
      this._emitRemoteMediaUpdate();
      this._emit("disconnected");
    });
  }

  _setActiveSpeakerIds(activeSpeakerIds) {
    this.activeSpeakerIds = activeSpeakerIds;
    this._emit("speaking_update", {
      localSpeaking: this.localSpeaking,
      activeSpeakerIds: [...this.activeSpeakerIds],
      audioLevel: this.localAudioLevel,
    });
  }

  _resetSpeakingState() {
    this.localSpeaking = false;
    this.localAudioLevel = 0;
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
