// Singra Vox Desktop Client – Tauri Entry Point
//
// This file sets up native desktop features:
//   - System Tray (minimize to tray)
//   - Global Push-to-Talk hotkey
//   - Desktop notifications
//   - Secure key storage via OS keychain

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

// ── IPC Commands ────────────────────────────────────────

/// Store a value in the OS keychain (for E2EE private keys)
#[tauri::command]
fn store_secret(service: &str, key: &str, value: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(service, key).map_err(|e| e.to_string())?;
    entry.set_password(value).map_err(|e| e.to_string())?;
    Ok("ok".into())
}

/// Retrieve a value from the OS keychain
#[tauri::command]
fn get_secret(service: &str, key: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(service, key).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

/// Delete a value from the OS keychain
#[tauri::command]
fn delete_secret(service: &str, key: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(service, key).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())?;
    Ok("ok".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            store_secret,
            get_secret,
            delete_secret,
        ])
        .setup(|app| {
            // ── System Tray ──
            let show = MenuItem::with_id(app, "show", "Show Singra Vox", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Singra Vox")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => std::process::exit(0),
                    _ => {}
                })
                .build(app)?;

            // ── Global Push-to-Talk Shortcut ──
            // Registered at runtime via frontend IPC when user configures PTT key

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running Singra Vox desktop");
}
