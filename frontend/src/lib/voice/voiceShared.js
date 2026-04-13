/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

export function clampVolume(value, min = 0, max = 200) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function clampUnit(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function getAudioContextCtor() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.AudioContext || window.webkitAudioContext || null;
}

export function computeRms(dataArray) {
  if (!dataArray?.length) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < dataArray.length; index += 1) {
    const sample = (dataArray[index] - 128) / 128;
    sum += sample * sample;
  }

  return Math.sqrt(sum / dataArray.length);
}

export function buildVoiceRoomName(serverId, channelId) {
  if (!serverId || !channelId) {
    return null;
  }

  return `server-${serverId}-channel-${channelId}`;
}
