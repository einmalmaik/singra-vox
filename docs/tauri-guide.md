# Singra Vox – Tauri Desktop-Client

## Überblick

Der Tauri-Desktop-Client nutzt **denselben React-Code** wie der Web-Client. Tauri wrappet die Web-App in ein natives Fenster und ergänzt:

- Globale Hotkeys (Push-to-Talk)
- System Tray
- Desktop-Benachrichtigungen
- OS Keychain für E2EE-Schlüssel
- Auto-Reconnect
- Native Audio-Device-Zugriff

## Architektur

```
frontend/
├── src/                    # ← Gemeinsamer Code (Web + Desktop)
│   ├── App.js
│   ├── components/
│   ├── contexts/
│   ├── lib/
│   │   ├── api.js          # HTTP-Client (konfigurierbare URL)
│   │   └── crypto.js       # E2EE
│   └── pages/
│
├── desktop/                # ← Tauri-spezifisch
│   ├── src-tauri/
│   │   ├── Cargo.toml
│   │   ├── tauri.conf.json
│   │   ├── src/
│   │   │   └── main.rs     # Rust: Tray, Hotkeys, Keychain
│   │   └── icons/
│   └── README.md
│
└── package.json
```

## Voraussetzungen

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Tauri CLI
cargo install tauri-cli

# System-Dependencies (Ubuntu/Debian)
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget \
    libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Node.js + yarn
# (bereits vorhanden)
```

## Setup

### 1. Tauri initialisieren

```bash
cd frontend
cargo tauri init
```

Konfiguration:
- **App Name**: Singra Vox
- **Window Title**: Singra Vox
- **Dev URL**: `http://localhost:3000`
- **Build Command**: `yarn build`
- **Build Output**: `build`

### 2. tauri.conf.json

```json
{
  "build": {
    "beforeBuildCommand": "yarn build",
    "beforeDevCommand": "yarn start",
    "devUrl": "http://localhost:3000",
    "frontendDist": "../build"
  },
  "app": {
    "title": "Singra Vox",
    "width": 1200,
    "height": 800,
    "minWidth": 900,
    "minHeight": 600,
    "decorations": true,
    "transparent": false
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "identifier": "com.singravox.app",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  }
}
```

### 3. Server-URL konfigurieren

Der Desktop-Client braucht die URL des Singra-Vox-Servers. Optionen:

**A) Über `.env` (Build-Zeit):**
```env
REACT_APP_BACKEND_URL=https://singravox.example.com
```

**B) Über Settings-Dialog (Runtime):**
Beim ersten Start fragt die App nach der Server-URL. Gespeichert in:
- Linux: `~/.config/singravox/config.json`
- macOS: `~/Library/Application Support/singravox/config.json`
- Windows: `%APPDATA%/singravox/config.json`

### 4. Native Features (Rust)

```rust
// src-tauri/src/main.rs
use tauri::{
    Manager, SystemTray, SystemTrayEvent, CustomMenuItem,
    SystemTrayMenu, GlobalShortcutManager,
};

fn main() {
    let tray_menu = SystemTrayMenu::new()
        .add_item(CustomMenuItem::new("show", "Show Singra Vox"))
        .add_item(CustomMenuItem::new("quit", "Quit"));

    tauri::Builder::default()
        .system_tray(SystemTray::new().with_menu(tray_menu))
        .on_system_tray_event(|app, event| {
            if let SystemTrayEvent::MenuItemClick { id, .. } = event {
                match id.as_str() {
                    "show" => app.get_window("main").unwrap().show().unwrap(),
                    "quit" => std::process::exit(0),
                    _ => {}
                }
            }
        })
        .setup(|app| {
            // Global Push-to-Talk Hotkey
            app.global_shortcut_manager()
                .register("CmdOrCtrl+Shift+M", || {
                    // Toggle mute via IPC to frontend
                })
                .unwrap();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error running Singra Vox");
}
```

### 5. Build

```bash
# Development
cd frontend
cargo tauri dev

# Production Build
cargo tauri build
```

Output:
- Linux: `.deb`, `.AppImage`
- macOS: `.dmg`, `.app`
- Windows: `.msi`, `.exe`

## E2EE im Desktop-Client

Im Desktop-Client werden E2EE-Schlüssel **nicht in localStorage** gespeichert (unsicher), sondern im **OS Keychain**:

```rust
// Tauri Plugin: tauri-plugin-store
// oder direkt via keyring crate

use keyring::Entry;

#[tauri::command]
fn store_key(service: &str, key: &str, value: &str) -> Result<(), String> {
    let entry = Entry::new(service, key).map_err(|e| e.to_string())?;
    entry.set_password(value).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_key(service: &str, key: &str) -> Result<String, String> {
    let entry = Entry::new(service, key).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}
```

Im Frontend:
```javascript
// Tauri-spezifisch: Schlüssel im OS Keychain statt localStorage
import { invoke } from '@tauri-apps/api/tauri';

export async function storeKeyPair(kp) {
  if (window.__TAURI__) {
    await invoke('store_key', { service: 'singravox', key: 'keypair', value: JSON.stringify(kp) });
  } else {
    localStorage.setItem('sv_keypair', JSON.stringify(kp));
  }
}
```

## Unterschiede Web vs. Desktop

| Feature | Web | Desktop (Tauri) |
|---------|-----|-----------------|
| Plattform | Browser | Native Window |
| Key Storage | localStorage | OS Keychain |
| Push-to-Talk | Tastaturkürzel in App | Globaler Hotkey (auch wenn App im Hintergrund) |
| System Tray | – | Ja (Minimize to Tray) |
| Benachrichtigungen | Browser Notification API | Native OS-Benachrichtigungen |
| Auto-Start | – | Autostart konfigurierbar |
| Audio Devices | WebRTC getUserMedia | Native Audio via Tauri Plugin |
| Updates | Immer aktuell (Web) | Tauri Updater Plugin |

## Workflow: Desktop-Client an Server anbinden

1. Betreiber deployed Singra Vox Server (siehe [deployment-linux.md](deployment-linux.md))
2. Betreiber teilt Server-URL: `https://singravox.example.com`
3. Nutzer installiert Desktop-Client
4. Beim ersten Start: Server-URL eingeben
5. Login → App nutzen
6. Updates: Desktop-Client aktualisiert sich per Tauri Updater
