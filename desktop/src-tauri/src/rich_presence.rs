/*
 * Singra Vox - Privacy-first communication platform
 * Copyright (C) 2026  Maik Haedrich
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

//! Rich Presence – Prozess-Erkennung für Desktop-Aktivitäten
//!
//! Erkennt aktive Spiele und Anwendungen auf dem System und sendet sie
//! als IPC-Events an das Frontend. Das Frontend entscheidet dann basierend
//! auf den Privacy-Einstellungen ob und wohin die Aktivität gesendet wird.
//!
//! # Architektur
//!
//! ```
//! [OS Prozessliste] → [detect_activity()] → [IPC Event] → [Frontend]
//!                                                              ↓
//!                                           [Privacy-Filter] → [Backend API]
//! ```
//!
//! # Steam-Erkennung
//!
//! Steam-Spiele werden automatisch erkannt indem die Kommandozeilen-Argumente
//! der laufenden Prozesse nach `steam://rungameid/` oder `SteamApps/common/`
//! durchsucht werden. Der Spielname wird aus dem Verzeichnispfad extrahiert.
//!
//! # Custom-Programme
//!
//! User können eigene .exe-Pfade in der `custom_apps.json` registrieren.
//! Das Format ist:
//! ```json
//! [
//!   { "exe_name": "code.exe", "display_name": "VS Code", "type": "coding" },
//!   { "exe_name": "spotify.exe", "display_name": "Spotify", "type": "listening" }
//! ]
//! ```

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

/// Repräsentiert eine erkannte Aktivität.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedActivity {
    /// Art der Aktivität: "playing", "coding", "listening", "streaming", "custom"
    pub activity_type: String,
    /// Anzeigename (z.B. "Counter-Strike 2", "VS Code")
    pub name: String,
    /// Optionales Detail (z.B. "Competitive – Dust 2")
    pub details: Option<String>,
    /// Prozessname (z.B. "cs2.exe")
    pub process_name: String,
}

/// Custom-App-Definition aus der Konfigurationsdatei.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomAppDef {
    pub exe_name: String,
    pub display_name: String,
    #[serde(rename = "type")]
    pub activity_type: String,
}

/// Bekannte Anwendungen mit ihrer Kategorie.
/// Wird als Fallback genutzt wenn keine custom_apps.json vorhanden ist.
const KNOWN_APPS: &[(&str, &str, &str)] = &[
    // IDEs & Editoren → "coding"
    ("code", "Visual Studio Code", "coding"),
    ("code-insiders", "VS Code Insiders", "coding"),
    ("devenv", "Visual Studio", "coding"),
    ("idea64", "IntelliJ IDEA", "coding"),
    ("webstorm64", "WebStorm", "coding"),
    ("pycharm64", "PyCharm", "coding"),
    ("rider64", "Rider", "coding"),
    ("sublime_text", "Sublime Text", "coding"),
    ("atom", "Atom", "coding"),
    ("cursor", "Cursor", "coding"),
    ("zed", "Zed", "coding"),
    // Musik → "listening"
    ("spotify", "Spotify", "listening"),
    ("tidal", "TIDAL", "listening"),
    ("deezer", "Deezer", "listening"),
    ("itunes", "Apple Music", "listening"),
    // Streaming → "streaming"
    ("obs64", "OBS Studio", "streaming"),
    ("obs", "OBS Studio", "streaming"),
    ("streamlabs", "Streamlabs", "streaming"),
];

/// Lädt custom_apps.json aus dem App-Datenverzeichnis.
/// Gibt eine leere Liste zurück wenn die Datei nicht existiert.
fn load_custom_apps(app_data_dir: &PathBuf) -> Vec<CustomAppDef> {
    let path = app_data_dir.join("custom_apps.json");
    match std::fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

/// Erkennt die aktuelle Aktivität basierend auf laufenden Prozessen.
///
/// # Erkennung (Priorität)
///
/// 1. Steam-Spiele: Sucht nach Prozessen in `SteamApps/common/`
/// 2. Custom-Apps: Gleicht Prozessnamen gegen `custom_apps.json` ab
/// 3. Bekannte Apps: Gleicht gegen die eingebaute `KNOWN_APPS` Liste ab
///
/// # Plattform-Unterstützung
///
/// - Windows: Nutzt `tasklist` oder WMI (via std::process::Command)
/// - macOS: Nutzt `ps` (POSIX)
/// - Linux: Liest `/proc/*/comm` direkt
#[cfg(target_os = "windows")]
pub fn detect_activity(app_data_dir: &PathBuf) -> Option<DetectedActivity> {
    let custom_apps = load_custom_apps(app_data_dir);

    // Prozessliste über tasklist holen (einfach, kein WMI nötig)
    let output = std::process::Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines() {
        // Format: "process.exe","PID","Session Name","Session#","Mem Usage"
        let name = line.split(',').next()?.trim_matches('"').to_lowercase();
        let name_no_ext = name.strip_suffix(".exe").unwrap_or(&name);

        // 1. Steam-Spiel? Prüfe ob der Prozessname in SteamApps vorkommt
        // (Vereinfachte Erkennung über den Prozessnamen)
        if is_likely_steam_game(&name) {
            return Some(DetectedActivity {
                activity_type: "playing".to_string(),
                name: format_game_name(name_no_ext),
                details: None,
                process_name: name.to_string(),
            });
        }

        // 2. Custom-App?
        if let Some(app) = custom_apps.iter().find(|a| a.exe_name.to_lowercase() == name) {
            return Some(DetectedActivity {
                activity_type: app.activity_type.clone(),
                name: app.display_name.clone(),
                details: None,
                process_name: name.to_string(),
            });
        }

        // 3. Bekannte App?
        if let Some((_, display, atype)) = KNOWN_APPS.iter().find(|(exe, _, _)| *exe == name_no_ext) {
            return Some(DetectedActivity {
                activity_type: atype.to_string(),
                name: display.to_string(),
                details: None,
                process_name: name.to_string(),
            });
        }
    }

    None
}

/// macOS/Linux Fallback
#[cfg(not(target_os = "windows"))]
pub fn detect_activity(app_data_dir: &PathBuf) -> Option<DetectedActivity> {
    let custom_apps = load_custom_apps(app_data_dir);

    let output = std::process::Command::new("ps")
        .args(["-eo", "comm"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines().skip(1) {
        let name = line.trim().to_lowercase();
        // Nur den Dateinamen (nicht den vollen Pfad)
        let basename = name.rsplit('/').next().unwrap_or(&name);

        // Custom-App?
        if let Some(app) = custom_apps.iter().find(|a| a.exe_name.to_lowercase() == basename) {
            return Some(DetectedActivity {
                activity_type: app.activity_type.clone(),
                name: app.display_name.clone(),
                details: None,
                process_name: basename.to_string(),
            });
        }

        // Bekannte App?
        if let Some((_, display, atype)) = KNOWN_APPS.iter().find(|(exe, _, _)| *exe == basename) {
            return Some(DetectedActivity {
                activity_type: atype.to_string(),
                name: display.to_string(),
                details: None,
                process_name: basename.to_string(),
            });
        }
    }

    None
}

#[cfg(any(test, target_os = "windows"))]
/// Prüft ob ein Prozessname wahrscheinlich ein Steam-Spiel ist.
/// Heuristik: Nicht in der KNOWN_APPS-Liste, nicht system-typisch,
/// und der Name enthält typische Spiel-Patterns.
fn is_likely_steam_game(process_name: &str) -> bool {
    // Häufige System-/Service-Prozesse ausschließen
    const SYSTEM_PROCS: &[&str] = &[
        "svchost", "csrss", "lsass", "services", "wininit", "winlogon",
        "explorer", "dwm", "taskhost", "conhost", "cmd", "powershell",
        "tasklist", "system", "idle", "smss", "fontdrvhost",
        "steamwebhelper", "steam", "steamservice",
    ];
    let lower = process_name.to_lowercase();
    let basename = lower.strip_suffix(".exe").unwrap_or(&lower);
    if SYSTEM_PROCS.contains(&basename) {
        return false;
    }
    if KNOWN_APPS.iter().any(|(exe, _, _)| *exe == basename) {
        return false;
    }
    // TODO: Erweiterte Erkennung via Steam-Library-Pfad oder Steam API
    false
}

#[cfg(any(test, target_os = "windows"))]
/// Formatiert einen Prozessnamen zu einem lesbaren Spielnamen.
/// "counter-strike_2" → "Counter Strike 2"
fn format_game_name(process_name: &str) -> String {
    process_name
        .replace(['-', '_'], " ")
        .split_whitespace()
        .map(|word| {
            let mut chars = word.chars();
            match chars.next() {
                None => String::new(),
                Some(first) => {
                    let upper: String = first.to_uppercase().collect();
                    upper + chars.as_str()
                }
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Tauri IPC Command: Erkennt die aktuelle Aktivität.
/// Wird vom Frontend alle 15 Sekunden aufgerufen (Polling).
#[tauri::command]
pub fn detect_current_activity(app_handle: tauri::AppHandle) -> Option<DetectedActivity> {
    let app_data_dir = app_handle.path().app_data_dir().ok()?;
    detect_activity(&app_data_dir)
}

/// Tauri IPC Command: Lädt die Custom-Apps-Liste.
#[tauri::command]
pub fn get_custom_apps(app_handle: tauri::AppHandle) -> Vec<CustomAppDef> {
    let app_data_dir = match app_handle.path().app_data_dir() {
        Ok(dir) => dir,
        Err(_) => return Vec::new(),
    };
    load_custom_apps(&app_data_dir)
}

/// Tauri IPC Command: Speichert eine aktualisierte Custom-Apps-Liste.
#[tauri::command]
pub fn save_custom_apps(app_handle: tauri::AppHandle, apps: Vec<CustomAppDef>) -> Result<(), String> {
    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("App data dir nicht gefunden: {e}"))?;
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Verzeichnis erstellen fehlgeschlagen: {e}"))?;
    let json = serde_json::to_string_pretty(&apps)
        .map_err(|e| format!("Serialisierung fehlgeschlagen: {e}"))?;
    std::fs::write(app_data_dir.join("custom_apps.json"), json)
        .map_err(|e| format!("Datei schreiben fehlgeschlagen: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_game_name() {
        assert_eq!(format_game_name("counter-strike_2"), "Counter Strike 2");
        assert_eq!(format_game_name("valheim"), "Valheim");
        assert_eq!(format_game_name("the-witcher-3"), "The Witcher 3");
    }

    #[test]
    fn test_is_not_steam_game() {
        assert!(!is_likely_steam_game("svchost.exe"));
        assert!(!is_likely_steam_game("code.exe"));
        assert!(!is_likely_steam_game("steam.exe"));
    }
}
