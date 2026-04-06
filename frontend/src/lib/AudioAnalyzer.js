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
 * AudioAnalyzer – WebAudio-Schicht der VoiceEngine
 *
 * Verantwortlich für:
 *  - AudioContext-Lifecycle (erstellen, aufwecken, schließen)
 *  - Eingangs-Gain-Kette (Mikrofon → Gain-Node → Destination)
 *  - Mikrofon-Pegel-Analyse (AnalyserNode, RMS, Threshold, Auto-Sensitivity)
 *  - Monitoring-Stream (Kopfhörer-Test)
 *
 * Kein LiveKit, kein Tauri, keine API-Calls.
 * Kann in Desktop-Client, Mobile-App oder Browser gleichermaßen eingesetzt
 * werden, sofern die Web-Audio-API verfügbar ist.
 */

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

function clampUnit(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function clampVolume(value, min = 0, max = 200) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export class AudioAnalyzer {
  constructor({ onInputLevel, onAutoThreshold } = {}) {
    /** @type {AudioContext|null} */
    this.audioContext = null;

    // Gain-Kette für das lokale Mikrofon
    this.inputGainNode = null;
    this.inputDestination = null;

    // Analyser (Pegel-Meter)
    this.analyserNode = null;
    this.analysisSourceNode = null;
    this.analysisData = null;
    this.analysisStream = null;
    this.analysisFrame = null;

    // Auto-Sensitivity
    this.autoSensitivityFloor = 0;
    this.currentInputThreshold = 0.02;

    // Monitoring (Mic-Test-Playback)
    this.monitorSourceNode = null;
    this.monitorGainNode = null;
    this.monitorDestination = null;
    this.monitorAudioElement = null;

    // Callbacks
    this._onInputLevel = onInputLevel ?? (() => {});
    this._onAutoThreshold = onAutoThreshold ?? (() => {});
  }

  // ── AudioContext ────────────────────────────────────────────────────────────

  async ensureContext() {
    if (this.audioContext) {
      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume();
      }
      return;
    }
    const Ctor = getAudioContextCtor();
    if (!Ctor) return;
    this.audioContext = new Ctor();
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  async closeContext() {
    this.stopAnalysis();
    this.stopMonitoring();
    if (this.audioContext) {
      try { await this.audioContext.close(); } catch { /* ignore */ }
      this.audioContext = null;
    }
  }

  // ── Gain-Kette ──────────────────────────────────────────────────────────────

  /**
   * Verknüpft einen MediaStream mit der Gain-Kette.
   * Gibt den aufbereiteten Track zurück, der an LiveKit gepublisht werden soll.
   */
  async buildInputChain(rawStream, volumePct = 100) {
    await this.ensureContext();
    if (!this.audioContext) return rawStream.getAudioTracks()[0] ?? null;

    const sourceNode = this.audioContext.createMediaStreamSource(rawStream);
    this.inputGainNode = this.audioContext.createGain();
    this.inputDestination = this.audioContext.createMediaStreamDestination();

    sourceNode.connect(this.inputGainNode);
    this.inputGainNode.connect(this.inputDestination);
    this.setInputVolume(volumePct);

    return this.inputDestination.stream.getAudioTracks()[0]
      ?? rawStream.getAudioTracks()[0];
  }

  setInputVolume(volumePct) {
    if (this.inputGainNode) {
      this.inputGainNode.gain.value = clampVolume(volumePct, 0, 200) / 100;
    }
  }

  teardownInputChain() {
    this.inputGainNode = null;
    this.inputDestination = null;
  }

  // ── Analyser (Pegel-Messung) ────────────────────────────────────────────────

  async attachAnalysis(stream, { autoSensitivity = false, thresholdOverride = 0.02 } = {}) {
    await this.ensureContext();
    if (!this.audioContext || !stream) return;
    if (this.analysisStream === stream && this.analyserNode) return;

    this.stopAnalysis();
    this.analysisStream = stream;
    this._autoSensitivity = autoSensitivity;
    this._thresholdOverride = thresholdOverride;

    this.analysisSourceNode = this.audioContext.createMediaStreamSource(stream);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analysisData = new Uint8Array(this.analyserNode.fftSize);
    this.analysisSourceNode.connect(this.analyserNode);
    this._tick();
  }

  _tick() {
    if (!this.analyserNode || !this.analysisData) return;

    this.analyserNode.getByteTimeDomainData(this.analysisData);
    const rms = computeRms(this.analysisData);

    this.autoSensitivityFloor = (this.autoSensitivityFloor * 0.96) + (rms * 0.04);

    if (this._autoSensitivity) {
      this.currentInputThreshold = clampUnit(this.autoSensitivityFloor * 2.8, 0.015, 0.22);
    } else {
      this.currentInputThreshold = this._thresholdOverride ?? 0.02;
    }

    const level = clampUnit(rms * 6, 0, 1);
    this._onInputLevel({
      level,
      rms,
      threshold: this.currentInputThreshold,
      aboveThreshold: rms >= this.currentInputThreshold,
    });

    this.analysisFrame = window.requestAnimationFrame(() => this._tick());
  }

  stopAnalysis() {
    if (this.analysisFrame) {
      window.cancelAnimationFrame(this.analysisFrame);
      this.analysisFrame = null;
    }
    this.analysisData = null;
    this.analysisStream = null;
    try { this.analysisSourceNode?.disconnect(); } catch { /* ignore */ }
    try { this.analyserNode?.disconnect(); } catch { /* ignore */ }
    this.analysisSourceNode = null;
    this.analyserNode = null;
  }

  // ── Monitoring (Mic-Test-Playback) ──────────────────────────────────────────

  async startMonitoring(stream, { volumePct = 100, outputDeviceId = null } = {}) {
    await this.ensureContext();
    if (!this.audioContext || !stream) return;

    this.stopMonitoring();

    this.monitorSourceNode = this.audioContext.createMediaStreamSource(stream);
    this.monitorGainNode = this.audioContext.createGain();
    this.monitorDestination = this.audioContext.createMediaStreamDestination();

    this.monitorSourceNode.connect(this.monitorGainNode);
    this.monitorGainNode.gain.value = clampVolume(volumePct, 0, 200) / 100;
    this.monitorGainNode.connect(this.monitorDestination);

    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.playsInline = true;
    audio.style.display = "none";
    audio.srcObject = this.monitorDestination.stream;
    audio.volume = clampVolume(volumePct, 0, 200) / 100;
    document.body.appendChild(audio);

    if (outputDeviceId && typeof audio.setSinkId === "function") {
      try { await audio.setSinkId(outputDeviceId); } catch { /* ignore */ }
    }

    await audio.play().catch(() => {});
    this.monitorAudioElement = audio;
  }

  stopMonitoring() {
    if (this.monitorAudioElement) {
      this.monitorAudioElement.pause();
      this.monitorAudioElement.remove();
      this.monitorAudioElement = null;
    }
    try { this.monitorSourceNode?.disconnect(); } catch { /* ignore */ }
    try { this.monitorGainNode?.disconnect(); } catch { /* ignore */ }
    this.monitorSourceNode = null;
    this.monitorGainNode = null;
    this.monitorDestination = null;
  }

  // ── Vollständiges Aufräumen ─────────────────────────────────────────────────

  async dispose() {
    this.stopAnalysis();
    this.stopMonitoring();
    this.teardownInputChain();
    await this.closeContext();
  }
}
