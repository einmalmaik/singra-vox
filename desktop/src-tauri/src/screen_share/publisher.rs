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
use crate::screen_share::session::{NativeScreenShareSessionInfo, NativeScreenShareStartInput};

pub async fn start_native_screen_share(
    input: NativeScreenShareStartInput,
    capture_store: State<'_, DesktopCaptureStore>,
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<NativeScreenShareSessionInfo, String> {
    #[cfg(target_os = "windows")]
    {
        return crate::native_livekit::start_native_screen_share(input, capture_store, screen_share_store)
            .await;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = input;
        let _ = capture_store;
        let _ = screen_share_store;
        Err("Native desktop screen-share publishing is not implemented on this platform yet.".into())
    }
}

pub async fn stop_native_screen_share(
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        return crate::native_livekit::stop_native_screen_share(screen_share_store).await;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = screen_share_store;
        Err("Native desktop screen-share publishing is not implemented on this platform yet.".into())
    }
}

pub fn update_native_screen_share_key(
    shared_media_key_b64: String,
    key_index: Option<i32>,
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        return crate::native_livekit::update_native_screen_share_key(
            shared_media_key_b64,
            key_index,
            screen_share_store,
        );
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = shared_media_key_b64;
        let _ = key_index;
        let _ = screen_share_store;
        Err("Native desktop screen-share publishing is not implemented on this platform yet.".into())
    }
}

pub fn get_native_screen_share_session(
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<Option<NativeScreenShareSessionInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        return crate::native_livekit::get_native_screen_share_session(screen_share_store);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = screen_share_store;
        Ok(None)
    }
}
