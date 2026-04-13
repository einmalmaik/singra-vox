// Singra Vox - Privacy-first communication platform
// Copyright (C) 2026  Maik Haedrich
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use tauri::State;

use crate::native_livekit::NativeScreenShareStore;

pub fn update_native_screen_share_audio_volume(
    volume: u32,
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<bool, String> {
    crate::native_livekit::update_native_screen_share_audio_volume(volume, screen_share_store)
}
