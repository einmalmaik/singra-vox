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
 * voiceEngine.js - Stable facade for the voice and streaming stack.
 *
 * Why this file still exists:
 * The UI depends on `new VoiceEngine()` and a long-lived method/event surface.
 * We keep that API stable and move behavior into focused controllers so join,
 * local media, screen share, remote media and preview lifecycle can evolve
 * independently and be tested in isolation.
 */

import { createSingleFlightController } from "@/lib/asyncControl";
import { getDefaultVoicePreferences } from "@/lib/voicePreferences";
import { createVoiceLogger } from "./voice/VoiceLogger";
import { createScreenShareProxyMap } from "./voice/ScreenShareProxyMap";
import { localAudioMethods } from "./voice/LocalAudioController";
import { localVideoMethods } from "./voice/LocalVideoController";
import { remoteAudioMethods } from "./voice/RemoteAudioController";
import { remoteVideoMethods } from "./voice/RemoteVideoController";
import { remoteMediaMethods } from "./voice/RemoteMediaController";
import { screenShareMethods } from "./voice/ScreenShareController";
import { voiceSessionMethods } from "./voice/VoiceSessionController";

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

    this.audioElements = new Map();
    this.screenShareProxyMap = createScreenShareProxyMap();
    this.videoTrackRefsById = new Map();
    this.remoteVideoTrackRevisions = new Map();
    this.onStateChange = null;
    this.listeners = new Set();

    this.localSpeaking = false;
    this.localAudioLevel = 0;
    this.remoteSpeakerIds = [];
    this.activeSpeakerIds = [];
    this.autoSensitivityFloor = 0.015;
    this.currentInputThreshold = 0.089;
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
    this.localVideoTrackRevisions = {
      camera: { track: null, revision: 0 },
      screenShare: { track: null, revision: 0 },
    };

    this.screenShareAudioGain = null;
    this.screenShareAudioSourceNode = null;
    this.screenShareAudioDest = null;
    this.screenShareAudioVolume = 100;
    this.runSingleFlight = createSingleFlightController();
    this.currentInputThreshold = this._resolveInputThreshold();
    this.logger = createVoiceLogger(() => ({
      serverId: this.serverId,
      channelId: this.channelId,
      userId: this.userId,
      platform: this.runtimeConfig?.platform || (this.runtimeConfig?.isDesktop ? "desktop" : "web"),
    }));
  }
}

Object.assign(
  VoiceEngine.prototype,
  voiceSessionMethods,
  localAudioMethods,
  localVideoMethods,
  remoteAudioMethods,
  remoteVideoMethods,
  screenShareMethods,
  remoteMediaMethods,
);
