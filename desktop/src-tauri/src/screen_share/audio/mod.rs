// Singra Vox - Privacy-first communication platform
// Copyright (C) 2026  Maik Haedrich
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "linux")]
mod linux;

#[cfg(target_os = "windows")]
pub use windows::update_native_screen_share_audio_volume;
#[cfg(target_os = "macos")]
pub use macos::update_native_screen_share_audio_volume;
#[cfg(target_os = "linux")]
pub use linux::update_native_screen_share_audio_volume;
