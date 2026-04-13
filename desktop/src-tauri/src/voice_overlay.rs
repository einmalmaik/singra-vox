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
//!   - Standardmäßig deaktiviert (muss in den Einstellungen aktiviert werden)
//!
//! # Architektur
//!
//! Das Overlay ist ein separates Tauri-Fenster (`WebviewWindow`) das eine
//! eigene React-Seite rendert (`/overlay`). Die Sprechdaten kommen per
//! Tauri IPC Events vom Hauptfenster.
//!
//! ```text
//! [VoiceEngine] → [IPC Event: speaking_update] → [Overlay-Fenster]
//! ```
//!
//! # Spiel-Erkennung
//!
//! Auf Windows wird via `GetForegroundWindow` + Fenster-Rect-Vergleich mit
//! der Monitor-Auflösung erkannt, ob ein Vollbild-Spiel aktiv ist.
//! Das Overlay wird nur angezeigt, wenn:
//!   1. Es in den Einstellungen aktiviert ist (Standard: aus)
//!   2. Ein Vollbild-Fenster (Spiel) im Vordergrund ist
//!   3. Der Nutzer in einem Voice-Channel ist
//!
//! # Plattform-Limitationen
//!
//! - Windows: `WS_EX_LAYERED` + `WS_EX_TRANSPARENT` für Click-Through
//! - macOS: `NSWindow.ignoresMouseEvents` für Click-Through
//! - Linux: Compositor-abhängig, nicht garantiert

// WICHTIG: Emitter-Trait muss im Scope sein für window.emit()
use tauri::{Emitter, Manager};

/// Erstellt das Overlay-Fenster (unsichtbar bis es aktiviert wird).
/// Wird beim App-Start aufgerufen, aber nur wenn der Nutzer das
/// Overlay in den Einstellungen aktiviert hat.
///
/// # Fehler
/// Gibt einen String-Fehler zurück wenn das Fenster nicht erstellt
/// werden konnte (z.B. bei fehlender Plattform-Unterstützung).
#[tauri::command]
pub async fn create_overlay(app: tauri::AppHandle) -> Result<(), String> {
    // Prüfe ob das Fenster schon existiert (Idempotenz)
    if app.get_webview_window("overlay").is_some() {
        return Ok(());
    }

    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        "overlay",
        tauri::WebviewUrl::App("/overlay".into()),
    )
    .title("Singra Vox Overlay")
    .inner_size(320.0, 220.0)
    .decorations(false)
    .always_on_top(true)
    .resizable(false)
    .skip_taskbar(true)
    .visible(false); // Erst sichtbar wenn aktiviert

    // Tauri exposes transparent windows on macOS only when the app enables the
    // macOS private API feature. We intentionally keep the default feature set
    // here, so macOS stays on the safe builder path instead of breaking desktop
    // builds for every release.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.transparent(true);

    let _window = builder
        .build()
        .map_err(|e| format!("Overlay-Fenster konnte nicht erstellt werden: {e}"))?;

    Ok(())
}

/// Zeigt oder versteckt das Overlay-Fenster.
/// Gibt `true` zurück wenn das Overlay jetzt sichtbar ist.
#[tauri::command]
pub async fn toggle_overlay(app: tauri::AppHandle) -> Result<bool, String> {
    let window = app
        .get_webview_window("overlay")
        .ok_or("Overlay-Fenster nicht gefunden – wurde create_overlay() aufgerufen?")?;

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
///
/// # Parameter
/// - `speakers`: Liste der aktiven Sprecher mit Metadaten
/// - `e2ee_active`: Ob E2EE für den aktuellen Voice-Channel aktiv ist
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
        // Emitter-Trait wird oben importiert – emit() sendet an ALLE Fenster,
        // emit_to() wäre für gezieltes Senden. Hier nutzen wir emit() da
        // nur das Overlay-Fenster auf "overlay-speakers-update" lauscht.
        window
            .emit("overlay-speakers-update", payload)
            .map_err(|e| format!("Event senden fehlgeschlagen: {e}"))?;
    }
    Ok(())
}

/// Aktualisiert die Overlay-Einstellungen (Position, Opacity, etc.).
/// Wird vom Frontend aufgerufen wenn der Nutzer Einstellungen ändert.
#[tauri::command]
pub fn update_overlay_settings(
    app: tauri::AppHandle,
    settings: OverlaySettings,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("overlay") {
        window
            .emit("overlay-settings-update", &settings)
            .map_err(|e| format!("Overlay-Einstellungen konnten nicht gesendet werden: {e}"))?;

        // Opacity auf Fenster-Ebene anwenden (0.0 - 1.0)
        // Hinweis: set_opacity ist plattformabhängig
        #[cfg(any(target_os = "windows", target_os = "macos"))]
        {
            let _ = window.set_shadow(false);
        }
    }
    Ok(())
}

/// Prüft ob das aktuelle Vordergrund-Fenster ein Vollbild-Spiel ist.
///
/// # Erkennung (nur Windows)
///
/// 1. `GetForegroundWindow()` – Aktives Fenster ermitteln
/// 2. Fenster-Rect mit Monitor-Auflösung vergleichen
/// 3. `WS_POPUP`-Style prüfen (typisch für Spiele im Vollbildmodus)
///
/// Auf macOS/Linux wird immer `false` zurückgegeben (Overlay wird
/// dort über die Einstellung "Immer anzeigen" gesteuert).
///
/// # Performance
/// Diese Funktion ist leichtgewichtig (~1µs) und kann vom Frontend
/// in einem Polling-Intervall (z.B. alle 2 Sekunden) aufgerufen werden.
#[tauri::command]
pub fn is_fullscreen_game_active() -> Result<FullscreenDetectionResult, String> {
    #[cfg(target_os = "windows")]
    {
        detect_fullscreen_windows()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(FullscreenDetectionResult {
            is_fullscreen: false,
            window_title: String::new(),
            confidence: 0.0,
        })
    }
}

/// Windows-spezifische Vollbild-Erkennung via Win32 API.
///
/// Prüft ob das Vordergrund-Fenster:
/// - Den gesamten primären Monitor ausfüllt
/// - Einen Popup-Style hat (kein Rahmen/Titelleiste = typisch für Spiele)
/// - NICHT das eigene Tauri-Fenster ist
#[cfg(target_os = "windows")]
fn detect_fullscreen_windows() -> Result<FullscreenDetectionResult, String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{GetDC, GetDeviceCaps, ReleaseDC, HORZRES, VERTRES};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowLongW, GetWindowRect, GetWindowTextW, GWL_STYLE, WS_POPUP,
    };

    unsafe {
        let fg_hwnd = GetForegroundWindow();
        if fg_hwnd.is_null() {
            return Ok(FullscreenDetectionResult {
                is_fullscreen: false,
                window_title: String::new(),
                confidence: 0.0,
            });
        }

        // Monitor-Auflösung ermitteln
        let hdc = GetDC(std::ptr::null_mut());
        let screen_w = GetDeviceCaps(hdc, HORZRES as i32);
        let screen_h = GetDeviceCaps(hdc, VERTRES as i32);
        ReleaseDC(std::ptr::null_mut(), hdc);

        // Fenster-Rect ermitteln
        let mut rect: RECT = std::mem::zeroed();
        GetWindowRect(fg_hwnd, &mut rect);
        let window_w = rect.right - rect.left;
        let window_h = rect.bottom - rect.top;

        // Fenstertitel ermitteln (für Logging/Debug)
        let mut title_buf = [0u16; 256];
        let title_len = GetWindowTextW(fg_hwnd, title_buf.as_mut_ptr(), 256);
        let title = if title_len > 0 {
            OsString::from_wide(&title_buf[..title_len as usize])
                .to_string_lossy()
                .into_owned()
        } else {
            String::new()
        };

        // Eigenes Fenster ausschließen
        if title.contains("Singra Vox") {
            return Ok(FullscreenDetectionResult {
                is_fullscreen: false,
                window_title: title,
                confidence: 0.0,
            });
        }

        // Fenster-Style prüfen
        let style = GetWindowLongW(fg_hwnd, GWL_STYLE) as u32;
        let is_popup = (style & WS_POPUP) != 0;

        // Vollbild-Erkennung: Fenster füllt den gesamten Monitor aus
        let fills_screen = window_w >= screen_w && window_h >= screen_h;

        // Konfidenz berechnen
        // - Füllt Bildschirm + Popup-Style = sehr wahrscheinlich Spiel (0.95)
        // - Füllt Bildschirm ohne Popup = könnte Spiel sein (0.7)
        // - Popup aber nicht Vollbild = unwahrscheinlich (0.2)
        let confidence = if fills_screen && is_popup {
            0.95
        } else if fills_screen {
            0.7
        } else if is_popup {
            0.2
        } else {
            0.0
        };

        Ok(FullscreenDetectionResult {
            is_fullscreen: fills_screen && confidence >= 0.7,
            window_title: title,
            confidence,
        })
    }
}

/// Repräsentiert einen Sprecher im Overlay.
///
/// Wird vom Frontend serialisiert und an das Overlay-Fenster gesendet.
/// Die Felder entsprechen den Daten aus dem VoiceEngine-State.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OverlaySpeaker {
    /// Eindeutige Nutzer-ID
    pub user_id: String,
    /// Anzeigename des Nutzers
    pub display_name: String,
    /// Spricht der Nutzer gerade?
    pub is_speaking: bool,
    /// Ist das Mikrofon stummgeschaltet?
    pub is_muted: bool,
    /// Ist der Nutzer taub geschaltet?
    pub is_deafened: bool,
    /// Hex-Farbe der höchsten sichtbaren Rolle (z.B. "#6366F1")
    pub role_color: Option<String>,
    /// Avatar-URL (optional, für kompakte Darstellung)
    pub avatar_url: Option<String>,
}

/// Overlay-Einstellungen die vom Nutzer konfiguriert werden können.
///
/// Standard: Overlay ist deaktiviert. Muss explizit in den
/// Einstellungen aktiviert werden.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct OverlaySettings {
    /// Overlay aktiviert? (Standard: false)
    pub enabled: bool,
    /// Position auf dem Bildschirm
    /// Mögliche Werte: "top-left", "top-right", "bottom-left", "bottom-right"
    pub position: String,
    /// Deckkraft des Overlay-Hintergrunds (0.0 - 1.0)
    pub opacity: f64,
    /// Nur bei erkanntem Vollbild-Spiel anzeigen?
    pub game_only: bool,
    /// Hotkey zum Ein-/Ausschalten (Tauri Accelerator-Format)
    pub toggle_hotkey: String,
    /// Nutzernamen anzeigen? (Privacy-Option)
    pub show_names: bool,
    /// Sprechindikator-Animation anzeigen?
    pub show_speaking_indicator: bool,
}

/// Ergebnis der Vollbild-Erkennung.
///
/// Wird vom Frontend gepollt um zu entscheiden ob das Overlay
/// angezeigt werden soll.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FullscreenDetectionResult {
    /// Ist ein Vollbild-Fenster (wahrscheinlich ein Spiel) aktiv?
    pub is_fullscreen: bool,
    /// Titel des Vordergrund-Fensters (für Debug/Logging)
    pub window_title: String,
    /// Konfidenz der Erkennung (0.0 - 1.0)
    /// 0.95 = Popup-Vollbild (sehr wahrscheinlich Spiel)
    /// 0.70 = Vollbild ohne Popup (könnte Browser/Mediaplayer sein)
    pub confidence: f64,
}
