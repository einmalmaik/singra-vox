// Singra Vox - Privacy-first communication platform
// Copyright (C) 2026  Maik Haedrich
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc, Mutex,
};
use tauri::State;

#[cfg(any(target_os = "windows", target_os = "macos"))]
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use crabgrab::{
    feature::bitmap::FrameBitmap,
    prelude::{CaptureStream, StreamEvent, VideoFrameBitmap},
};
#[cfg(target_os = "windows")]
use libwebrtc::{
    audio_frame::AudioFrame,
    audio_source::{native::NativeAudioSource, AudioSourceOptions, RtcAudioSource},
};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use libwebrtc::{
    native::yuv_helper,
    prelude::{I420Buffer, RtcVideoSource, VideoFrame, VideoResolution, VideoRotation},
    video_source::native::NativeVideoSource,
};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use livekit::{
    e2ee::{
        key_provider::{KeyProvider, KeyProviderOptions},
        E2eeOptions, EncryptionType,
    },
    options::{TrackPublishOptions, VideoEncoding},
    prelude::{LocalTrack, LocalTrackPublication, Room, RoomEvent, RoomOptions, TrackSource},
    track::{LocalAudioTrack, LocalVideoTrack},
};

#[cfg(target_os = "windows")]
use crate::native_audio_capture::{
    NativeSystemAudioCaptureConfig, NativeSystemAudioCaptureStream,
    DEFAULT_SYSTEM_AUDIO_CHANNELS, DEFAULT_SYSTEM_AUDIO_QUEUE_MS,
};
#[cfg(any(target_os = "windows", target_os = "macos"))]
use crate::native_capture::{
    build_capture_config, ensure_capture_source_handle, fit_output_dimensions,
    normalize_capture_dimensions, DesktopCaptureStore,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeScreenShareStartInput {
    pub server_url: String,
    pub participant_token: String,
    pub room_name: String,
    pub participant_identity: String,
    pub source_id: String,
    pub audio_enabled: Option<bool>,
    pub audio_volume: Option<u32>,
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
    pub source_width: u32,
    pub source_height: u32,
    pub requested_width: u32,
    pub requested_height: u32,
    pub requested_frame_rate: u32,
    pub has_audio: bool,
    pub max_bitrate: Option<u64>,
    pub max_frame_rate: Option<f64>,
    pub simulcast: bool,
    pub e2ee_required: bool,
}

#[derive(Default)]
pub struct NativeScreenShareStore {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    inner: Arc<Mutex<NativeScreenShareState>>,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
#[derive(Default)]
struct NativeScreenShareState {
    active_session: Option<ActiveNativeScreenShareSession>,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
struct ActiveNativeScreenShareSession {
    info: NativeScreenShareSessionInfo,
    control: Arc<NativeScreenShareControl>,
    event_task: tokio::task::JoinHandle<()>,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
struct NativeScreenShareControl {
    room: Arc<Room>,
    video_publication: LocalTrackPublication,
    audio_publication: Option<LocalTrackPublication>,
    capture_stream: Mutex<Option<CaptureStream>>,
    #[cfg(target_os = "windows")]
    audio_capture_stream: Mutex<Option<NativeSystemAudioCaptureStream>>,
    audio_volume: Arc<AtomicU32>,
    key_provider: Option<KeyProvider>,
    shutdown_started: AtomicBool,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl NativeScreenShareControl {
    fn new(
        room: Arc<Room>,
        video_publication: LocalTrackPublication,
        audio_publication: Option<LocalTrackPublication>,
        audio_volume: Arc<AtomicU32>,
        key_provider: Option<KeyProvider>,
    ) -> Self {
        Self {
            room,
            video_publication,
            audio_publication,
            capture_stream: Mutex::new(None),
            #[cfg(target_os = "windows")]
            audio_capture_stream: Mutex::new(None),
            audio_volume,
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

    #[cfg(target_os = "windows")]
    fn set_audio_capture_stream(
        &self,
        audio_capture_stream: NativeSystemAudioCaptureStream,
    ) -> Result<(), String> {
        let mut guard = self
            .audio_capture_stream
            .lock()
            .map_err(|_| "The native screen-share audio state is unavailable.".to_string())?;
        *guard = Some(audio_capture_stream);
        Ok(())
    }

    fn is_shutdown(&self) -> bool {
        self.shutdown_started.load(Ordering::Relaxed)
    }

    fn set_audio_volume(&self, volume: u32) {
        self.audio_volume
            .store(clamp_audio_volume(volume), Ordering::Relaxed);
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
        #[cfg(target_os = "windows")]
        if let Ok(mut guard) = self.audio_capture_stream.lock() {
            if let Some(mut audio_capture_stream) = guard.take() {
                audio_capture_stream.stop();
            }
        }

        let _ = self
            .room
            .local_participant()
            .unpublish_track(&self.video_publication.sid())
            .await;
        if let Some(audio_publication) = self.audio_publication.as_ref() {
            let _ = self
                .room
                .local_participant()
                .unpublish_track(&audio_publication.sid())
                .await;
        }
        let _ = self.room.close().await;
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
struct LiveKitFrameBridge {
    video_source: NativeVideoSource,
    max_width: u32,
    max_height: u32,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl LiveKitFrameBridge {
    fn new(video_source: NativeVideoSource, max_width: u32, max_height: u32) -> Self {
        Self {
            video_source,
            max_width: max_width.max(2),
            max_height: max_height.max(2),
        }
    }

    fn capture_bgra_frame(
        &mut self,
        width: u32,
        height: u32,
        bgra_pixels: &[[u8; 4]],
    ) -> Result<(), String> {
        let raw_pixel_count = (width as usize)
            .checked_mul(height as usize)
            .ok_or_else(|| "The native frame dimensions are invalid.".to_string())?;
        let pixel_bytes = raw_pixel_count
            .checked_mul(4)
            .ok_or_else(|| "The native frame dimensions are invalid.".to_string())?;
        let (source_width, source_height) = normalize_capture_dimensions(width, height);

        if bgra_pixels.len() < raw_pixel_count {
            return Err("The native frame payload is truncated.".into());
        }

        // libyuv names ARGB by channel significance, not by byte order. On
        // little-endian Windows the BGRA bytes we get from native capture match
        // libyuv's expected ARGB memory layout, so we can convert directly
        // without a full-frame channel swizzle. That removes the blue/purple
        // tint and cuts one large per-frame copy from the hot path.
        let bgra_bytes =
            unsafe { std::slice::from_raw_parts(bgra_pixels.as_ptr() as *const u8, pixel_bytes) };

        let mut i420_buffer = I420Buffer::new(source_width, source_height);
        let (stride_y, stride_u, stride_v) = i420_buffer.strides();
        let (data_y, data_u, data_v) = i420_buffer.data_mut();
        yuv_helper::argb_to_i420(
            bgra_bytes,
            width.saturating_mul(4),
            data_y,
            stride_y,
            data_u,
            stride_u,
            data_v,
            stride_v,
            source_width as i32,
            source_height as i32,
        );
        let (target_width, target_height) = fit_output_dimensions(
            source_width,
            source_height,
            self.max_width,
            self.max_height,
        );
        if target_width != source_width || target_height != source_height {
            i420_buffer = i420_buffer.scale(target_width as i32, target_height as i32);
        }

        let frame = VideoFrame {
            rotation: VideoRotation::VideoRotation0,
            timestamp_us: 0,
            buffer: i420_buffer,
        };
        self.video_source.capture_frame(&frame);
        Ok(())
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn clamp_audio_volume(volume: u32) -> u32 {
    volume.clamp(0, 200)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn apply_audio_volume(samples: &[i16], volume: u32) -> Vec<i16> {
    let volume_factor = clamp_audio_volume(volume) as f32 / 100.0;
    if (volume_factor - 1.0).abs() < f32::EPSILON {
        return samples.to_vec();
    }

    samples
        .iter()
        .map(|sample| {
            let scaled = (*sample as f32 * volume_factor)
                .clamp(i16::MIN as f32, i16::MAX as f32);
            scaled as i16
        })
        .collect()
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn decode_shared_media_key(shared_media_key_b64: &str) -> Result<Vec<u8>, String> {
    BASE64_STANDARD
        .decode(shared_media_key_b64)
        .map_err(|error| format!("The encrypted voice room key could not be decoded: {error}"))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn build_e2ee_options(
    e2ee_required: bool,
    shared_media_key_b64: Option<&str>,
) -> Result<Option<(E2eeOptions, KeyProvider)>, String> {
    if !e2ee_required {
        return Ok(None);
    }

    let shared_media_key = shared_media_key_b64
        .ok_or_else(|| {
            "Encrypted voice channels require a shared media key before publishing.".to_string()
        })
        .and_then(decode_shared_media_key)?;
    let key_provider =
        KeyProvider::with_shared_key(KeyProviderOptions::default(), shared_media_key);
    Ok(Some((
        E2eeOptions {
            encryption_type: EncryptionType::Gcm,
            key_provider: key_provider.clone(),
        },
        key_provider,
    )))
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
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

#[cfg(any(target_os = "windows", target_os = "macos"))]
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
    let requested_audio = input.audio_enabled.unwrap_or(false);
    #[cfg(target_os = "macos")]
    if requested_audio {
        return Err(
            "Native system audio capture is not implemented for macOS builds yet.".into(),
        );
    }
    let requested_audio_volume = clamp_audio_volume(input.audio_volume.unwrap_or(100));
    let source_handle = ensure_capture_source_handle(capture_store, &input.source_id).await?;
    let (source_kind, source_label, capture_config, capture_geometry) =
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

    let (room, mut event_rx) =
        Room::connect(&input.server_url, &input.participant_token, room_options)
            .await
            .map_err(|error| {
                format!("The native LiveKit screen-share room could not connect: {error}")
            })?;
    let room = Arc::new(room);
    if key_provider.is_some() {
        room.e2ee_manager().set_enabled(true);
    }

    let rtc_source = NativeVideoSource::new(
        VideoResolution {
            width: capture_geometry.output_width,
            height: capture_geometry.output_height,
        },
        true,
    );
    let native_stream_name = format!("native-screen-share:{}", input.participant_identity);
    let local_track = LocalVideoTrack::create_video_track(
        "native-screen-share",
        RtcVideoSource::Native(rtc_source.clone()),
    );
    let video_publication = room
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
                stream: native_stream_name.clone(),
                ..Default::default()
            },
        )
        .await
        .map_err(|error| {
            format!("The native LiveKit video track could not be published: {error}")
        })?;

    let audio_volume = Arc::new(AtomicU32::new(requested_audio_volume));
    #[cfg(target_os = "windows")]
    let audio_publication = if requested_audio {
        let audio_capture_config = NativeSystemAudioCaptureConfig::default();
        let audio_source = NativeAudioSource::new(
            AudioSourceOptions::default(),
            audio_capture_config.sample_rate,
            u32::from(DEFAULT_SYSTEM_AUDIO_CHANNELS),
            DEFAULT_SYSTEM_AUDIO_QUEUE_MS,
        );
        let audio_track = LocalAudioTrack::create_audio_track(
            "native-screen-share-audio",
            RtcAudioSource::Native(audio_source.clone()),
        );
        let publication = room
            .local_participant()
            .publish_track(
                LocalTrack::Audio(audio_track),
                TrackPublishOptions {
                    source: TrackSource::ScreenshareAudio,
                    stream: native_stream_name.clone(),
                    ..Default::default()
                },
            )
            .await
            .map_err(|error| {
                format!("The native LiveKit audio track could not be published: {error}")
            })?;

        let runtime_handle = tokio::runtime::Handle::current();
        let audio_volume_state = audio_volume.clone();
        let audio_capture_stream = match NativeSystemAudioCaptureStream::new(
            audio_capture_config,
            Box::new(move |result| match result {
                Ok(packet) => {
                    let packet_samples =
                        apply_audio_volume(packet.data, audio_volume_state.load(Ordering::Relaxed));
                    let frame = AudioFrame {
                        sample_rate: packet.sample_rate,
                        num_channels: packet.num_channels,
                        samples_per_channel: packet.samples_per_channel,
                        data: packet_samples.into(),
                    };
                    if let Err(error) = runtime_handle.block_on(audio_source.capture_frame(&frame)) {
                        eprintln!(
                            "[native_livekit] Failed to forward native system audio frame: {error}"
                        );
                    }
                }
                Err(error) => {
                    eprintln!("[native_livekit] Native system audio capture failed: {error}");
                }
            }),
        ) {
            Ok(audio_capture_stream) => audio_capture_stream,
            Err(error) => {
                let _ = room
                    .local_participant()
                    .unpublish_track(&publication.sid())
                    .await;
                let _ = room
                    .local_participant()
                    .unpublish_track(&video_publication.sid())
                    .await;
                let _ = room.close().await;
                return Err(error);
            }
        };

        Some((publication, audio_capture_stream))
    } else {
        None
    };
    #[cfg(target_os = "macos")]
    let audio_publication: Option<(LocalTrackPublication, ())> = None;

    let control = Arc::new(NativeScreenShareControl::new(
        room.clone(),
        video_publication,
        audio_publication.as_ref().map(|(publication, _)| publication.clone()),
        audio_volume,
        key_provider,
    ));
    #[cfg(target_os = "windows")]
    if let Some((_, audio_capture_stream)) = audio_publication {
        if let Err(error) = control.set_audio_capture_stream(audio_capture_stream) {
            control.shutdown().await;
            return Err(error);
        }
    }
    let frame_bridge = Arc::new(Mutex::new(LiveKitFrameBridge::new(
        rtc_source,
        capture_geometry.max_width,
        capture_geometry.max_height,
    )));
    let last_forwarded_at = Arc::new(Mutex::new(None::<std::time::Instant>));
    let frame_interval =
        std::time::Duration::from_millis((1000u64 / requested_frame_rate as u64).max(16));

    let capture_stream = match CaptureStream::new(token, capture_config, {
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
                let Ok(mut guard) = last_forwarded_at.try_lock() else {
                    return;
                };
                match *guard {
                    Some(last_forwarded) if now.duration_since(last_forwarded) < frame_interval => {
                        false
                    }
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
                    eprintln!(
                        "[native_livekit] Unsupported pixel format returned by native capture"
                    );
                    return;
                }
                Err(error) => {
                    eprintln!("[native_livekit] Failed to read native capture bitmap: {error}");
                    return;
                }
            };

            // Real-time preview is more important than perfect frame delivery.
            // If the conversion bridge is still busy, we drop this frame instead
            // of queueing up seconds of stale video.
            if let Ok(mut bridge) = frame_bridge.try_lock() {
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
    .map_err(|error| format!("The native desktop capture stream could not start: {error}")) {
        Ok(capture_stream) => capture_stream,
        Err(error) => {
            control.shutdown().await;
            return Err(error);
        }
    };

    if let Err(error) = control.set_capture_stream(capture_stream) {
        control.shutdown().await;
        return Err(error);
    }

    let info = NativeScreenShareSessionInfo {
        active: true,
        provider: "tauri-native-livekit".into(),
        room_name: input.room_name,
        participant_identity: input.participant_identity.clone(),
        source_id: input.source_id,
        source_kind,
        source_label,
        source_width: capture_geometry.source_width,
        source_height: capture_geometry.source_height,
        // Expose the effective capture size after aspect-preserving scaling so
        // the frontend can display and layout against the real stream bounds.
        requested_width: capture_geometry.output_width,
        requested_height: capture_geometry.output_height,
        requested_frame_rate,
        has_audio: requested_audio,
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

pub async fn start_native_screen_share(
    input: NativeScreenShareStartInput,
    capture_store: State<'_, DesktopCaptureStore>,
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<NativeScreenShareSessionInfo, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        return start_native_screen_share_inner(input, &capture_store, &screen_share_store).await;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = input;
        let _ = capture_store;
        let _ = screen_share_store;
        Err("Native LiveKit desktop screen share is currently only implemented for Windows and macOS builds.".into())
    }
}

pub async fn stop_native_screen_share(
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<bool, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    {
        return stop_active_session(&screen_share_store).await;
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = screen_share_store;
        Err("Native LiveKit desktop screen share is currently only implemented for Windows and macOS builds.".into())
    }
}

pub fn update_native_screen_share_key(
    shared_media_key_b64: String,
    key_index: Option<i32>,
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<bool, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
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

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = shared_media_key_b64;
        let _ = key_index;
        let _ = screen_share_store;
        Err("Native LiveKit desktop screen share is currently only implemented for Windows and macOS builds.".into())
    }
}

pub fn update_native_screen_share_audio_volume(
    volume: u32,
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
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
        active_session.control.set_audio_volume(volume);
        return Ok(true);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = volume;
        let _ = screen_share_store;
        Err("Native desktop screen-share audio volume control is only available on Windows builds.".into())
    }
}

pub fn get_native_screen_share_session(
    screen_share_store: State<'_, NativeScreenShareStore>,
) -> Result<Option<NativeScreenShareSessionInfo>, String> {
    #[cfg(any(target_os = "windows", target_os = "macos"))]
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

        return Ok(guard
            .active_session
            .as_ref()
            .map(|session| session.info.clone()));
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = screen_share_store;
        Err("Native LiveKit desktop screen share is currently only implemented for Windows and macOS builds.".into())
    }
}

#[cfg(all(test, any(target_os = "windows", target_os = "macos")))]
mod tests {
    use super::{apply_audio_volume, clamp_audio_volume};

    #[test]
    fn clamp_audio_volume_limits_desktop_screen_share_audio() {
        assert_eq!(clamp_audio_volume(0), 0);
        assert_eq!(clamp_audio_volume(100), 100);
        assert_eq!(clamp_audio_volume(250), 200);
    }

    #[test]
    fn apply_audio_volume_scales_and_clamps_samples() {
        assert_eq!(apply_audio_volume(&[1000, -1000], 100), vec![1000, -1000]);
        assert_eq!(apply_audio_volume(&[1000, -1000], 50), vec![500, -500]);
        assert_eq!(
            apply_audio_volume(&[30_000, -30_000], 200),
            vec![i16::MAX, i16::MIN],
        );
    }
}
