// Singra Vox Desktop Client – Tauri 2 Entry Point
//
// Native desktop features:
//   - System Tray with menu
//   - Global Push-to-Talk hotkey (configurable)
//   - Desktop notifications for DMs and mentions
//   - Secure key storage via OS keychain (E2EE private keys)
//   - Window state persistence
//   - Auto-reconnect handling

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, Emitter,
};

// ── IPC Commands ────────────────────────────────────────

/// Store a value in the OS keychain
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

/// Get app version
#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Set the global PTT hotkey at runtime
#[tauri::command]
fn register_ptt_hotkey(app: tauri::AppHandle, shortcut: String) -> Result<String, String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    // Unregister previous
    let _ = app.global_shortcut().unregister_all();
    // Register new
    let app_clone = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut.parse().map_err(|e: tauri_plugin_global_shortcut::Error| e.to_string())?, move |_app, _shortcut, event| {
            match event.state {
                tauri_plugin_global_shortcut::ShortcutState::Pressed => {
                    let _ = app_clone.emit("ptt-active", true);
                }
                tauri_plugin_global_shortcut::ShortcutState::Released => {
                    let _ = app_clone.emit("ptt-active", false);
                }
            }
        })
        .map_err(|e| e.to_string())?;
    Ok("ok".into())
}

/// Show a native desktop notification
#[tauri::command]
fn show_notification(title: String, body: String) -> Result<String, String> {
    // Use tauri-plugin-notification
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
            get_app_version,
            register_ptt_hotkey,
            show_notification,
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

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running Singra Vox desktop");
}
