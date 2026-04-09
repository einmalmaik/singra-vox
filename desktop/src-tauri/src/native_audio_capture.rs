// Singra Vox - Privacy-first communication platform
// Copyright (C) 2026  Maik Haedrich
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published
// by the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
#[cfg(target_os = "windows")]
use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    sync::mpsc,
    thread::JoinHandle,
    time::Duration,
};

#[cfg(target_os = "windows")]
use windows::{
    core::Interface,
    Win32::{
        Media::Audio::{
            eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
            MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX, WAVE_FORMAT_PCM,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL,
            COINIT_MULTITHREADED,
        },
    },
};

#[cfg(target_os = "windows")]
pub(crate) const DEFAULT_SYSTEM_AUDIO_SAMPLE_RATE: u32 = 48_000;
#[cfg(target_os = "windows")]
pub(crate) const DEFAULT_SYSTEM_AUDIO_CHANNELS: u16 = 2;
#[cfg(target_os = "windows")]
pub(crate) const DEFAULT_SYSTEM_AUDIO_QUEUE_MS: u32 = 20;

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy)]
pub(crate) struct NativeSystemAudioCaptureConfig {
    pub sample_rate: u32,
    pub num_channels: u16,
    pub buffer_frames: u32,
    pub poll_interval: Duration,
}

#[cfg(target_os = "windows")]
impl Default for NativeSystemAudioCaptureConfig {
    fn default() -> Self {
        Self {
            sample_rate: DEFAULT_SYSTEM_AUDIO_SAMPLE_RATE,
            num_channels: DEFAULT_SYSTEM_AUDIO_CHANNELS,
            buffer_frames: DEFAULT_SYSTEM_AUDIO_SAMPLE_RATE / 100,
            poll_interval: Duration::from_millis(5),
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, Clone, Copy)]
pub(crate) struct NativeSystemAudioCapturePacket<'a> {
    pub data: &'a [i16],
    pub sample_rate: u32,
    pub num_channels: u32,
    pub samples_per_channel: u32,
}

#[cfg(target_os = "windows")]
struct SendCaptureClient(*mut c_void);

#[cfg(target_os = "windows")]
unsafe impl Send for SendCaptureClient {}
#[cfg(target_os = "windows")]
unsafe impl Sync for SendCaptureClient {}

#[cfg(target_os = "windows")]
impl SendCaptureClient {
    fn from_iaudiocaptureclient(client: IAudioCaptureClient) -> Self {
        Self(client.into_raw())
    }

    fn into_iaudiocaptureclient(self) -> IAudioCaptureClient {
        unsafe { IAudioCaptureClient::from_raw(self.0) }
    }
}

#[cfg(target_os = "windows")]
struct SendAudioClient(*mut c_void);

#[cfg(target_os = "windows")]
unsafe impl Send for SendAudioClient {}
#[cfg(target_os = "windows")]
unsafe impl Sync for SendAudioClient {}

#[cfg(target_os = "windows")]
impl SendAudioClient {
    fn from_iaudioclient(client: IAudioClient) -> Self {
        Self(client.into_raw())
    }

    fn into_iaudioclient(self) -> IAudioClient {
        unsafe { IAudioClient::from_raw(self.0) }
    }
}

#[cfg(target_os = "windows")]
pub(crate) struct NativeSystemAudioCaptureStream {
    stop_flag: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

#[cfg(target_os = "windows")]
impl NativeSystemAudioCaptureStream {
    pub(crate) fn new(
        config: NativeSystemAudioCaptureConfig,
        mut callback: Box<
            dyn for<'a> FnMut(Result<NativeSystemAudioCapturePacket<'a>, String>) + Send + 'static,
        >,
    ) -> Result<Self, String> {
        unsafe {
            let should_couninit = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
            let mm_device_enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|error| {
                        format!("The default audio endpoint enumerator could not be created: {error}")
                    })?;
            let device = mm_device_enumerator
                .GetDefaultAudioEndpoint(eRender, eConsole)
                .map_err(|error| {
                    format!("The default system audio output could not be resolved: {error}")
                })?;
            let audio_client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|error| format!("The system audio client could not be activated: {error}"))?;

            let mut format = WAVEFORMATEX::default();
            format.wFormatTag = WAVE_FORMAT_PCM as u16;
            format.nSamplesPerSec = config.sample_rate;
            format.wBitsPerSample = 16;
            format.nChannels = config.num_channels;
            format.nBlockAlign = config.num_channels.saturating_mul(2);
            format.nAvgBytesPerSec = config.sample_rate.saturating_mul(format.nBlockAlign as u32);
            format.cbSize = 0;

            let buffer_time = config.buffer_frames as i64 * 10_000_000i64 / config.sample_rate as i64;
            audio_client
                .Initialize(
                    AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_LOOPBACK,
                    buffer_time,
                    buffer_time,
                    &format as *const _,
                    None,
                )
                .map_err(|error| {
                    format!("The system audio capture client could not be initialized: {error}")
                })?;

            let capture_client: IAudioCaptureClient = audio_client
                .GetService()
                .map_err(|error| {
                    format!("The system audio capture service could not be created: {error}")
                })?;
            let audio_client_send = SendAudioClient::from_iaudioclient(audio_client);
            let capture_client_send = SendCaptureClient::from_iaudiocaptureclient(capture_client);
            let stop_flag = Arc::new(AtomicBool::new(false));
            let stop_flag_worker = stop_flag.clone();
            let (startup_tx, startup_rx) = mpsc::channel::<Result<(), String>>();
            let worker = std::thread::spawn(move || {
                let should_couninit_thread = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
                let audio_client = audio_client_send.into_iaudioclient();
                let capture_client = capture_client_send.into_iaudiocaptureclient();
                let mut silence_buffer = Vec::<i16>::new();

                if let Err(error) = audio_client.Start() {
                    let message =
                        format!("The system audio capture stream could not start: {error}");
                    let _ = startup_tx.send(Err(message.clone()));
                    callback(Err(message));
                    if should_couninit_thread {
                        CoUninitialize();
                    }
                    return;
                }
                let _ = startup_tx.send(Ok(()));

                while !stop_flag_worker.load(Ordering::Relaxed) {
                    std::thread::sleep(config.poll_interval);

                    loop {
                        let packet_size = match capture_client.GetNextPacketSize() {
                            Ok(packet_size) => packet_size,
                            Err(error) => {
                                callback(Err(format!(
                                    "The system audio capture packet size could not be read: {error}"
                                )));
                                return;
                            }
                        };

                        if packet_size == 0 {
                            break;
                        }

                        let mut data_ptr: *mut u8 = std::ptr::null_mut();
                        let mut num_frames = 0u32;
                        let mut flags = 0u32;
                        if let Err(error) = capture_client.GetBuffer(
                            &mut data_ptr as *mut _,
                            &mut num_frames as *mut _,
                            &mut flags as *mut _,
                            None,
                            None,
                        ) {
                            callback(Err(format!(
                                "The system audio capture buffer could not be acquired: {error}"
                            )));
                            return;
                        }

                        if num_frames == 0 {
                            let _ = capture_client.ReleaseBuffer(0);
                            continue;
                        }

                        let sample_count =
                            num_frames as usize * usize::from(config.num_channels.max(1));
                        let silent = flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
                        let packet_data = if silent || data_ptr.is_null() {
                            silence_buffer.clear();
                            silence_buffer.resize(sample_count, 0);
                            silence_buffer.as_slice()
                        } else {
                            std::slice::from_raw_parts(data_ptr as *const i16, sample_count)
                        };

                        callback(Ok(NativeSystemAudioCapturePacket {
                            data: packet_data,
                            sample_rate: config.sample_rate,
                            num_channels: u32::from(config.num_channels),
                            samples_per_channel: num_frames,
                        }));

                        let _ = capture_client.ReleaseBuffer(num_frames);
                    }
                }

                let _ = audio_client.Stop();
                if should_couninit_thread {
                    CoUninitialize();
                }
            });

            if should_couninit {
                CoUninitialize();
            }

            match startup_rx.recv() {
                Ok(Ok(())) => Ok(Self {
                    stop_flag,
                    worker: Some(worker),
                }),
                Ok(Err(error)) => {
                    stop_flag.store(true, Ordering::SeqCst);
                    let _ = worker.join();
                    Err(error)
                }
                Err(_) => {
                    stop_flag.store(true, Ordering::SeqCst);
                    let _ = worker.join();
                    Err("The system audio capture worker exited before startup completed.".into())
                }
            }
        }
    }

    pub(crate) fn stop(&mut self) {
        if self.stop_flag.swap(true, Ordering::SeqCst) {
            return;
        }

        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for NativeSystemAudioCaptureStream {
    fn drop(&mut self) {
        self.stop();
    }
}
