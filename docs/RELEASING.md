# Desktop App — Veröffentlichungs-Anleitung

Diese Anleitung erklärt wie du einen neuen Release erstellst, der automatisch
auf allen Desktop-Clients als Update erscheint.

---

## Einmalige Einrichtung (nur beim ersten Mal)

### 1. Tauri Signing-Key generieren

```bash
# Benötigt: cargo install tauri-cli --version "^2"
cargo tauri signer generate -w ~/.tauri/singravox.key
```

Das erzeugt:
- `~/.tauri/singravox.key` — **Private Key** (geheim halten!)
- `~/.tauri/singravox.key.pub` — Public Key

### 2. Public Key in tauri.conf.json eintragen

```bash
cat ~/.tauri/singravox.key.pub
```

Den Inhalt in `desktop/src-tauri/tauri.conf.json` eintragen:
```json
"updater": {
  "pubkey": "HIER_DEN_PUBLIC_KEY_EINFÜGEN",
  ...
}
```

### 3. GitHub Repository URL eintragen

In `desktop/src-tauri/tauri.conf.json`:
```json
"endpoints": [
  "https://github.com/einmalmaik/singra-vox/releases/latest/download/latest.json"
]
```

### 4. GitHub Secrets setzen

Im GitHub Repository unter **Settings → Secrets → Actions**:

| Secret | Wert |
|--------|------|
| `TAURI_SIGNING_PRIVATE_KEY` | Inhalt von `~/.tauri/singravox.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Passwort das du beim Generieren gesetzt hast |

Optional für macOS Notarisierung:
| Secret | Wert |
|--------|------|
| `APPLE_ID` | deine@apple-id.com |
| `APPLE_PASSWORD` | App-spezifisches Passwort |
| `APPLE_TEAM_ID` | Deine Apple Team ID |
| `APPLE_CERTIFICATE` | Base64-kodiertes .p12 Zertifikat |
| `APPLE_CERTIFICATE_PASSWORD` | Zertifikat-Passwort |

---

## Neuen Release erstellen

```bash
# Versionsnummer erhöhen (Semantic Versioning: Major.Minor.Patch)
# Datei: desktop/src-tauri/tauri.conf.json → "version": "0.2.1"
# Datei: desktop/src-tauri/Cargo.toml     → version = "0.2.1"

# Tag erstellen und pushen
git add desktop/src-tauri/tauri.conf.json desktop/src-tauri/Cargo.toml
git commit -m "chore: bump version to 0.2.1"
git tag v0.2.1
git push origin main --tags
```

Das löst automatisch den Release-Workflow aus:
1. Builds für Windows (.exe, .msi), macOS (.dmg), Linux (.AppImage, .deb)
2. Signiert alle Builds mit dem Tauri-Key
3. Erstellt GitHub Release mit allen Dateien
4. Alle Desktop-Apps prüfen beim nächsten Start auf das Update

---

## Was passiert beim Update auf dem Nutzer-PC?

1. App startet → Rust-Code prüft GitHub releases API im Hintergrund
2. Neue Version gefunden → `"update-available"` Event ans Frontend
3. UpdateNotification-Banner erscheint unten rechts
4. User klickt "Jetzt aktualisieren"
5. App lädt `.sig` + neues Installer-Paket
6. Signatur wird mit dem eingebetteten Public Key verifiziert
7. Installer wird ausgeführt → App startet neu
8. JWT-Token im OS-Keychain bleibt erhalten → **User ist weiterhin eingeloggt**

---

## Plattformen

| Plattform | Installer | Update-Format |
|-----------|-----------|---------------|
| Windows   | NSIS .exe + .msi | .nsis.zip + Signatur |
| macOS     | .dmg      | .app.tar.gz + Signatur |
| Linux     | .AppImage + .deb | .AppImage.tar.gz + Signatur |

---

## Server vs. Desktop

| | Server (`install.sh`) | Desktop (Tauri) |
|--|--|--|
| Wer installiert | VPS/Server-Admin | Endbenutzer |
| Update-Befehl | `bash install.sh --update` | Automatisch beim App-Start |
| Was wird aktualisiert | Backend + Web-Frontend + Services | Desktop-Client (Frontend embedded) |
| Sessions nach Update | Alle aktiv (Docker Rolling Restart) | Aktiv (Keychain-Token bleibt) |
