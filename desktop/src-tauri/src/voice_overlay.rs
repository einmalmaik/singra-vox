/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

//! Voice Overlay – Transparentes Always-On-Top Fenster
//!
//! Zeigt über Spielen/Anwendungen an wer gerade spricht + E2EE-Status.
//! Das Fenster ist:
//!   - Transparent (durchklickbar für den Bereich ohne UI)
//!   - Always-On-Top (über allen Fenstern, auch Vollbild-Spielen)
//!   - Verschiebbar (Drag & Drop)
//!   - Ein/Aus per Hotkey (Ctrl+Shift+O default)
//!
//! # Architektur
//!
//! Das Overlay ist ein separates Tauri-Fenster (`WebviewWindow`) das eine
//! eigene React-Seite rendert (`/overlay`). Die Sprechdaten kommen per
//! Tauri IPC Events vom Hauptfenster.
//!
//! ```
//! [VoiceEngine] → [IPC Event: speaking_update] → [Overlay-Fenster]
//! ```
//!
//! # Plattform-Limitationen
//!
//! - Windows: `WS_EX_LAYERED` + `WS_EX_TRANSPARENT` für Click-Through
//! - macOS: `NSWindow.ignoresMouseEvents` für Click-Through
//! - Linux: Compositor-abhängig, nicht garantiert

use tauri::Manager;

/// Erstellt das Overlay-Fenster (unsichtbar bis es aktiviert wird).
/// Wird beim App-Start aufgerufen.
#[tauri::command]
pub async fn create_overlay(app: tauri::AppHandle) -> Result<(), String> {
    // Prüfe ob das Fenster schon existiert
    if app.get_webview_window("overlay").is_some() {
        return Ok(());
    }

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        "overlay",
        tauri::WebviewUrl::App("/overlay".into()),
    )
    .title("Singra Vox Overlay")
    .inner_size(300.0, 200.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .resizable(false)
    .skip_taskbar(true)
    .visible(false) // Erst sichtbar wenn aktiviert
    .build()
    .map_err(|e| format!("Overlay-Fenster konnte nicht erstellt werden: {e}"))?;

    Ok(())
}

/// Zeigt oder versteckt das Overlay-Fenster.
#[tauri::command]
pub async fn toggle_overlay(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app.get_webview_window("overlay")
        .ok_or("Overlay-Fenster nicht gefunden")?;

    let visible = window.is_visible().map_err(|e| e.to_string())?;

    if visible {
        window.hide().map_err(|e| e.to_string())?;
    } else {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }

    Ok(!visible)
}

/// Sendet Sprech-Updates an das Overlay-Fenster.
/// Wird vom Frontend aufgerufen wenn sich der Sprechstatus ändert.
#[tauri::command]
pub fn update_overlay_speakers(
    app: tauri::AppHandle,
    speakers: Vec<OverlaySpeaker>,
    e2ee_active: bool,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overlay") {
        let payload = serde_json::json!({
            "speakers": speakers,
            "e2ee_active": e2ee_active,
        });
        window.emit("overlay-speakers-update", payload)
            .map_err(|e| format!("Event senden fehlgeschlagen: {e}"))?;
    }
    Ok(())
}

/// Repräsentiert einen Sprecher im Overlay.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OverlaySpeaker {
    pub user_id: String,
    pub display_name: String,
    pub is_speaking: bool,
    pub is_muted: bool,
    pub is_deafened: bool,
    /// Hex-Farbe der höchsten Rolle
    pub role_color: Option<String>,
}
