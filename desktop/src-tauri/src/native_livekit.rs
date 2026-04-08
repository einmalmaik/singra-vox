// Singra Vox - Privacy-first communication platform
// Copyright (C) 2026  Maik Haedrich
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::State;

#[cfg(target_os = "windows")]
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
#[cfg(target_os = "windows")]
use crabgrab::{
    feature::bitmap::FrameBitmap,
    prelude::{CaptureStream, StreamEvent, VideoFrameBitmap},
};
#[cfg(target_os = "windows")]
use libwebrtc::{
    native::yuv_helper,
    prelude::{I420Buffer, RtcVideoSource, VideoFrame, VideoResolution, VideoRotation},
    video_source::native::NativeVideoSource,
};
#[cfg(target_os = "windows")]
use livekit::{
    e2ee::{
        key_provider::{KeyProvider, KeyProviderOptions},
        E2eeOptions, EncryptionType,
    },
    options::{TrackPublishOptions, VideoEncoding},
    prelude::{LocalTrack, LocalTrackPublication, Room, RoomEvent, RoomOptions, TrackSource},
    track::LocalVideoTrack,
};

#[cfg(target_os = "windows")]
use crate::native_capture::{
    build_capture_config, ensure_capture_source_handle, DesktopCaptureStore,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeScreenShareStartInput {
    pub server_url: String,
    pub participant_token: String,
    pub room_name: String,
    pub participant_identity: String,
    pub source_id: String,
    pub requested_width: Option<u32>,
    pub requested_height: Option<u32>,
    pub requested_frame_rate: Option<u32>,
    pub max_bitrate: Option<u64>,
    pub max_frame_rate: Option<f64>,
    pub simulcast: Option<bool>,
    pub e2ee_required: Option<bool>,
    pub shared_media_key_b64: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeScreenShareSessionInfo {
    pub active: bool,
    pub provider: String,
    pub room_name: String,
    pub participant_identity: String,
    pub source_id: String,
    pub source_kind: String,
    pub source_label: String,
    pub requested_width: u32,
    pub requested_height: u32,
    pub requested_frame_rate: u32,
    pub max_bitrate: Option<u64>,
    pub max_frame_rate: Option<f64>,
    pub simulcast: bool,
    pub e2ee_required: bool,
}

#[derive(Default)]
pub struct NativeScreenShareStore {
    #[cfg(target_os = "windows")]
    inner: Arc<Mutex<NativeScreenShareState>>,
}

#[cfg(target_os = "windows")]
#[derive(Default)]
struct NativeScreenShareState {
    active_session: Option<ActiveNativeScreenShareSession>,
}

#[cfg(target_os = "windows")]
struct ActiveNativeScreenShareSession {
    info: NativeScreenShareSessionInfo,
    control: Arc<NativeScreenShareControl>,
    event_task: tokio::task::JoinHandle<()>,
}

#[cfg(target_os = "windows")]
struct NativeScreenShareControl {
    room: Arc<Room>,
    publication: LocalTrackPublication,
    capture_stream: Mutex<Option<CaptureStream>>,
    key_provider: Option<KeyProvider>,
    shutdown_started: AtomicBool,
}

#[cfg(target_os = "windows")]
impl NativeScreenShareControl {
    fn new(room: Arc<Room>, publication: LocalTrackPublication, key_provider: Option<KeyProvider>) -> Self {
        Self {
            room,
            publication,
            capture_stream: Mutex::new(None),
            key_provider,
            shutdown_started: AtomicBool::new(false),
        }
    }

    fn set_capture_stream(&self, capture_stream: CaptureStream) -> Result<(), String> {
        let mut guard = self
            .capture_stream
            .lock()
            .map_err(|_| "The native screen-share state is unavailable.".to_string())?;
        *guard = Some(capture_stream);
        Ok(())
    }

    fn is_shutdown(&self) -> bool {
        self.shutdown_started.load(Ordering::Relaxed)
    }

    fn set_shared_key(&self, shared_key: Vec<u8>, key_index: i32) -> bool {
        let Some(key_provider) = self.key_provider.as_ref() else {
            return false;
        };
        key_provider.set_shared_key(shared_key, key_index);
        self.room.e2ee_manager().set_enabled(true);
        true
    }

    async fn shutdown(&self) {
        if self.shutdown_started.swap(true, Ordering::SeqCst) {
            return;
        }

        if let Ok(mut guard) = self.capture_stream.lock() {
            if let Some(mut capture_stream) = guard.take() {
                let _ = capture_stream.stop();
            }
        }

        let _ = self
            .room
            .local_participant()
            .unpublish_track(&self.publication.sid())
            .await;
        let _ = self.room.close().await;
    }
}

#[cfg(target_os = "windows")]
struct LiveKitFrameBridge {
    video_source: NativeVideoSource,
    argb_bytes: Vec<u8>,
    width: u32,
    height: u32,
}

#[cfg(target_os = "windows")]
impl LiveKitFrameBridge {
    fn new(video_source: NativeVideoSource) -> Self {
        Self {
            video_source,
            argb_bytes: Vec::new(),
            width: 0,
            height: 0,
        }
    }

    fn capture_bgra_frame(
        &mut self,
        width: u32,
        height: u32,
        bgra_pixels: &[[u8; 4]],
    ) -> Result<(), String> {
        let pixel_count = (width as usize)
            .checked_mul(height as usize)
            .ok_or_else(|| "The native frame dimensions are invalid.".to_string())?;
        let pixel_bytes = pixel_count
            .checked_mul(4)
            .ok_or_else(|| "The native frame dimensions are invalid.".to_string())?;

        if bgra_pixels.len() < pixel_count {
            return Err("The native frame payload is truncated.".into());
        }

        if self.width != width || self.height != height || self.argb_bytes.len() != pixel_bytes {
            self.width = width;
            self.height = height;
            self.argb_bytes.resize(pixel_bytes, 0);
        }

        for (bgra, argb) in bgra_pixels
            .iter()
            .zip(self.argb_bytes.chunks_exact_mut(4))
        {
            argb[0] = bgra[3];
            argb[1] = bgra[2];
            argb[2] = bgra[1];
            argb[3] = bgra[0];
        }

        let mut i420_buffer = I420Buffer::new(width, height);
        let (stride_y, stride_u, stride_v) = i420_buffer.strides();
        let (data_y, data_u, data_v) = i420_buffer.data_mut();
        yuv_helper::argb_to_i420(
            &self.argb_bytes,
            width.saturating_mul(4),
            data_y,
            stride_y,
            data_u,
            stride_u,
            data_v,
            stride_v,
            width as i32,
            height as i32,
        );

        let frame = VideoFrame {
            rotation: VideoRotation::VideoRotation0,
            timestamp_us: 0,
            buffer: i420_buffer,
        };
        self.video_source.capture_frame(&frame);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
fn decode_shared_media_key(shared_media_key_b64: &str) -> Result<Vec<u8>, String> {
    BASE64_STANDARD
        .decode(shared_media_key_b64)
        .map_err(|error| format!("The encrypted voice room key could not be decoded: {error}"))
}

#[cfg(target_os = "windows")]
fn build_e2ee_options(
    e2ee_required: bool,
    shared_media_key_b64: Option<&str>,
) -> Result<Option<(E2eeOptions, KeyProvider)>, String> {
    if !e2ee_required {
        return Ok(None);
    }

    let shared_media_key = shared_media_key_b64
        .ok_or_else(|| "Encrypted voice channels require a shared media key before publishing.".to_string())
        .and_then(decode_shared_media_key)?;
    let key_provider = KeyProvider::with_shared_key(KeyProviderOptions::default(), shared_media_key);
    Ok(Some((
        E2eeOptions {
            encryption_type: EncryptionType::Gcm,
            key_provider: key_provider.clone(),
        },
        key_provider,
    )))
}

#[cfg(target_os = "windows")]
async fn stop_active_session(store: &NativeScreenShareStore) -> Result<bool, String> {
    let active_session = {
        let mut guard = store
            .inner
            .lock()
            .map_err(|_| "The native screen-share state is unavailable.".to_string())?;
        guard.active_session.take()
    };

    let Some(active_session) = active_session else {
        return Ok(false);
    };

    active_session.control.shutdown().await;
    active_session.event_task.abort();
    Ok(true)
}

#[cfg(target_os = "windows")]
async fn start_native_screen_share_inner(
    input: NativeScreenShareStartInput,
    capture_store: &DesktopCaptureStore,
    screen_share_store: &NativeScreenShareStore,
) -> Result<NativeScreenShareSessionInfo, String> {
    let _ = stop_active_session(screen_share_store).await?;

    let token = match CaptureStream::test_access(true) {
        Some(token) => token,
        None => CaptureStream::request_access(true)
            .await
            .ok_or_else(|| "Native capture access was denied by Windows.".to_string())?,
    };

    let requested_width = input.requested_width.unwrap_or(1280).max(1);
    let requested_height = input.requested_height.unwrap_or(720).max(1);
    let requested_frame_rate = input.requested_frame_rate.unwrap_or(30).max(1);
    let source_handle = ensure_capture_source_handle(capture_store, &input.source_id).await?;
    let (source_kind, source_label, capture_config) =
        build_capture_config(source_handle, requested_width, requested_height)?;

    let e2ee = build_e2ee_options(
        input.e2ee_required.unwrap_or(false),
        input.shared_media_key_b64.as_deref(),
    )?;
    let mut room_options = RoomOptions::default();
    room_options.auto_subscribe = false;
    room_options.adaptive_stream = false;
    room_options.dynacast = false;
    let mut key_provider = None;
    if let Some((e2ee_options, next_key_provider)) = e2ee {
        room_options.encryption = Some(e2ee_options);
        key_provider = Some(next_key_provider);
    }

    let (room, mut event_rx) = Room::connect(
        &input.server_url,
        &input.participant_token,
        room_options,
    )
    .await
    .map_err(|error| format!("The native LiveKit screen-share room could not connect: {error}"))?;
    let room = Arc::new(room);
    if key_provider.is_some() {
        room.e2ee_manager().set_enabled(true);
    }

    let rtc_source = NativeVideoSource::new(
        VideoResolution {
            width: requested_width,
            height: requested_height,
        },
        true,
    );
    let local_track = LocalVideoTrack::create_video_track(
        "native-screen-share",
        RtcVideoSource::Native(rtc_source.clone()),
    );
    let publication = room
        .local_participant()
        .publish_track(
            LocalTrack::Video(local_track),
            TrackPublishOptions {
                video_encoding: Some(VideoEncoding {
                    max_bitrate: input.max_bitrate.unwrap_or(3_000_000),
                    max_framerate: input.max_frame_rate.unwrap_or(requested_frame_rate as f64),
                }),
                simulcast: input.simulcast.unwrap_or(false),
                source: TrackSource::Screenshare,
                stream: format!("native-screen-share:{}", input.participant_identity),
                ..Default::default()
            },
        )
        .await
        .map_err(|error| format!("The native LiveKit video track could not be published: {error}"))?;

    let control = Arc::new(NativeScreenShareControl::new(
        room.clone(),
        publication,
        key_provider,
    ));
    let frame_bridge = Arc::new(Mutex::new(LiveKitFrameBridge::new(rtc_source)));
    let last_forwarded_at = Arc::new(Mutex::new(None::<std::time::Instant>));
    let frame_interval = std::time::Duration::from_millis(
        (1000u64 / requested_frame_rate as u64).max(16),
    );

    let capture_stream = CaptureStream::new(token, capture_config, {
        let frame_bridge = frame_bridge.clone();
        let last_forwarded_at = last_forwarded_at.clone();
        move |result| {
            let Ok(event) = result else {
                return;
            };
            let StreamEvent::Video(frame) = event else {
                return;
            };

            let now = std::time::Instant::now();
            let should_forward = {
                let Ok(mut guard) = last_forwarded_at.lock() else {
                    return;
                };
                match *guard {
                    Some(last_forwarded) if now.duration_since(last_forwarded) < frame_interval => false,
                    _ => {
                        *guard = Some(now);
                        true
                    }
                }
            };

            if !should_forward {
                return;
            }

            let bitmap = match frame.get_bitmap() {
                Ok(FrameBitmap::BgraUnorm8x4(bitmap)) => bitmap,
                Ok(_) => {
                    eprintln!("[native_livekit] Unsupported pixel format returned by native capture");
                    return;
                }
                Err(error) => {
                    eprintln!("[native_livekit] Failed to read native capture bitmap: {error}");
                    return;
                }
            };

            if let Ok(mut bridge) = frame_bridge.lock() {
                if let Err(error) = bridge.capture_bgra_frame(
                    bitmap.width as u32,
                    bitmap.height as u32,
                    bitmap.data.as_ref(),
                ) {
                    eprintln!("[native_livekit] Failed to forward native capture frame: {error}");
                }
            }
        }
    })
    .map_err(|error| format!("The native desktop capture stream could not start: {error}"))?;

    control.set_capture_stream(capture_stream)?;

    let info = NativeScreenShareSessionInfo {
        active: true,
        provider: "tauri-native-livekit".into(),
        room_name: input.room_name,
        participant_identity: input.participant_identity.clone(),
        source_id: input.source_id,
        source_kind,
        source_label,
        requested_width,
        requested_height,
        requested_frame_rate,
        max_bitrate: input.max_bitrate,
        max_frame_rate: input.max_frame_rate,
        simulcast: input.simulcast.unwrap_or(false),
        e2ee_required: input.e2ee_required.unwrap_or(false),
    };

    let control_for_events = control.clone();
    let event_task = tokio::spawn(async move {
        while let Some(event) = event_rx.recv().await {
            if let RoomEvent::Disconnected { .. } = event {
                control_for_events.shutdown().await;
                break;
            }
        }
    });

    let mut guard = screen_share_store
        .inner
        .lock()
        .map_err(|_| "The native screen-share state is unavailable.".to_string())?;
    guard.active_session = Some(ActiveNativeScreenShareSession {
        info: info.clone(),
        control,
        event_task,
    });

    Ok(info)
}

#[tauri::command]
pub async fn start_native_screen_share(
    input: NativeScreenShareStartInput,
    capture_store: State<'_, DesktopCaptureStore>,
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<NativeScreenShareSessionInfo, String> {
    #[cfg(target_os = "windows")]
    {
        return start_native_screen_share_inner(input, &capture_store, &screen_share_store).await;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = input;
        let _ = capture_store;
        let _ = screen_share_store;
        Err("Native LiveKit desktop screen share is currently only implemented for Windows builds.".into())
    }
}

#[tauri::command]
pub async fn stop_native_screen_share(
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        return stop_active_session(&screen_share_store).await;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = screen_share_store;
        Err("Native LiveKit desktop screen share is currently only implemented for Windows builds.".into())
    }
}

#[tauri::command]
pub fn update_native_screen_share_key(
    shared_media_key_b64: String,
    key_index: Option<i32>,
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let shared_key = decode_shared_media_key(&shared_media_key_b64)?;
        let guard = screen_share_store
            .inner
            .lock()
            .map_err(|_| "The native screen-share state is unavailable.".to_string())?;
        let Some(active_session) = guard.active_session.as_ref() else {
            return Ok(false);
        };
        if active_session.control.is_shutdown() {
            return Ok(false);
        }
        return Ok(active_session
            .control
            .set_shared_key(shared_key, key_index.unwrap_or(0)));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = shared_media_key_b64;
        let _ = key_index;
        let _ = screen_share_store;
        Err("Native LiveKit desktop screen share is currently only implemented for Windows builds.".into())
    }
}

#[tauri::command]
pub fn get_native_screen_share_session(
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<Option<NativeScreenShareSessionInfo>, String> {
    #[cfg(target_os = "windows")]
    {
        let mut guard = screen_share_store
            .inner
            .lock()
            .map_err(|_| "The native screen-share state is unavailable.".to_string())?;

        if guard
            .active_session
            .as_ref()
            .map(|session| session.control.is_shutdown() || session.event_task.is_finished())
            .unwrap_or(false)
        {
            guard.active_session = None;
        }

        return Ok(guard.active_session.as_ref().map(|session| session.info.clone()));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = screen_share_store;
        Err("Native LiveKit desktop screen share is currently only implemented for Windows builds.".into())
    }
}
