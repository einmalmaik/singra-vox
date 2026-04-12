#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Singra Vox - Privacy-first communication platform
// Copyright (C) 2026  Maik Haedrich
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

mod native_capture;
#[cfg(target_os = "windows")]
mod native_audio_capture;
mod native_livekit;
mod screen_share;

mod rich_presence;
mod voice_overlay;

use serde::Serialize;
#[cfg(target_os = "windows")]
use std::sync::{Arc, Mutex};
use tauri::{process::restart, Emitter, Manager, State};
use tauri_plugin_updater::UpdaterExt;

#[cfg(target_os = "windows")]
use rdev::{listen, Event, EventType, Key};

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy, Default)]
struct ModifierState {
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
}

#[cfg(target_os = "windows")]
impl ModifierState {
    fn matches_exact(&self, other: &Self) -> bool {
        self.ctrl == other.ctrl
            && self.alt == other.alt
            && self.shift == other.shift
            && self.meta == other.meta
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone)]
struct ParsedShortcut {
    normalized: String,
    main_key: String,
    modifiers: ModifierState,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Default)]
struct DesktopPttState {
    binding: Option<ParsedShortcut>,
    modifiers_down: ModifierState,
    active: bool,
    last_error: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy)]
enum ModifierKey {
    Ctrl,
    Alt,
    Shift,
    Meta,
}

#[derive(Default)]
struct DesktopState {
    #[cfg(target_os = "windows")]
    ptt: Arc<Mutex<DesktopPttState>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopRuntimeInfo {
    platform: String,
    ptt_mode: String,
    is_elevated: bool,
    screen_share_capabilities: screen_share::session::ScreenShareCapabilities,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PttStatus {
    registered: bool,
    active: bool,
    shortcut: String,
    last_error: Option<String>,
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopPttPayload {
    state: String,
    shortcut: String,
    source: String,
}

#[tauri::command]
fn store_secret(service: &str, key: &str, value: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(service, key).map_err(|e| e.to_string())?;
    entry.set_password(value).map_err(|e| e.to_string())?;
    Ok("ok".into())
}

#[tauri::command]
fn get_secret(service: &str, key: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(service, key).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_secret(service: &str, key: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(service, key).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())?;
    Ok("ok".into())
}

#[tauri::command]
fn get_desktop_runtime_info() -> DesktopRuntimeInfo {
    DesktopRuntimeInfo {
        platform: std::env::consts::OS.to_string(),
        ptt_mode: if cfg!(target_os = "windows") {
            "low-level-hook".into()
        } else {
            "global-shortcut".into()
        },
        // Elevated-process detection is intentionally conservative here. The
        // frontend still shows the broader warning because an elevated game can
        // block lower-privileged apps from observing its keys.
        is_elevated: false,
        screen_share_capabilities: screen_share::session::ScreenShareCapabilities::current(),
    }
}

#[tauri::command]
fn debug_voice_log(level: String, message: String, payload: String) -> bool {
    #[cfg(debug_assertions)]
    {
        eprintln!("[voice_frontend][{level}] {message} {payload}");
    }

    #[cfg(not(debug_assertions))]
    {
        let _ = (&level, &message, &payload);
    }

    true
}

#[cfg(target_os = "windows")]
fn canonicalize_shortcut(shortcut: &str) -> String {
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let mut meta = false;
    let mut main_key = String::new();

    for part in shortcut
        .split('+')
        .map(str::trim)
        .filter(|part| !part.is_empty())
    {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "commandorcontrol" | "cmdorctrl" => ctrl = true,
            "alt" | "option" => alt = true,
            "shift" => shift = true,
            "meta" | "super" | "win" | "command" | "cmd" => meta = true,
            token => {
                if main_key.is_empty() {
                    main_key = normalize_main_key_token(token);
                }
            }
        }
    }

    if main_key.is_empty() {
        return String::new();
    }

    let mut parts: Vec<String> = Vec::new();
    if ctrl {
        parts.push("Ctrl".into());
    }
    if alt {
        parts.push("Alt".into());
    }
    if shift {
        parts.push("Shift".into());
    }
    if meta {
        parts.push("Meta".into());
    }
    parts.push(main_key);
    parts.join("+")
}

#[cfg(target_os = "windows")]
fn normalize_main_key_token(token: &str) -> String {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if let Some(letter) = trimmed.strip_prefix("key") {
        if letter.len() == 1 {
            return letter.to_ascii_lowercase();
        }
    }
    if let Some(digit) = trimmed.strip_prefix("digit") {
        if digit.len() == 1 {
            return digit.to_string();
        }
    }

    let upper = trimmed.to_ascii_uppercase();
    match upper.as_str() {
        "SPACE" | "SPACEBAR" => "Space".into(),
        "ESC" | "ESCAPE" => "Esc".into(),
        "TAB" => "Tab".into(),
        "ENTER" | "RETURN" => "Enter".into(),
        "BACKSPACE" => "Backspace".into(),
        "INSERT" => "Insert".into(),
        "DELETE" => "Delete".into(),
        "HOME" => "Home".into(),
        "END" => "End".into(),
        "PAGEUP" => "PageUp".into(),
        "PAGEDOWN" => "PageDown".into(),
        "UP" | "ARROWUP" => "Up".into(),
        "DOWN" | "ARROWDOWN" => "Down".into(),
        "LEFT" | "ARROWLEFT" => "Left".into(),
        "RIGHT" | "ARROWRIGHT" => "Right".into(),
        "VOLUMEMUTE" | "AUDIOVOLUMEMUTE" => "VolumeMute".into(),
        "VOLUMEUP" | "AUDIOVOLUMEUP" => "VolumeUp".into(),
        "VOLUMEDOWN" | "AUDIOVOLUMEDOWN" => "VolumeDown".into(),
        _ => {
            if upper.starts_with('F') && upper[1..].chars().all(|ch| ch.is_ascii_digit()) {
                return upper;
            }
            if trimmed.len() == 1 {
                let character = trimmed.chars().next().unwrap();
                if character.is_ascii_alphabetic() {
                    return character.to_ascii_lowercase().to_string();
                }
                return character.to_string();
            }
            trimmed.to_string()
        }
    }
}

#[cfg(target_os = "windows")]
fn parse_shortcut(shortcut: &str) -> Result<ParsedShortcut, String> {
    let normalized = canonicalize_shortcut(shortcut);
    if normalized.is_empty() {
        return Err("Choose a valid push-to-talk key first.".into());
    }

    let mut modifiers = ModifierState::default();
    let mut main_key = String::new();
    for part in normalized.split('+') {
        match part {
            "Ctrl" => modifiers.ctrl = true,
            "Alt" => modifiers.alt = true,
            "Shift" => modifiers.shift = true,
            "Meta" => modifiers.meta = true,
            token => {
                if main_key.is_empty() {
                    main_key = token.to_string();
                }
            }
        }
    }

    if main_key.is_empty() {
        return Err("Choose a valid push-to-talk key first.".into());
    }

    Ok(ParsedShortcut {
        normalized,
        main_key,
        modifiers,
    })
}

#[cfg(target_os = "windows")]
fn key_debug_name(key: &Key) -> String {
    format!("{key:?}")
}

#[cfg(target_os = "windows")]
fn modifier_for_key(key: &Key) -> Option<ModifierKey> {
    let name = key_debug_name(key);
    match name.as_str() {
        "ControlLeft" | "ControlRight" => Some(ModifierKey::Ctrl),
        "ShiftLeft" | "ShiftRight" => Some(ModifierKey::Shift),
        "Alt" | "AltGr" | "AltLeft" | "AltRight" => Some(ModifierKey::Alt),
        "MetaLeft" | "MetaRight" | "Super" | "SuperLeft" | "SuperRight" => Some(ModifierKey::Meta),
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn set_modifier_state(modifiers: &mut ModifierState, modifier: ModifierKey, down: bool) {
    match modifier {
        ModifierKey::Ctrl => modifiers.ctrl = down,
        ModifierKey::Alt => modifiers.alt = down,
        ModifierKey::Shift => modifiers.shift = down,
        ModifierKey::Meta => modifiers.meta = down,
    }
}

#[cfg(target_os = "windows")]
fn normalized_key_from_name(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed == " " {
        return Some("Space".into());
    }
    if trimmed.chars().count() == 1 {
        let character = trimmed.chars().next()?;
        if character.is_ascii_alphabetic() {
            return Some(character.to_ascii_lowercase().to_string());
        }
        if character.is_ascii_digit() {
            return Some(character.to_string());
        }
        if "`-=[]\\;',./".contains(character) {
            return Some(character.to_string());
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn normalized_key_from_debug_name(debug_name: &str) -> Option<String> {
    if let Some(letter) = debug_name.strip_prefix("Key") {
        if letter.len() == 1 {
            return Some(letter.to_ascii_lowercase());
        }
    }
    if let Some(digit) = debug_name.strip_prefix("Num") {
        if digit.len() == 1 {
            return Some(digit.to_string());
        }
    }
    match debug_name {
        "Space" => Some("Space".into()),
        "Escape" => Some("Esc".into()),
        "Tab" => Some("Tab".into()),
        "Return" | "Enter" => Some("Enter".into()),
        "Backspace" => Some("Backspace".into()),
        "Insert" => Some("Insert".into()),
        "Delete" => Some("Delete".into()),
        "Home" => Some("Home".into()),
        "End" => Some("End".into()),
        "PageUp" => Some("PageUp".into()),
        "PageDown" => Some("PageDown".into()),
        "UpArrow" | "ArrowUp" | "Up" => Some("Up".into()),
        "DownArrow" | "ArrowDown" | "Down" => Some("Down".into()),
        "LeftArrow" | "ArrowLeft" | "Left" => Some("Left".into()),
        "RightArrow" | "ArrowRight" | "Right" => Some("Right".into()),
        "VolumeMute" => Some("VolumeMute".into()),
        "VolumeUp" => Some("VolumeUp".into()),
        "VolumeDown" => Some("VolumeDown".into()),
        "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12" => {
            Some(debug_name.to_string())
        }
        _ => None,
    }
}

#[cfg(target_os = "windows")]
fn normalized_event_key(event: &Event, key: &Key) -> Option<String> {
    event
        .name
        .as_deref()
        .and_then(normalized_key_from_name)
        .or_else(|| normalized_key_from_debug_name(&key_debug_name(key)))
}

#[cfg(target_os = "windows")]
fn emit_ptt_payload(
    app: &tauri::AppHandle,
    state: &str,
    shortcut: &str,
) {
    let _ = app.emit(
        "desktop-ptt",
        DesktopPttPayload {
            state: state.to_string(),
            shortcut: shortcut.to_string(),
            source: "low-level-hook".into(),
        },
    );
}

#[cfg(target_os = "windows")]
fn handle_ptt_event(
    app: &tauri::AppHandle,
    ptt_state: &Arc<Mutex<DesktopPttState>>,
    event: Event,
) {
    let mut state = match ptt_state.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    match event.event_type {
        EventType::KeyPress(key) => {
            if let Some(modifier) = modifier_for_key(&key) {
                set_modifier_state(&mut state.modifiers_down, modifier, true);
                return;
            }

            let Some(binding) = state.binding.clone() else {
                return;
            };

            let Some(main_key) = normalized_event_key(&event, &key) else {
                return;
            };

            if main_key == binding.main_key
                && state.modifiers_down.matches_exact(&binding.modifiers)
                && !state.active
            {
                state.active = true;
                emit_ptt_payload(app, "Pressed", &binding.normalized);
            }
        }
        EventType::KeyRelease(key) => {
            if let Some(modifier) = modifier_for_key(&key) {
                if let Some(binding) = state.binding.clone() {
                    let required_modifier = match modifier {
                        ModifierKey::Ctrl => binding.modifiers.ctrl,
                        ModifierKey::Alt => binding.modifiers.alt,
                        ModifierKey::Shift => binding.modifiers.shift,
                        ModifierKey::Meta => binding.modifiers.meta,
                    };
                    if state.active && required_modifier {
                        state.active = false;
                        emit_ptt_payload(app, "Released", &binding.normalized);
                    }
                }
                set_modifier_state(&mut state.modifiers_down, modifier, false);
                return;
            }

            let Some(binding) = state.binding.clone() else {
                return;
            };

            let Some(main_key) = normalized_event_key(&event, &key) else {
                return;
            };

            if state.active && main_key == binding.main_key {
                state.active = false;
                emit_ptt_payload(app, "Released", &binding.normalized);
            }
        }
        _ => {}
    }
}

#[cfg(target_os = "windows")]
fn spawn_ptt_listener(app: tauri::AppHandle, ptt_state: Arc<Mutex<DesktopPttState>>) {
    std::thread::spawn(move || {
        let app_handle = app.clone();
        let callback_state = ptt_state.clone();
        if let Err(error) = listen(move |event| handle_ptt_event(&app_handle, &callback_state, event)) {
            let message = format!("{error:?}");
            if let Ok(mut state) = ptt_state.lock() {
                state.last_error = Some(message.clone());
            }
            let _ = app.emit("desktop-ptt-error", message);
        }
    });
}

#[tauri::command]
fn configure_ptt_listener(
    shortcut: Option<String>,
    enabled: bool,
    state: State<'_, DesktopState>,
) -> Result<PttStatus, String> {
    #[cfg(target_os = "windows")]
    {
        let mut ptt = state
            .ptt
            .lock()
            .map_err(|_| "Push-to-Talk state is unavailable".to_string())?;

        if !enabled {
            ptt.binding = None;
            ptt.active = false;
            return Ok(PttStatus {
                registered: false,
                active: false,
                shortcut: String::new(),
                last_error: ptt.last_error.clone(),
            });
        }

        let parsed = parse_shortcut(shortcut.as_deref().unwrap_or_default())?;
        let normalized = parsed.normalized.clone();
        ptt.binding = Some(parsed);
        ptt.active = false;
        ptt.last_error = None;
        return Ok(PttStatus {
            registered: true,
            active: false,
            shortcut: normalized,
            last_error: None,
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = shortcut;
        let _ = enabled;
        let _ = state;
        Ok(PttStatus {
            registered: false,
            active: false,
            shortcut: String::new(),
            last_error: None,
        })
    }
}

#[tauri::command]
fn clear_ptt_listener(state: State<'_, DesktopState>) -> Result<PttStatus, String> {
    #[cfg(target_os = "windows")]
    {
        let mut ptt = state
            .ptt
            .lock()
            .map_err(|_| "Push-to-Talk state is unavailable".to_string())?;
        ptt.binding = None;
        ptt.active = false;
        return Ok(PttStatus {
            registered: false,
            active: false,
            shortcut: String::new(),
            last_error: ptt.last_error.clone(),
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = state;
        Ok(PttStatus {
            registered: false,
            active: false,
            shortcut: String::new(),
            last_error: None,
        })
    }
}

// ── Externe URLs öffnen ────────────────────────────────────────────────────────

/// Öffnet eine URL im Standard-Browser des Systems.
/// Wird vom Frontend über `invoke("open_url", { url })` aufgerufen.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // Nur http/https URLs erlauben (Sicherheit)
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Nur http/https URLs erlaubt".into());
    }

    #[cfg(target_os = "windows")]
    {
        // rundll32 url.dll,FileProtocolHandler ist der zuverlässigste Weg unter
        // Windows, URLs im Standard-Browser zu öffnen – `cmd /C start` kann in
        // WebView2-Sandboxen und bei Sonderzeichen in der URL fehlschlagen.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Konnte Browser nicht öffnen: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Konnte Browser nicht öffnen: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Konnte Browser nicht öffnen: {e}"))?;
    }
    Ok(())
}

// ── Update-Check ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    available: bool,
    version: Option<String>,
    current_version: String,
    body: Option<String>,
}

/// Wird beim App-Start im Hintergrund aufgerufen.
/// Prüft auf Updates und installiert sie automatisch (kein User-Input nötig).
///
/// Phasen (jeweils als Event an das Frontend):
///   update-checking        → UI zeigt "Prüfe auf Updates…"
///   update-available        → UI zeigt Version + "Wird heruntergeladen…"
///   update-download-progress → UI zeigt Fortschrittsbalken
///   update-install-started  → UI zeigt "Wird installiert…"
///   (restart)               → App startet automatisch neu
///   update-not-available    → UI zeigt kurz "Aktuell" und blendet aus
///   update-error            → UI zeigt kurz Fehler und blendet aus
async fn auto_update_on_startup(app: tauri::AppHandle) {
    let current_version = app.package_info().version.to_string();
    let _ = app.emit(
        "update-checking",
        serde_json::json!({ "currentVersion": current_version }),
    );

    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            let _ = app.emit(
                "update-error",
                serde_json::json!({ "error": format!("Updater nicht verfügbar: {e}") }),
            );
            return;
        }
    };

    // 15s Timeout für den Check – verhindert Blockade bei Netzwerkproblemen
    let check_result = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        updater.check(),
    )
    .await;

    let update = match check_result {
        Ok(Ok(Some(update))) => update,
        Ok(Ok(None)) => {
            let _ = app.emit("update-not-available", ());
            return;
        }
        Ok(Err(e)) => {
            let _ = app.emit(
                "update-error",
                serde_json::json!({ "error": e.to_string() }),
            );
            return;
        }
        Err(_) => {
            let _ = app.emit(
                "update-error",
                serde_json::json!({ "error": "Update-Check Timeout (15s)" }),
            );
            return;
        }
    };

    // Update gefunden → Frontend informieren, dann automatisch herunterladen
    let _ = app.emit(
        "update-available",
        UpdateInfo {
            available: true,
            version: Some(update.version.clone()),
            current_version: update.current_version.clone(),
            body: update.body.clone(),
        },
    );

    // Kurz warten damit die UI den "Update gefunden"-State anzeigen kann
    tokio::time::sleep(std::time::Duration::from_millis(800)).await;

    // Automatisch herunterladen und installieren
    let app_dl = app.clone();
    let app_inst = app.clone();
    let install_result = update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = app_dl.emit(
                    "update-download-progress",
                    serde_json::json!({
                        "chunkLength": chunk_length,
                        "contentLength": content_length
                    }),
                );
            },
            move || {
                let _ = app_inst.emit("update-install-started", ());
            },
        )
        .await;

    match install_result {
        Ok(()) => {
            // Kurz warten damit "Installiere…" sichtbar ist, dann Neustart
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            restart(&app.env());
        }
        Err(e) => {
            let _ = app.emit(
                "update-error",
                serde_json::json!({ "error": format!("Installation fehlgeschlagen: {e}") }),
            );
        }
    }
}

/// Tauri-Befehl: Update manuell prüfen (aus dem Frontend aufrufbar)
#[tauri::command]
async fn check_update_command(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => Ok(UpdateInfo {
            available: true,
            version: Some(update.version.clone()),
            current_version,
            body: update.body.clone(),
        }),
        None => Ok(UpdateInfo {
            available: false,
            version: None,
            current_version,
            body: None,
        }),
    }
}

/// Tauri-Befehl: Update herunterladen + installieren.
/// Die App startet sich nach der Installation automatisch neu.
#[tauri::command]
async fn install_update_command(app: tauri::AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        let _ = app.emit("update-download-started", ());

        update
            .download_and_install(
                |chunk_length, content_length| {
                    let _ = app.emit(
                        "update-download-progress",
                        serde_json::json!({
                            "chunkLength": chunk_length,
                            "contentLength": content_length
                        }),
                    );
                },
                || {
                    let _ = app.emit("update-install-started", ());
                },
            )
            .await
            .map_err(|e| e.to_string())?;

        // Nach dem Install neu starten
        restart(&app.env());
    }

    Ok(())
}

fn main() {
    let desktop_state = DesktopState::default();
    #[cfg(target_os = "windows")]
    let ptt_state = desktop_state.ptt.clone();

    let builder = tauri::Builder::default()
        .manage(desktop_state);

    let builder = builder.manage(native_capture::DesktopCaptureStore::default());
    let builder = builder.manage(native_livekit::NativeScreenShareStore::default());

    builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            #[cfg(target_os = "windows")]
            spawn_ptt_listener(app.handle().clone(), ptt_state.clone());

            // Auto-Update-Check beim Start. 2s Delay damit React-Listener
            // registriert sind bevor das erste Event emittiert wird.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                auto_update_on_startup(app_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            store_secret,
            get_secret,
            delete_secret,
            get_desktop_runtime_info,
            debug_voice_log,
            configure_ptt_listener,
            clear_ptt_listener,
            open_url,
            check_update_command,
            install_update_command,
            rich_presence::detect_current_activity,
            rich_presence::get_custom_apps,
            rich_presence::save_custom_apps,
            voice_overlay::create_overlay,
            voice_overlay::toggle_overlay,
            voice_overlay::update_overlay_speakers,
            voice_overlay::update_overlay_settings,
            voice_overlay::is_fullscreen_game_active,
            screen_share::commands::list_capture_sources,
            screen_share::commands::start_native_screen_share,
            screen_share::commands::stop_native_screen_share,
            screen_share::commands::update_native_screen_share_key,
            screen_share::commands::update_native_screen_share_audio_volume,
            screen_share::commands::get_native_screen_share_session,
        ])
        .run(tauri::generate_context!())
        .expect("error running Singra Vox desktop");
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{canonicalize_shortcut, parse_shortcut};

    #[test]
    fn canonicalizes_letter_shortcuts() {
        assert_eq!(canonicalize_shortcut("control+KeyJ"), "Ctrl+j");
        assert_eq!(canonicalize_shortcut("shift+alt+Z"), "Alt+Shift+z");
    }

    #[test]
    fn parses_special_keys() {
        let parsed = parse_shortcut("Ctrl+Space").expect("shortcut should parse");
        assert_eq!(parsed.normalized, "Ctrl+Space");
        assert_eq!(parsed.main_key, "Space");
        assert!(parsed.modifiers.ctrl);
        assert!(!parsed.modifiers.alt);
    }
}
