// Singra Vox - Privacy-first communication platform
// Copyright (C) 2026  Maik Haedrich
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use tauri::State;

use crate::native_capture::DesktopCaptureStore;
use crate::native_livekit::NativeScreenShareStore;
use crate::screen_share::session::{
    DesktopCaptureSourceSummary, NativeScreenShareSessionInfo, NativeScreenShareStartInput,
};

#[tauri::command]
pub async fn list_capture_sources(
    store: State<'_, DesktopCaptureStore>,
) -> Result<Vec<DesktopCaptureSourceSummary>, String> {
    crate::screen_share::capture::list_capture_sources(store).await
}

#[tauri::command]
pub async fn start_native_screen_share(
    input: NativeScreenShareStartInput,
    capture_store: State<'_, DesktopCaptureStore>,
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<NativeScreenShareSessionInfo, String> {
    crate::screen_share::publisher::start_native_screen_share(input, capture_store, screen_share_store)
        .await
}

#[tauri::command]
pub async fn stop_native_screen_share(
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<bool, String> {
    crate::screen_share::publisher::stop_native_screen_share(screen_share_store).await
}

#[tauri::command]
pub fn update_native_screen_share_key(
    shared_media_key_b64: String,
    key_index: Option<i32>,
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<bool, String> {
    crate::screen_share::publisher::update_native_screen_share_key(
        shared_media_key_b64,
        key_index,
        screen_share_store,
    )
}

#[tauri::command]
pub fn update_native_screen_share_audio_volume(
    volume: u32,
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<bool, String> {
    crate::screen_share::audio::update_native_screen_share_audio_volume(volume, screen_share_store)
}

#[tauri::command]
pub fn get_native_screen_share_session(
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<Option<NativeScreenShareSessionInfo>, String> {
    crate::screen_share::publisher::get_native_screen_share_session(screen_share_store)
}
