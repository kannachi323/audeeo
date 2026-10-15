//! WASAPI capture: the default microphone, the desktop mix (optionally without
//! this process tree) and per-process loopback. Ported from Audeeo's
//! `windows_audio.rs` without the app framework.

#[path = "windows_sources.rs"]
mod sources;

use crate::capture::{FailureSink, FrameCounter, Sink};
use crate::{AudioSource, Capabilities, CaptureError, Resampler};
use std::collections::VecDeque;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use wasapi::{
    AudioCaptureClient, AudioClient, DeviceEnumerator, Direction, SampleType, StreamMode,
    WaveFormat,
};

pub(crate) use sources::capture_sources;

const DEVICE_RATE: usize = 48_000;

pub(crate) struct Running {
    stop: mpsc::Sender<()>,
    worker: thread::JoinHandle<()>,
}

impl Running {
    pub fn stop(self) {
        let _ = self.stop.send(());
        let _ = self.worker.join();
    }
}

pub(crate) fn capabilities() -> Capabilities {
    // Process loopback needs Windows 10 2004 or later, which every supported
    // Windows release already is; an older system fails at start instead.
    Capabilities {
        mic: true,
        system_audio: true,
        process_audio: true,
        exclude_self: true,
    }
}

pub(crate) fn start(
    source: AudioSource,
    sink: Sink,
    failure: FailureSink,
) -> Result<Running, CaptureError> {
    let (stop, stop_rx) = mpsc::channel();
    let (started_tx, started_rx) = mpsc::sync_channel(1);
    let worker = thread::Builder::new()
        .name(match source {
            AudioSource::Mic => "audeeo-wasapi-microphone".into(),
            _ => "audeeo-wasapi-loopback".into(),
        })
        .spawn(move || {
            if let Err(error) = capture_loop(&source, &stop_rx, &started_tx, &sink) {
                if started_tx.try_send(Err(error.clone())).is_err() {
                    failure(error);
                }
            }
        })
        .map_err(|error| CaptureError::Device(error.to_string()))?;
    match started_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => Ok(Running { stop, worker }),
        Ok(Err(error)) => {
            let _ = worker.join();
            Err(error)
        }
        Err(_) => {
            let _ = stop.send(());
            let _ = worker.join();
            Err(CaptureError::Device("audio did not start in time".into()))
        }
    }
}

struct Stream {
    client: AudioClient,
    capture: AudioCaptureClient,
    channels: usize,
    bytes: VecDeque<u8>,
    resampler: Resampler,
    pcm: Vec<i16>,
}

fn device_error(error: impl std::fmt::Display) -> CaptureError {
    CaptureError::Device(error.to_string())
}

fn open_streams(source: &AudioSource) -> Result<Vec<Stream>, CaptureError> {
    let clients: Vec<(AudioClient, usize)> = match source {
        AudioSource::Mic => {
            let device = DeviceEnumerator::new()
                .and_then(|e| e.get_default_device(&Direction::Capture))
                .map_err(|_| CaptureError::Unsupported("A microphone"))?;
            vec![(device.get_iaudioclient().map_err(device_error)?, 1)]
        }
        AudioSource::System { exclude_self: true } => {
            // Excluding our own process tree keeps our playback out of the mix.
            vec![(
                AudioClient::new_application_loopback_client(std::process::id(), false)
                    .map_err(device_error)?,
                2,
            )]
        }
        AudioSource::System {
            exclude_self: false,
        } => {
            let device = DeviceEnumerator::new()
                .and_then(|e| e.get_default_device(&Direction::Render))
                .map_err(device_error)?;
            vec![(device.get_iaudioclient().map_err(device_error)?, 2)]
        }
        AudioSource::Processes(pids) => pids
            .iter()
            .map(|pid| {
                AudioClient::new_application_loopback_client(*pid, true)
                    .map(|client| (client, 2))
                    .map_err(|_| CaptureError::NoSuchProcess)
            })
            .collect::<Result<_, _>>()?,
    };
    let mut streams = Vec::with_capacity(clients.len());
    for (mut client, channels) in clients {
        let format = WaveFormat::new(32, 32, &SampleType::Float, DEVICE_RATE, channels, None);
        let mode = StreamMode::PollingShared {
            autoconvert: true,
            buffer_duration_hns: 200_000,
        };
        client
            .initialize_client(&format, &Direction::Capture, &mode)
            .map_err(device_error)?;
        let capture = client.get_audiocaptureclient().map_err(device_error)?;
        streams.push(Stream {
            client,
            capture,
            channels,
            bytes: VecDeque::new(),
            resampler: Resampler::new(DEVICE_RATE as u32, channels),
            pcm: Vec::new(),
        });
    }
    Ok(streams)
}

fn capture_loop(
    source: &AudioSource,
    stop: &mpsc::Receiver<()>,
    started: &mpsc::SyncSender<Result<(), CaptureError>>,
    sink: &Sink,
) -> Result<(), CaptureError> {
    wasapi::initialize_mta().ok().map_err(device_error)?;
    let result = (|| {
        let mut streams = open_streams(source)?;
        for stream in &streams {
            stream.client.start_stream().map_err(device_error)?;
        }
        let _ = started.send(Ok(()));
        let channel = source.channel();
        let mut frames = FrameCounter::new();
        let mut floats = Vec::new();
        while stop.try_recv().is_err() {
            for stream in &mut streams {
                stream
                    .capture
                    .read_from_device_to_deque(&mut stream.bytes)
                    .map_err(device_error)?;
                let frame_bytes = 4 * stream.channels;
                let whole = stream.bytes.len() / frame_bytes * frame_bytes;
                floats.clear();
                floats.extend(
                    stream
                        .bytes
                        .drain(..whole)
                        .collect::<Vec<u8>>()
                        .chunks_exact(4)
                        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])),
                );
                stream.resampler.push_f32(&floats, &mut stream.pcm);
            }
            let mixed = mix(&mut streams);
            if !mixed.is_empty() {
                sink(frames.chunk(channel, mixed));
            }
            thread::sleep(Duration::from_millis(10));
        }
        for stream in &streams {
            let _ = stream.client.stop_stream();
        }
        Ok(())
    })();
    wasapi::deinitialize();
    result
}

/// Sums what every stream has in common, keeping the rest for the next pass.
fn mix(streams: &mut [Stream]) -> Vec<i16> {
    let ready = streams.iter().map(|s| s.pcm.len()).min().unwrap_or(0);
    let mut mixed = vec![0i32; ready];
    for stream in streams.iter_mut() {
        for (total, sample) in mixed.iter_mut().zip(stream.pcm.drain(..ready)) {
            *total += sample as i32;
        }
    }
    mixed
        .into_iter()
        .map(|s| s.clamp(i16::MIN as i32, i16::MAX as i32) as i16)
        .collect()
}
