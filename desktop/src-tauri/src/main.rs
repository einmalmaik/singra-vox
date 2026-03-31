#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

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
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn register_ptt_hotkey(_shortcut: String) -> Result<String, String> {
    Ok("ok".into())
}

#[tauri::command]
fn show_notification(_title: String, _body: String) -> Result<String, String> {
    Ok("ok".into())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            store_secret,
            get_secret,
            delete_secret,
            get_app_version,
            register_ptt_hotkey,
            show_notification,
        ])
        .run(tauri::generate_context!())
        .expect("error running Singra Vox desktop");
}
