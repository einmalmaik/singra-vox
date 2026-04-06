// Singra Vox - Privacy-first communication platform
// Copyright (C) 2026  Maik Haedrich
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::State;

#[cfg(target_os = "windows")]
use crabgrab::{
    feature::bitmap::{FrameBitmap, VideoFrameBitmap},
    prelude::{CapturableContent, CapturableContentFilter, CapturableDisplay, CapturableWindow, CaptureConfig, CapturePixelFormat, CaptureStream, StreamEvent},
};

#[derive(Default)]
pub struct DesktopCaptureStore {
    #[cfg(target_os = "windows")]
    inner: Arc<Mutex<DesktopCaptureState>>,
}

#[cfg(target_os = "windows")]
#[derive(Default)]
struct DesktopCaptureState {
    sources: HashMap<String, CaptureSourceHandle>,
    active_session: Option<ActiveCaptureSession>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
enum CaptureSourceHandle {
    Display(CapturableDisplay),
    Window(CapturableWindow),
}

#[cfg(target_os = "windows")]
struct ActiveCaptureSession {
    source_id: String,
    source_kind: String,
    source_label: String,
    requested_width: u32,
    requested_height: u32,
    requested_frame_rate: u32,
    latest_frame: Arc<Mutex<Option<LatestCaptureFrame>>>,
    stream: CaptureStream,
}

#[cfg(target_os = "windows")]
#[derive(Clone)]
struct LatestCaptureFrame {
    frame_id: u64,
    width: u32,
    height: u32,
    rgba_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCaptureSourceSummary {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub app_name: Option<String>,
    pub app_identifier: Option<String>,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopCaptureSessionInfo {
    pub active: bool,
    pub provider: String,
    pub source_id: String,
    pub source_kind: String,
    pub source_label: String,
    pub requested_width: u32,
    pub requested_height: u32,
    pub requested_frame_rate: u32,
    pub has_audio: bool,
}

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct EnumeratedSource {
    summary: DesktopCaptureSourceSummary,
    handle: CaptureSourceHandle,
}

#[cfg(target_os = "windows")]
fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis()
}

#[cfg(target_os = "windows")]
fn fit_output_size(source_width: u32, source_height: u32, max_width: u32, max_height: u32) -> crabgrab::prelude::Size {
    let safe_source_width = source_width.max(1);
    let safe_source_height = source_height.max(1);
    let safe_max_width = max_width.max(1);
    let safe_max_height = max_height.max(1);

    let width_scale = safe_max_width as f64 / safe_source_width as f64;
    let height_scale = safe_max_height as f64 / safe_source_height as f64;
    let scale = width_scale.min(height_scale).min(1.0);

    let scaled_width = (safe_source_width as f64 * scale).round().max(1.0);
    let scaled_height = (safe_source_height as f64 * scale).round().max(1.0);

    crabgrab::prelude::Size {
        width: scaled_width,
        height: scaled_height,
    }
}

#[cfg(target_os = "windows")]
async fn enumerate_sources() -> Result<Vec<EnumeratedSource>, String> {
    let content = CapturableContent::new(CapturableContentFilter::EVERYTHING_NORMAL)
        .await
        .map_err(|error| format!("Native capture sources could not be loaded: {error}"))?;

    let mut sources = Vec::new();

    for (index, display) in content.displays().enumerate() {
        let rect = display.rect();
        sources.push(EnumeratedSource {
            summary: DesktopCaptureSourceSummary {
                id: format!("display:{index}"),
                kind: "display".into(),
                label: format!("Display {}", index + 1),
                app_name: None,
                app_identifier: None,
                width: rect.size.width as u32,
                height: rect.size.height as u32,
            },
            handle: CaptureSourceHandle::Display(display.clone()),
        });
    }

    let mut window_index = 0usize;
    for window in content.windows() {
        let title = window.title();
        let app = window.application();
        let app_name = app.name();
        if title.trim().is_empty() || title.trim() == "Singra Vox" {
            continue;
        }

        let rect = window.rect();
        sources.push(EnumeratedSource {
            summary: DesktopCaptureSourceSummary {
                id: format!("window:{}:{window_index}", app.pid()),
                kind: "window".into(),
                label: title.clone(),
                app_name: Some(app_name),
                app_identifier: Some(app.identifier()),
                width: rect.size.width as u32,
                height: rect.size.height as u32,
            },
            handle: CaptureSourceHandle::Window(window.clone()),
        });
        window_index += 1;
    }

    Ok(sources)
}

#[cfg(target_os = "windows")]
fn encode_frame_to_rgba(frame: crabgrab::prelude::VideoFrame) -> Result<LatestCaptureFrame, String> {
    let frame_id = frame.frame_id();
    let bitmap = frame
        .get_bitmap()
        .map_err(|error| format!("Native frame bitmap conversion failed: {error}"))?;

    match bitmap {
        FrameBitmap::BgraUnorm8x4(bitmap) => {
            let width = bitmap.width as u32;
            let height = bitmap.height as u32;
            let pixel_count = (width * height) as usize;

            // Pre-allokierter Ausgabepuffer (verhindert ständige Re-Allokationen via .push)
            let mut rgba_bytes = vec![0u8; pixel_count * 4];

            // chunks_exact + zip: LLVM/SIMD-Vektorisierung (AVX2 auf x86, NEON auf ARM)
            // Statt 4× push() pro Pixel → direkter Speicherzugriff auf vorallokierten Buffer
            for (bgra, rgba) in bitmap.data.as_ref().iter().zip(rgba_bytes.chunks_exact_mut(4)) {
                rgba[0] = bgra[2]; // R ← B (BGRA → RGBA Swap)
                rgba[1] = bgra[1]; // G bleibt
                rgba[2] = bgra[0]; // B ← R (BGRA → RGBA Swap)
                rgba[3] = bgra[3]; // A bleibt
            }

            Ok(LatestCaptureFrame {
                frame_id,
                width,
                height,
                rgba_bytes,
            })
        }
        _ => Err("The native capture backend returned an unsupported pixel format.".into()),
    }
}

#[cfg(target_os = "windows")]
async fn start_capture_inner(
    source_id: String,
    requested_width: u32,
    requested_height: u32,
    requested_frame_rate: u32,
    store: &DesktopCaptureStore,
) -> Result<DesktopCaptureSessionInfo, String> {
    let token = match CaptureStream::test_access(true) {
        Some(token) => token,
        None => CaptureStream::request_access(true)
            .await
            .ok_or_else(|| "Native capture access was denied by Windows.".to_string())?,
    };

    let source_known = {
        let guard = store
            .inner
            .lock()
            .map_err(|_| "Native capture state is unavailable.".to_string())?;
        guard.sources.contains_key(&source_id)
    };

    if !source_known {
        let fresh_sources = enumerate_sources().await?;
        let mut guard = store
            .inner
            .lock()
            .map_err(|_| "Native capture state is unavailable.".to_string())?;
        guard.sources.clear();
        for source in fresh_sources {
            guard.sources.insert(source.summary.id.clone(), source.handle);
        }
    }

    let source_handle = {
        let guard = store
            .inner
            .lock()
            .map_err(|_| "Native capture state is unavailable.".to_string())?;
        guard
            .sources
            .get(&source_id)
            .cloned()
            .ok_or_else(|| "The selected capture source is no longer available.".to_string())?
    };

    let (source_kind, source_label, config) = match source_handle {
        CaptureSourceHandle::Display(display) => {
            let rect = display.rect();
            let output_size = fit_output_size(
                rect.size.width as u32,
                rect.size.height as u32,
                requested_width,
                requested_height,
            );
            let label = format!("Display {}x{}", rect.size.width, rect.size.height);
            (
                "display".to_string(),
                label,
                CaptureConfig::with_display(display, CapturePixelFormat::Bgra8888)
                    .with_show_cursor(true)
                    .with_buffer_count(2)
                    .with_output_size(output_size),
            )
        }
        CaptureSourceHandle::Window(window) => {
            let rect = window.rect();
            let output_size = fit_output_size(
                rect.size.width as u32,
                rect.size.height as u32,
                requested_width,
                requested_height,
            );
            let label = window.title();
            (
                "window".to_string(),
                label,
                CaptureConfig::with_window(window, CapturePixelFormat::Bgra8888)
                    .map_err(|_| "The selected window cannot be captured with the native backend.".to_string())?
                    .with_show_cursor(true)
                    .with_buffer_count(2)
                    .with_output_size(output_size),
            )
        }
    };

    let latest_frame = Arc::new(Mutex::new(None));
    let latest_frame_ref = latest_frame.clone();
    let frame_interval_ms = (1000u32 / requested_frame_rate.max(1)).max(16);
    let last_encoded_ms = Arc::new(Mutex::new(0u128));
    let last_encoded_ms_ref = last_encoded_ms.clone();

    let stream = CaptureStream::new(token, config, move |result| {
        let Ok(event) = result else {
            return;
        };

        if let StreamEvent::Video(frame) = event {
            let now = now_millis();
            let mut should_encode = false;
            if let Ok(mut last_ts) = last_encoded_ms_ref.lock() {
                if now.saturating_sub(*last_ts) >= frame_interval_ms as u128 {
                    *last_ts = now;
                    should_encode = true;
                }
            }

            if !should_encode {
                return;
            }

            if let Ok(encoded_frame) = encode_frame_to_rgba(frame) {
                if let Ok(mut frame_slot) = latest_frame_ref.lock() {
                    *frame_slot = Some(encoded_frame);
                }
            }
        }
    })
    .map_err(|error| format!("The native capture stream could not be started: {error}"))?;

    let session_info = DesktopCaptureSessionInfo {
        active: true,
        provider: "tauri-native".into(),
        source_id: source_id.clone(),
        source_kind: source_kind.clone(),
        source_label: source_label.clone(),
        requested_width,
        requested_height,
        requested_frame_rate,
        // Desktop audio capture is not wired into the public frontend bridge yet.
        has_audio: false,
    };

    let mut guard = store
        .inner
        .lock()
        .map_err(|_| "Native capture state is unavailable.".to_string())?;

    if let Some(mut active_session) = guard.active_session.take() {
        let _ = active_session.stream.stop();
    }

    guard.active_session = Some(ActiveCaptureSession {
        source_id,
        source_kind,
        source_label,
        requested_width,
        requested_height,
        requested_frame_rate,
        latest_frame,
        stream,
    });

    Ok(session_info)
}

#[tauri::command]
pub async fn list_capture_sources(
    store: State<'_, DesktopCaptureStore>,
) -> Result<Vec<DesktopCaptureSourceSummary>, String> {
    #[cfg(target_os = "windows")]
    {
        let sources = enumerate_sources().await?;
        let mut guard = store
            .inner
            .lock()
            .map_err(|_| "Native capture state is unavailable.".to_string())?;

        guard.sources.clear();
        let mut summaries = Vec::with_capacity(sources.len());
        for source in sources {
            summaries.push(source.summary.clone());
            guard.sources.insert(source.summary.id.clone(), source.handle);
        }

        return Ok(summaries);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = store;
        Err("Native desktop capture is currently only implemented for Windows builds.".into())
    }
}

#[tauri::command]
pub async fn start_desktop_capture(
    source_id: String,
    requested_width: Option<u32>,
    requested_height: Option<u32>,
    requested_frame_rate: Option<u32>,
    store: State<'_, DesktopCaptureStore>,
) -> Result<DesktopCaptureSessionInfo, String> {
    #[cfg(target_os = "windows")]
    {
        return start_capture_inner(
            source_id,
            requested_width.unwrap_or(1920),
            requested_height.unwrap_or(1080),
            requested_frame_rate.unwrap_or(30),
            &store,
        )
        .await;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = source_id;
        let _ = requested_width;
        let _ = requested_height;
        let _ = requested_frame_rate;
        let _ = store;
        Err("Native desktop capture is currently only implemented for Windows builds.".into())
    }
}

#[tauri::command]
pub fn stop_desktop_capture(
    store: State<'_, DesktopCaptureStore>,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let mut guard = store
            .inner
            .lock()
            .map_err(|_| "Native capture state is unavailable.".to_string())?;

        if let Some(mut active_session) = guard.active_session.take() {
            let _ = active_session.stream.stop();
            return Ok(true);
        }

        return Ok(false);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = store;
        Err("Native desktop capture is currently only implemented for Windows builds.".into())
    }
}

#[tauri::command]
pub fn get_desktop_capture_frame(
    last_frame_id: Option<u64>,
    store: State<'_, DesktopCaptureStore>,
) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "windows")]
    {
        let guard = store
            .inner
            .lock()
            .map_err(|_| "Native capture state is unavailable.".to_string())?;

        let Some(active_session) = guard.active_session.as_ref() else {
            return Ok(Vec::new());
        };

        let frame_guard = active_session
            .latest_frame
            .lock()
            .map_err(|_| "The latest native frame is unavailable.".to_string())?;

        let Some(frame) = frame_guard.as_ref() else {
            return Ok(Vec::new());
        };

        if last_frame_id == Some(frame.frame_id) {
            return Ok(Vec::new());
        }

        let mut payload = Vec::with_capacity(16 + frame.rgba_bytes.len());
        payload.extend_from_slice(&frame.frame_id.to_le_bytes());
        payload.extend_from_slice(&frame.width.to_le_bytes());
        payload.extend_from_slice(&frame.height.to_le_bytes());
        payload.extend_from_slice(&frame.rgba_bytes);
        return Ok(payload);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = last_frame_id;
        let _ = store;
        Err("Native desktop capture is currently only implemented for Windows builds.".into())
    }
}

#[tauri::command]
pub fn get_desktop_capture_session(
    store: State<'_, DesktopCaptureStore>,
) -> Result<Option<DesktopCaptureSessionInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        let guard = store
            .inner
            .lock()
            .map_err(|_| "Native capture state is unavailable.".to_string())?;

        return Ok(guard.active_session.as_ref().map(|session| DesktopCaptureSessionInfo {
            active: true,
            provider: "tauri-native".into(),
            source_id: session.source_id.clone(),
            source_kind: session.source_kind.clone(),
            source_label: session.source_label.clone(),
            requested_width: session.requested_width,
            requested_height: session.requested_height,
            requested_frame_rate: session.requested_frame_rate,
            has_audio: false,
        }));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = store;
        Err("Native desktop capture is currently only implemented for Windows builds.".into())
    }
}
