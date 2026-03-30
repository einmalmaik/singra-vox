# Singra Vox – Tauri Desktop Client

Dieses Verzeichnis ist die Vorbereitung für den Tauri 2 Desktop-Client.

## Status

Der Desktop-Client ist **architektonisch vorbereitet**, aber noch nicht gebaut. Der gesamte `frontend/src/`-Code ist plattformunabhängig und kann direkt von Tauri genutzt werden.

## Nächste Schritte

```bash
# 1. Rust installieren
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. Tauri CLI installieren
cargo install tauri-cli

# 3. System-Dependencies (Ubuntu/Debian)
sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget \
    libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# 4. Tauri im Frontend-Verzeichnis initialisieren
cd frontend
cargo tauri init

# 5. Development
cargo tauri dev

# 6. Build
cargo tauri build
```

## Konfiguration

Die Server-URL wird über `REACT_APP_BACKEND_URL` konfiguriert:
- Build-Zeit: In `.env` vor dem Build setzen
- Runtime: Settings-Dialog im Client (noch zu implementieren)

## Dokumentation

Siehe `docs/tauri-guide.md` für die vollständige Anleitung.
