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
    _volume: u32,
    _screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<bool, String> {
    Err("Native Linux system-audio capture requires a PipeWire backend and is not implemented in this build yet.".into())
}
