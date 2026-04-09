// Singra Vox - Privacy-first communication platform
// Copyright (C) 2026  Maik Haedrich
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use serde::Serialize;

pub use crate::native_capture::DesktopCaptureSourceSummary;
pub use crate::native_livekit::{NativeScreenShareSessionInfo, NativeScreenShareStartInput};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenShareCapabilities {
    pub supports_native_capture: bool,
    pub supports_system_audio: bool,
    pub supports_audio_volume_control: bool,
    pub supports_window_audio: bool,
}

impl ScreenShareCapabilities {
    pub fn current() -> Self {
        #[cfg(target_os = "windows")]
        {
            return Self {
                supports_native_capture: true,
                supports_system_audio: true,
                supports_audio_volume_control: true,
                supports_window_audio: false,
            };
        }

        #[cfg(target_os = "macos")]
        {
            return Self {
                supports_native_capture: false,
                supports_system_audio: false,
                supports_audio_volume_control: false,
                supports_window_audio: false,
            };
        }

        #[cfg(target_os = "linux")]
        {
            return Self {
                supports_native_capture: false,
                supports_system_audio: false,
                supports_audio_volume_control: false,
                supports_window_audio: false,
            };
        }

        #[allow(unreachable_code)]
        Self {
            supports_native_capture: false,
            supports_system_audio: false,
            supports_audio_volume_control: false,
            supports_window_audio: false,
        }
    }
}
