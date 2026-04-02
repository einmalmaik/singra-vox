# Singra Vox Architektur

## Überblick

Singra Vox ist eine Discord-ähnliche Kommunikationsplattform mit einem gemeinsamen Web-/Desktop-Frontend, einem FastAPI-Backend, MongoDB für Persistenz, LiveKit als produktivem Voice-/Media-SFU-Pfad und einer Tauri-Desktop-Hülle für native Desktop-Funktionen.

Die produktiven Kernpfade sind:
- Web und Desktop teilen sich denselben React-Client unter `frontend/src`
- das Backend unter `backend/app/main.py` und den Phase-Routen erzwingt Auth, Permissions, Realtime und E2EE-Delivery
- Voice, Video und Screen Share laufen produktiv über LiveKit
- Desktop-spezifische Funktionen liegen unter `desktop/src-tauri`

## Aktiver Produktpfad

### Frontend
- `frontend/src/contexts/AuthContext.js`: zentrale Session- und Login-Verwaltung
- `frontend/src/contexts/E2EEContext.js`: Desktop-E2EE, Geräte-/Recovery-Flow, Attachment-Krypto
- `frontend/src/lib/api.js`: einziger aktiver API-/Refresh-/Token-Transportpfad
- `frontend/src/lib/serverPermissions.js`: dünner UI-Adapter für den serverseitigen Viewer-Context
- `frontend/src/components/settings/GlobalSettingsOverlay.js`
- `frontend/src/components/settings/ServerSettingsOverlay.js`

### Backend
- `backend/app/main.py`: Auth, Sessions, Server, Channels, Nachrichten, Voice, E2EE, WebSocket
- `backend/app/auth_service.py`: Argon2id, Refresh-Rotation, serverseitige Sessions, Revocation
- `backend/app/permissions.py`: zentrale Server-/Kategorie-/Kanal-Permission-Engine
- `backend/app/rate_limits.py`: gemeinsame Fixed-Window-Rate-Limits
- `backend/routes_phase2.py`: Threads, Gruppen-DMs, Channel-Overrides, weitere E2EE- und Privatkanal-Flows
- `backend/routes_phase3.py`: Notifications, Pins, Emoji, Webhooks, Bot-/Push-Funktionen

### Desktop / Tauri
- `desktop/src-tauri/src/main.rs`: Tauri-Einstieg, PTT, native Capture-Brücke
- `desktop/src-tauri/src/native_capture.rs`: nativer Desktop-Capture-Pfad

## Sicherheitsmodell

### Auth und Sessions

- Access-Tokens sind kurzlebige JWTs
- Refresh-Tokens sind zufällige opaque Tokens
- im Backend werden nur gehashte Refresh-Tokens gespeichert
- jede Refresh-Anfrage rotiert den Refresh-Token und widerruft die alte Session
- Sessions liegen in `auth_sessions`

### Rollen und Berechtigungen

Singra Vox verwendet serverseitig erzwungene Berechtigungen. Die aktive Quelle der Wahrheit ist `backend/app/permissions.py`.

Die Auswertung erfolgt in dieser Reihenfolge:
1. Basisrechte aus Default-Rolle und Member-Rollen
2. Kategorie-Overrides
3. Kanal-Overrides
4. private Kanal-ACLs (`channel_access`)

### Voice und Streaming

- produktiv nur LiveKit / SFU
- keine produktive Browser-P2P-Signaling-Architektur
- `join_voice` steuert Room-Join / Subscribe
- `speak` steuert Mikrofon-Publishing
- `stream` steuert Kamera und Screen Share

## E2EE-Realität

### Was in v1 geschützt ist

E2EE in Singra Vox v1 gilt nur für:
- Direktnachrichten
- Gruppen-DMs
- private Server-Kanäle
- verschlüsselte private Voice-Räume mit LiveKit-E2EE

Der starke Vertrauenspfad ist die Desktop-App. Die Web-App ist für diese Bereiche kein vollwertiger E2EE-Client.

### Was ausdrücklich nicht behauptet wird

Die aktuelle E2EE-Implementierung ist **nicht** Signal, Double Ratchet oder MLS. Sie bietet in der aktuellen Form keine belegte Forward Secrecy oder Post-Compromise Security auf Signal-/MLS-Niveau. Produkttexte und Doku müssen das genauso benennen.

### Metadaten

Auch in E2EE-Räumen bleiben Metadaten sichtbar, unter anderem:
- beteiligte Nutzer
- Channel-/Raum-Mitgliedschaft
- Zeitstempel
- ungefähre Größen
- Routing-Ziele wie Erwähnungen

## Aktive und deaktivierte Legacy-Pfade

### Deaktiviert
- altes WebSocket-P2P-Signaling für `voice_offer`, `voice_answer`, `voice_ice`
- Legacy-WebCrypto-Datei `frontend/src/lib/crypto.js`
- ältere Settings-Modals parallel zu den aktiven Overlays

### Aktiv
- `frontend/src/lib/e2ee/crypto.js`
- `frontend/src/lib/e2ee/deviceStorage.js`
- `frontend/src/lib/e2ee/media.js`

## Datenmodell

Wichtige Collections:
- `users`
- `servers`
- `channels`
- `messages`
- `direct_messages`
- `group_conversations`
- `group_messages`
- `server_members`
- `roles`
- `channel_overrides`
- `channel_access`
- `voice_states`
- `audit_log`
- `read_states`
- `notifications`
- `auth_sessions`
- `e2ee_accounts`
- `e2ee_devices`
- `e2ee_blob_uploads`
- `e2ee_blob_objects`

## Nächster geplanter Migrationspfad

Der spätere Zielpfad für Gruppen-E2EE ist MLS. Dieser Pfad ist derzeit ein Designziel, nicht produktiver Code. Die aktuelle v1-Implementierung ist bewusst als `encrypted_v1` zu verstehen und muss transparent so kommuniziert werden.
