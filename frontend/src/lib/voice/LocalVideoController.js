/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { createLocalVideoTrack } from "livekit-client";

export const localVideoMethods = {
  async toggleCamera() {
    if (!this.room) {
      return false;
    }

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
  },

  async stopCamera() {
    if (!this.cameraTrack) {
      return;
    }

    if (this.room?.localParticipant) {
      try {
        await this.room.localParticipant.unpublishTrack(this.cameraTrack, false);
      } catch (error) {
        this.logger.warn("camera unpublish failed", { event: "camera_unpublish" }, error);
      }
    }

    this.cameraTrack.stop();
    this.cameraTrack = null;
    this._emitRemoteMediaUpdate();
    this._emit("camera_change", { enabled: false });
  },
};
