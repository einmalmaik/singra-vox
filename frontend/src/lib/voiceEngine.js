import api from "@/lib/api";
import { Room, RoomEvent, Track } from "livekit-client";
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
    this.audioElements = new Map();
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

    this.analysisSourceNode = null;
    this.analyserNode = null;
    this.analysisFrame = null;
    this.analysisData = null;
    this.analysisStream = null;
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

    this.room = new Room({
      adaptiveStream: true,
      dynacast: true,
      webAudioMix: false,
    });

    this._bindRoomEvents();

    await this.room.connect(
      tokenResponse.data.server_url,
      tokenResponse.data.participant_token,
    );

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
    this.isMuted = !this.isMuted;
    void this._applyMuteState();
    this._emit("mute_change", { isMuted: this.isMuted });
    return this.isMuted;
  }

  toggleDeafen() {
    this.isDeafened = !this.isDeafened;
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

    if (this.room && this.localTrackPublication?.track) {
      await this.room.localParticipant.unpublishTrack(this.localTrackPublication.track, false);
    }

    this.localTrackPublication = null;
    this._stopLocalTrackResources();
    await this.stopMicTest();

    if (this.room) {
      this.room.disconnect();
    }
    this.room = null;
    this._resetSpeakingState();
    this._emit("disconnected");
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

    if (this.localTrackPublication?.track) {
      if (shouldEnableMic) {
        await this.localTrackPublication.track.unmute();
      } else {
        await this.localTrackPublication.track.mute();
      }
      return;
    }

    if (this.localPublishedTrack) {
      this.localPublishedTrack.enabled = shouldEnableMic;
    }
  }

  _applyInputGain() {
    if (this.inputGainNode) {
      this.inputGainNode.gain.value = clampVolume(this.preferences.inputVolume, 0, 200) / 100;
    }
  }

  _applyRemoteAudioState() {
    this.audioElements.forEach((_, participantId) => {
      this._applyParticipantAudio(participantId);
    });
  }

  _applyParticipantAudio(userId) {
    const state = this.audioElements.get(userId);
    if (!state) return;

    const baseVolume = clampVolume(this.preferences.outputVolume, 0, 200) / 100;
    const participantVolume = clampVolume(
      this.preferences.perUserVolumes[userId] ?? 100,
      0,
      200,
    ) / 100;
    const locallyMuted = Boolean(this.preferences.locallyMutedParticipants?.[userId]);

    state.element.muted = this.isDeafened || locallyMuted;
    state.element.volume = this.isDeafened || locallyMuted ? 0 : Math.min(2, baseVolume * participantVolume);
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

    this.room.on(RoomEvent.TrackSubscribed, async (track, _publication, participant) => {
      if (track.kind !== Track.Kind.Audio) return;

      const audioEl = track.attach();
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);
      this.audioElements.set(participant.identity, { element: audioEl });
      this._applyParticipantAudio(participant.identity);

      if (this.preferences.outputDeviceId && typeof audioEl.setSinkId === "function") {
        try {
          await audioEl.setSinkId(this.preferences.outputDeviceId);
        } catch {
          // Ignore unsupported sink changes on this browser.
        }
      }

      this._emit("peer_connected", { userId: participant.identity });
    });

    this.room.on(RoomEvent.TrackUnsubscribed, (track, _publication, participant) => {
      if (track.kind !== Track.Kind.Audio) return;

      const existing = this.audioElements.get(participant.identity);
      if (existing) {
        track.detach(existing.element);
        existing.element.remove();
        this.audioElements.delete(participant.identity);
      }
      this._setActiveSpeakerIds(
        this.activeSpeakerIds.filter((speakerId) => speakerId !== participant.identity),
      );
      this._emit("peer_disconnected", { userId: participant.identity });
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
      this._resetSpeakingState();
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
