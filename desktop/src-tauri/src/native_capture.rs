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
use tauri::State;

#[cfg(target_os = "windows")]
use crabgrab::{
    prelude::{CapturableContent, CapturableContentFilter, CapturableDisplay, CapturableWindow, CaptureConfig, CapturePixelFormat},
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
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
pub(crate) enum CaptureSourceHandle {
    Display(CapturableDisplay),
    Window(CapturableWindow),
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

#[cfg(target_os = "windows")]
#[derive(Debug)]
struct EnumeratedSource {
    summary: DesktopCaptureSourceSummary,
    handle: CaptureSourceHandle,
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
pub(crate) async fn refresh_capture_sources(
    store: &DesktopCaptureStore,
) -> Result<Vec<DesktopCaptureSourceSummary>, String> {
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

    Ok(summaries)
}

#[cfg(target_os = "windows")]
pub(crate) async fn ensure_capture_source_handle(
    store: &DesktopCaptureStore,
    source_id: &str,
) -> Result<CaptureSourceHandle, String> {
    let source_known = {
        let guard = store
            .inner
            .lock()
            .map_err(|_| "Native capture state is unavailable.".to_string())?;
        guard.sources.contains_key(source_id)
    };

    if !source_known {
        let _ = refresh_capture_sources(store).await?;
    }

    let guard = store
        .inner
        .lock()
        .map_err(|_| "Native capture state is unavailable.".to_string())?;
    guard
        .sources
        .get(source_id)
        .cloned()
        .ok_or_else(|| "The selected capture source is no longer available.".to_string())
}

#[cfg(target_os = "windows")]
pub(crate) fn build_capture_config(
    source_handle: CaptureSourceHandle,
    requested_width: u32,
    requested_height: u32,
) -> Result<(String, String, CaptureConfig), String> {
    let built = match source_handle {
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

    Ok(built)
}

#[tauri::command]
pub async fn list_capture_sources(
    store: State<'_, DesktopCaptureStore>,
) -> Result<Vec<DesktopCaptureSourceSummary>, String> {
    #[cfg(target_os = "windows")]
    {
        return refresh_capture_sources(&store).await;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = store;
        Err("Native desktop capture is currently only implemented for Windows builds.".into())
    }
}
