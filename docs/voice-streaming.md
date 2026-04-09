# Voice / Streaming

## Zusammenfassung

Der Voice- und Streaming-Stack bleibt nach auÃŸen bei `new VoiceEngine()`, ist intern aber in kleine Verantwortungen zerlegt. Dadurch lassen sich Voice-Join, lokale Medien, Screen Share, Remote-Media-Sync und Desktop-Bridges getrennt testen und Ã¤ndern.

## Frontend-Module

- `frontend/src/lib/voiceEngine.js`
  Stabile Fassade fÃ¼r die bestehende UI-API und Event-Namen.
- `frontend/src/lib/voice/VoiceSessionController.js`
  Join, Disconnect, E2EE-Bootstrap, Reconnect-Cleanup und Event-Emission.
- `frontend/src/lib/voice/LocalAudioController.js`
  Mikrofon, Mute/Deafen/PTT, Analyse, Monitoring und Output-Routing.
- `frontend/src/lib/voice/LocalVideoController.js`
  Kamera-Lifecycle.
- `frontend/src/lib/voice/ScreenShareController.js`
  Browser- und Desktop-Screenshare, Rehydrate, Audio-Regelung und QualitÃ¤tsprofile.
- `frontend/src/lib/voice/RemoteMediaController.js`
  LiveKit-Room-Events, Remote-Audio, TrackRef-Projektion und Preview-Subscription.
- `frontend/src/lib/voice/ScreenShareProxyMap.js`
  Kleines Proxy-Identity-zu-Owner-Mapping fÃ¼r den nativen Desktop-Screenshare.

## Viewer-Lifecycle

- LiveKit `publication + track` ist die einzige Quelle der Wahrheit fÃ¼r Remote-Video.
- `RemoteMediaController` baut daraus `videoTrackRefs`.
- `VoiceMediaStage` attached nur den selektierten Track und enthÃ¤lt die einzige Sonderlogik fÃ¼r "Track attachbar, aber erster Frame fehlt noch".
- Das SchlieÃŸen der Preview deaktiviert keine Remote-Publications manuell; `adaptiveStream` bleibt bei LiveKit.

## Desktop-Struktur

- `desktop/src-tauri/src/screen_share/commands.rs`
  Einheitliche Tauri-Commands fÃ¼r Capture-Quellen, Start/Stop, Session und Audio-Regelung.
- `desktop/src-tauri/src/screen_share/session.rs`
  Geteilte Session- und Capability-Typen.
- `desktop/src-tauri/src/screen_share/publisher.rs`
  Plattformneutrale Publisher-HÃ¼lle.
- `desktop/src-tauri/src/screen_share/capture/*`
  OS-spezifische Capture-Adapter.
- `desktop/src-tauri/src/screen_share/audio/*`
  OS-spezifische Audio-Adapter.

## Desktop-Capabilities

- `get_desktop_runtime_info` ist die Quelle der Wahrheit fÃ¼r Desktop-Screenshare-FÃ¤higkeiten.
- Das Frontend darf Desktop-Capture und Systemaudio nicht implizit annehmen; die UI liest die Capability-Matrix aus der Runtime-Bridge.
- Aktueller Stand:
  - Windows: nativer Capture-Pfad mit Systemaudio und Audio-LautstÃ¤rke-Regelung
  - macOS 13+: nativer Capture-Pfad ohne Systemaudio
  - Linux: kein nativer Capture-Adapter in diesem Build; die Desktop-UI fÃ¤llt auf den nicht-nativen Picker zurÃ¼ck

## Weitere Modul-Schnitte

- `frontend/src/lib/voice/RemoteAudioController.js`
  Haelt Audio-Elemente, Sink-Device-Anwendung und Audio-Cleanup getrennt vom Room-Event-Code.
- `frontend/src/lib/voice/RemoteVideoController.js`
  Haelt TrackRef-Projektion, Video-Revisionszaehlung und Stage-Attach getrennt vom Room-Event-Code.
- `frontend/src/hooks/useDesktopCaptureSources.js`
  Haelt Desktop-Source-Laden und Session-Rehydrate in einem kleinen, separat testbaren Hook.

## Logging

- Backend-Voice-Routen loggen Join, Leave, State-Updates und Token-Ausgabe mit `server_id`, `channel_id`, `user_id`, `participant_identity`, `room_name`, `platform`, `event` und `result`.
- Frontend-/Desktop-Logs bleiben klein und konzentrieren sich auf Voice-/Stream-Fehlerpfade.

## Manuelle PrÃ¼fung

1. Tauri-Client in Voice-Channel joinen.
2. Stream starten und Self-Preview Ã¶ffnen.
3. Zweiten Browser- oder Desktop-Client joinen und Stream direkt Ã¶ffnen.
4. Preview schlieÃŸen und erneut Ã¶ffnen.
5. Tab kurz verlassen und zurÃ¼ckkehren.
6. Zweiten Stream starten/stoppen und prÃ¼fen, dass der erste Stream stabil bleibt.
