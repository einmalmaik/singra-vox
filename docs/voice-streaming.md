# Voice / Streaming

## Summary

The voice and streaming stack keeps `new VoiceEngine()` as the stable public
frontend API, but the implementation is now split into smaller modules with
single responsibilities. LiveKit remains the only source of truth for room,
publication, subscription, and track state.

## Frontend modules

- `frontend/src/lib/voiceEngine.js`
  Stable facade for the existing UI API and event names.
- `frontend/src/lib/voice/VoiceSessionController.js`
  Join, disconnect, reconnect cleanup, and E2EE bootstrap.
- `frontend/src/lib/voice/LocalAudioController.js`
  Microphone lifecycle, mute, deafen, PTT, and mic test.
- `frontend/src/lib/voice/LocalVideoController.js`
  Camera lifecycle and restarts.
- `frontend/src/lib/voice/ScreenShareController.js`
  Browser and desktop screen share, quality presets, audio options, and
  native-session rehydrate.
- `frontend/src/lib/voice/RemoteMediaController.js`
  LiveKit room events and speaking-state coordination.
- `frontend/src/lib/voice/RemoteAudioController.js`
  Remote audio elements, sink-device routing, and cleanup.
- `frontend/src/lib/voice/RemoteVideoController.js`
  Track-ref projection, proxy-backed local screen-share sync, and stage attach.
- `frontend/src/lib/voice/ScreenShareProxyMap.js`
  Proxy identity to owner-user mapping for native desktop screen share.

## Sidebar integration

- `frontend/src/components/chat/ChannelSidebar.js`
  Public facade used by `MainLayout`.
- `frontend/src/components/chat/sidebar/useChannelSidebarController.js`
  Container hook that composes the sidebar state.
- `frontend/src/components/chat/sidebar/hooks/`
  Smaller hooks for channel creation, channel tree, media stage, screen-share
  dialog, and voice-channel state.
- `frontend/src/components/chat/sidebar/*`
  Presentational UI modules only. They do not call the API or the voice engine
  directly.

## Viewer lifecycle

- Remote and proxy-backed video is projected from LiveKit publications.
- `videoTrackRefs` is only a UI-friendly projection. It is not a second media
  engine.
- `VoiceMediaStage` attaches exactly one selected track ref.
- Closing the stage only detaches the element. It does not manually disable a
  LiveKit publication.
- The stage keeps a small retry window for one specific case: a publication is
  attachable, but Chromium has not produced the first renderable frame yet.

## Native desktop path

- `desktop/src-tauri/src/screen_share/commands.rs`
  Public Tauri commands for capture-source listing, start/stop, session lookup,
  and audio-volume updates.
- `desktop/src-tauri/src/screen_share/session.rs`
  Shared screen-share session DTOs and capability reporting.
- `desktop/src-tauri/src/screen_share/publisher.rs`
  Shared publisher entrypoints that route to platform-specific implementations.
- `desktop/src-tauri/src/screen_share/capture/*`
  Platform-specific capture adapters.
- `desktop/src-tauri/src/screen_share/audio/*`
  Platform-specific audio adapters.

## Capability rules

- `get_desktop_runtime_info` is the only desktop capability truth source for
  the frontend.
- Desktop UI must not assume native capture or system-audio support without
  reading that runtime capability matrix first.

Current platform status:

- Windows:
  Native capture and native system audio are implemented.
- macOS 13+:
  Native capture is implemented. Native system audio is not complete yet.
- Linux:
  Native PipeWire or portal-backed publishing is not complete yet. The desktop
  UI must gate unsupported options instead of pretending support exists.

## Important debugging signal

The most important viewer failure mode we have seen is stale UI track state:
the LiveKit publication already has a renderable track, but the cached track ref
still says `pending`. The attach path now refreshes the projected track refs
from the current room publications before binding the stage element. That avoids
the old behavior where an unrelated stream event could "wake up" another stream.

## Manual verification

1. Desktop client joins a voice channel.
2. Start screen share and open self-preview.
3. Join the same channel from a second browser or desktop client.
4. Open the remote stream once.
5. Close and reopen the preview.
6. Switch tabs and return.
7. Start and stop a second stream and confirm the first stream stays stable.
