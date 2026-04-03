# Desktop: Native System-/Process-Audio-Capture für Streams

## Kontext (Ist-Zustand)
- Desktop Native Screen-Capture ist aktuell Windows-only (`crabgrab`) und liefert RGBA Frames an das Frontend, das daraus via Canvas einen Video-Track erzeugt und zu LiveKit publisht: [native_capture.rs](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/desktop/src-tauri/src/native_capture.rs), [voiceEngine.js](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/frontend/src/lib/voiceEngine.js).
- Native Audio ist nicht implementiert (`has_audio: false`), UI zeigt Systemaudio-Share als “pending”: [native_capture.rs](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/desktop/src-tauri/src/native_capture.rs#L321-L332), [ChannelSidebar.js](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/frontend/src/components/chat/ChannelSidebar.js#L1597-L1623).
- Browser-Pfad kann bei Screen-Share Systemaudio nutzen (`createLocalScreenTracks({ systemAudio: "include" })`), ist aber abhängig von Browser/WebView-Support und Permissions: [voiceEngine.js](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/frontend/src/lib/voiceEngine.js#L450-L534).

## Ziele
- Native Audio-Capture für Desktop-Streams (Systemaudio und – wo möglich – process/app-spezifisch).
- Plattform-Support:
  - Windows: WASAPI Loopback (Systemaudio).
  - macOS: Core Audio Taps (System oder Prozess-Gruppe; macOS 14.2+).
  - Linux: PipeWire (bevorzugt) mit Fallback PulseAudio “monitor source”.
- Minimale Latenz, stabile Clocking/Resampling, robust gegen Gerätewechsel.
- Fallback bei fehlenden Permissions: Video-only weiterlaufen lassen, klarer Fehlercode/UX.
- Modulare Architektur (Backend-agnostisch, testbar, wiederverwendbar), klare Interfaces, TS-Deklarationen + JSDoc.

## Nicht-Ziele (für v1 der Implementierung)
- Perfekte “per-process capture” auf Windows (ohne virtuelle Treiber/APOs ist das i.d.R. nicht zuverlässig).
- Native WebRTC-Publishing in Rust (wir bleiben beim LiveKit JS Client und liefern einen MediaStreamTrack).

## Architektur-Überblick

```mermaid
flowchart LR
  subgraph Rust[Tauri (Rust)]
    CAP[CaptureSession Manager]
    AUD[AudioCapture Backend]
    WIN[WASAPI Loopback]
    MAC[CoreAudio Tap]
    LNX[PipeWire/PulseAudio]
    CH[IPC Stream Channel]
    CAP --> AUD
    AUD --> WIN
    AUD --> MAC
    AUD --> LNX
    AUD --> CH
  end

  subgraph JS[Frontend (WebView/React)]
    AW[AudioWorklet/Processor]
    DEST[MediaStreamAudioDestinationNode]
    LK[LiveKit publishTrack]
    CH -->|PCM frames| AW --> DEST -->|MediaStreamTrack| LK
  end
```

### Kernidee
- Rust capturt PCM (Float32 oder S16) in konstanten Frames (z.B. 10ms @ 48kHz).
- Rust streamt Frames über einen IPC-“Channel” zum Frontend.
- Frontend schreibt Frames in ein AudioWorklet, das einen “synthetischen” Audio-Track erzeugt (`MediaStreamAudioDestinationNode.stream.getAudioTracks()[0]`), der als `ScreenShareAudio` publisht wird.

## Plattform-Backends

### Windows (WASAPI Loopback)
- Implementierung: Shared-Mode Loopback Capture des Default Render Devices via `IAudioClient`/`IAudioCaptureClient`.
- Best Practices:
  - Loopback nur in Shared Mode möglich (kein Exclusive Mode).
  - Event-driven Loopback wird seit Windows 10 (1703+) unterstützt (kein Render-Workaround nötig).
  - Quelle: Microsoft “Loopback Recording” (Core Audio) https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording
- “Hardware Acceleration”: Audio-Capture selbst ist CPU/Kernel-Engine; der hardwarebeschleunigte Teil bleibt im WebRTC/LiveKit-Encoder (Video).

### macOS (Core Audio Taps)
- Bevorzugt ab macOS 14.2+ “Core Audio taps”, die Systemaudio oder Prozesse/Prozessgruppen gezielt capturen können; es gibt eine System-Permission “System Audio Recording”.
- Quelle: Apple Developer “Capturing system audio with Core Audio taps” https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps
- Fallback (ältere macOS): kein verlässliches Systemaudio ohne virtuelle Devices → nur Video oder Browser-Share (wenn verfügbar).

### Linux (PipeWire / PulseAudio)
- Primär: PipeWire, weil es Audio+Video Low-Latency und moderne Permission-Modelle unterstützt.
- Fallback: PulseAudio Monitor Source (`<sink>.monitor`) für Systemaudio (falls PipeWire nicht verfügbar).
- Quelle (PipeWire Überblick/Permission Modell): https://wiki.nixos.org/wiki/PipeWire

## Komponenten & Interfaces

### Rust: `audio_capture` Modul
**Ordnerstruktur (neu)**
- `desktop/src-tauri/src/audio_capture/mod.rs`
- `desktop/src-tauri/src/audio_capture/windows_wasapi.rs`
- `desktop/src-tauri/src/audio_capture/macos_coreaudio_tap.rs`
- `desktop/src-tauri/src/audio_capture/linux_pipewire.rs`

**Core Types (Rust, logisch)**
- `AudioCaptureKind = System | Process | ProcessGroup`
- `AudioFormat = { sample_rate, channels, sample_format }`
- `AudioFrame = { pts_ns, data }` (data als bytes; negotiated sample_format)
- `AudioCaptureError = PermissionDenied | NotSupported | DeviceLost | BackendError | Busy`

**API (Tauri Commands)**
- `list_audio_capture_sources() -> { backends: [...], capabilities: {...} }`
- `start_audio_capture(params, stream_channel) -> { session_id, format }`
- `stop_audio_capture(session_id) -> { ok }`

### JS: `nativeAudioCapture` Modul (neu)
**Dateien (neu)**
- `frontend/src/lib/nativeAudioCapture.js`
- `frontend/src/lib/nativeAudioCapture.d.ts`
- `frontend/src/lib/audioWorklet/pcm-player.worklet.js`

**TypeScript Deklarationen (Beispiel)**
```ts
export type AudioCaptureKind = "system" | "process" | "process_group";

export type AudioSampleFormat = "f32le" | "s16le";

export type AudioFormat = {
  sampleRate: number;
  channels: number;
  sampleFormat: AudioSampleFormat;
  frameDurationMs: number;
};

export type StartNativeAudioCaptureParams = {
  kind: AudioCaptureKind;
  processIds?: number[];
  deviceId?: string;
  preferredFormat?: Partial<AudioFormat>;
};

export type NativeAudioCaptureSession = {
  sessionId: string;
  format: AudioFormat;
  track: MediaStreamTrack;
  stop: () => Promise<void>;
};

export function startNativeAudioCapture(
  params: StartNativeAudioCaptureParams
): Promise<NativeAudioCaptureSession>;
```

**JSDoc Regeln**
- Jede exportierte Funktion erhält `@param`, `@returns`, `@throws` und ein Fehlercode-Schema.

## LiveKit Integration
- Erweiterung des nativen Desktop-Capture Flows in [voiceEngine.js](file:///c:/Users/einma/AppData/Local/Singra/workspace/singra-vox/frontend/src/lib/voiceEngine.js):
  - Wenn `shareOptions.audio === true` und Desktop-native Capture aktiv:
    - `startNativeAudioCapture({ kind:"system" ... })` → Audio-Track erzeugen
    - `room.localParticipant.publishTrack(audioTrack, { source: Track.Source.ScreenShareAudio })`
  - Wenn Permission/NotSupported:
    - Toast + `publishVideoOnly` (bestehendes Verhalten)

## Permission/Fallback-Mechanik
- Standard-Policy:
  - Permission denied → “Video-only” fortsetzen.
  - Not supported (OS/Version) → UI zeigt “Systemaudio nicht verfügbar” + bietet Browser-Share (falls `getDisplayMedia` Systemaudio unterstützt) als Alternative.
- Fehlerpropagation:
  - Rust liefert strukturierte Fehler (`code`, `message`, `details`) an JS.
  - JS mappt auf UX (Toast + optional “Learn more” Link in `docs/`).

## Tests

### Unit Tests
- JS:
  - Frame-Resampler/Converter (S16↔F32, Channel upmix/downmix).
  - AudioWorklet “contract tests” (Frame sizes, underrun handling).
- Rust:
  - Format negotiation + Ringbuffer-Logik (ohne OS API, per Mock Backend).

### Integration Tests (Desktop)
- “Loopback smoke”:
  - Start/Stop capture; prüft dass Frames ankommen, PTS monoton, kein Memory growth.
- “Device change”:
  - Simuliert Default-Device Wechsel (soweit möglich) → Session restarts sauber.
- “Permission denied”:
  - macOS: ohne Permission starten → erwartet “PermissionDenied”, App bleibt stabil.

### Performance Tests
- CPU Budget: AudioWorklet + IPC darf unter Last nicht “glitchen”.
- Backpressure:
  - Wenn UI thread blockiert: Audio frames werden gedroppt (bounded queue), ohne Memory leak.

## Implementierungsschritte (milestone-basiert)
- M0: Interfaces finalisieren (Rust+JS), Stream-IPC-Prototyp (Dummy-Sine).
- M1: Windows WASAPI Loopback Backend + E2E Playback-to-LiveKit (Systemaudio).
- M2: macOS Core Audio Tap Backend (System + optional Process IDs, macOS 14.2+).
- M3: Linux PipeWire Backend + PulseAudio Fallback.
- M4: UX/Permissions, Metrics, dokumentierte Capabilities-Matrix.
- M5: Test-Suites (Unit/Integration/Perf) + Stabilisierung (Device loss, suspend/resume).

## Risiken & Fallstricke
- macOS Tap-APIs sind versionsgebunden; für <14.2 bleibt nur Browser-Share/Video-only.
- Windows per-process Capture ist ohne Treiber/Virtual Device nicht sauber lösbar → explizit als Capability ausweisen.
- Audio drift zwischen Video und Audio: PTS/Clocking muss sauber an AudioContext gekoppelt werden (48kHz bevorzugt).

