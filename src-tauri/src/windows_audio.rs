use base64::Engine;
use std::collections::VecDeque;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use wasapi::{AudioClient, DeviceEnumerator, Direction, SampleType, SessionState, StreamMode, WaveFormat};

pub fn capture_sources() -> Result<serde_json::Value, String> {
    wasapi::initialize_mta()
        .ok()
        .map_err(|error| format!("COM initialization failed: {error}"))?;
    let result = (|| {
        let enumerator = DeviceEnumerator::new().map_err(|error| error.to_string())?;
        let microphone = enumerator
            .get_default_device(&Direction::Capture)
            .and_then(|device| device.get_friendlyname())
            .unwrap_or_else(|_| "Microphone".into());
        let render = enumerator
            .get_default_device(&Direction::Render)
            .map_err(|error| error.to_string())?;
        let sessions = render
            .get_iaudiosessionmanager()
            .and_then(|manager| manager.get_audiosessionenumerator())
            .map_err(|error| error.to_string())?;
        let mut capture_sources = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for index in 0..sessions.get_count().map_err(|error| error.to_string())? {
            let Ok(session) = sessions.get_session(index) else { continue };
            if session.get_state().ok() != Some(SessionState::Active) { continue; }
            let Ok(pid) = session.get_process_id() else { continue };
            if pid == std::process::id() || !seen.insert(pid) { continue; }
            let display = session.get_display_name().unwrap_or_default();
            let identifier = session.get_session_identifier().unwrap_or_default();
            capture_sources.push(serde_json::json!({
                "id": format!("windows:{pid}"),
                "name": application_name(&display, &identifier, pid),
            }));
        }
        capture_sources.sort_by(|left, right| left["name"].as_str().cmp(&right["name"].as_str()));
        let mut applications: Vec<_> = capture_sources
            .iter()
            .filter_map(|source| source["name"].as_str().map(str::to_owned))
            .collect();
        applications.dedup();
        Ok(serde_json::json!({
            "microphone": microphone,
            "applications": applications,
            "captureSources": capture_sources,
        }))
    })();
    wasapi::deinitialize();
    result
}

fn application_name(display: &str, identifier: &str, pid: u32) -> String {
    if !display.trim().is_empty() { return display.trim().to_owned(); }
    let path = identifier.split("%b").next().unwrap_or(identifier);
    let file = path.rsplit(['\\', '/']).next().unwrap_or("").trim();
    if !file.is_empty() {
        return file.strip_suffix(".exe").unwrap_or(file).to_owned();
    }
    format!("Application {pid}")
}

pub struct WindowsAudioCapture {
    stop: mpsc::Sender<()>,
    worker: thread::JoinHandle<()>,
}

#[derive(Clone, Copy)]
enum CaptureKind {
    Microphone,
    System(Option<u32>),
}

impl WindowsAudioCapture {
    pub fn start_microphone(app: tauri::AppHandle) -> Result<Self, String> {
        Self::start(app, CaptureKind::Microphone)
    }

    pub fn start_system(app: tauri::AppHandle, process_id: Option<u32>) -> Result<Self, String> {
        Self::start(app, CaptureKind::System(process_id))
    }

    fn start(app: tauri::AppHandle, kind: CaptureKind) -> Result<Self, String> {
        let (stop, stop_rx) = mpsc::channel();
        let (started_tx, started_rx) = mpsc::sync_channel(1);
        let worker_name = match kind {
            CaptureKind::Microphone => "audeeo-wasapi-microphone",
            CaptureKind::System(_) => "audeeo-wasapi-loopback",
        };
        let failure_name = match kind {
            CaptureKind::Microphone => "Microphone capture",
            CaptureKind::System(_) => "Device audio capture",
        };
        let worker = thread::Builder::new()
            .name(worker_name.into())
            .spawn(move || {
                if let Err(error) = capture_loop(&app, &stop_rx, &started_tx, kind) {
                    let message = format!("{failure_name} failed: {error}");
                    let _ = started_tx.try_send(Err(message.clone()));
                    let _ = app.emit("capture-error", message);
                }
            })
            .map_err(|error| format!("Could not start device audio worker: {error}"))?;

        match started_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(Self { stop, worker }),
            Ok(Err(error)) => {
                let _ = worker.join();
                Err(error)
            }
            Err(_) => {
                let _ = stop.send(());
                let _ = worker.join();
                Err("Device audio did not start in time".into())
            }
        }
    }

    pub fn stop(self) -> Result<(), String> {
        let _ = self.stop.send(());
        self.worker
            .join()
            .map_err(|_| "Device audio worker stopped unexpectedly".to_string())
    }
}

fn capture_loop(
    app: &tauri::AppHandle,
    stop: &mpsc::Receiver<()>,
    started: &mpsc::SyncSender<Result<(), String>>,
    kind: CaptureKind,
) -> Result<(), String> {
    wasapi::initialize_mta()
        .ok()
        .map_err(|error| format!("COM initialization failed: {error}"))?;
    let (mut client, channels, chunk_event, ready_event) = match kind {
        CaptureKind::Microphone => {
            let enumerator = DeviceEnumerator::new().map_err(|error| error.to_string())?;
            let device = enumerator
                .get_default_device(&Direction::Capture)
                .map_err(|error| format!("No default Windows microphone is available: {error}"))?;
            let client = device.get_iaudioclient().map_err(|error| error.to_string())?;
            (client, 1usize, "microphone-chunk", "microphone-ready")
        }
        CaptureKind::System(Some(pid)) => {
            let client = AudioClient::new_application_loopback_client(pid, true)
                .map_err(|error| format!("Could not isolate the selected application: {error}"))?;
            (client, 2usize, "system-audio-chunk", "system-ready")
        }
        CaptureKind::System(None) => {
            // Application loopback exclusion captures the desktop mix without
            // Audeeo's translated playback re-entering the model input.
            let client = AudioClient::new_application_loopback_client(std::process::id(), false)
                .map_err(|error| format!("Could not capture the Windows desktop mix: {error}"))?;
            (client, 2usize, "system-audio-chunk", "system-ready")
        }
    };
    let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, channels, None);
    let mode = StreamMode::PollingShared {
        autoconvert: true,
        buffer_duration_hns: 200_000,
    };
    client
        .initialize_client(&format, &Direction::Capture, &mode)
        .map_err(|error| format!("WASAPI loopback initialization failed: {error}"))?;
    let capture = client
        .get_audiocaptureclient()
        .map_err(|error| error.to_string())?;
    client.start_stream().map_err(|error| error.to_string())?;
    started
        .send(Ok(()))
        .map_err(|_| "Capture startup was cancelled".to_string())?;
    let _ = app.emit(ready_event, ());

    let mut bytes = VecDeque::new();
    let mut pcm = Vec::<i16>::with_capacity(1600);
    while stop.try_recv().is_err() {
        capture
            .read_from_device_to_deque(&mut bytes)
            .map_err(|error| format!("Could not read the Windows output mix: {error}"))?;
        convert_48k_to_mono_16k(&mut bytes, &mut pcm, channels);
        if !pcm.is_empty() {
            let raw =
                unsafe { std::slice::from_raw_parts(pcm.as_ptr().cast::<u8>(), pcm.len() * 2) };
            let _ = app.emit(
                chunk_event,
                serde_json::json!({
                    "data": base64::engine::general_purpose::STANDARD.encode(raw),
                    "sampleRate": 16000
                }),
            );
            pcm.clear();
        }
        thread::sleep(Duration::from_millis(10));
    }
    client.stop_stream().map_err(|error| error.to_string())?;
    wasapi::deinitialize();
    Ok(())
}

fn convert_48k_to_mono_16k(bytes: &mut VecDeque<u8>, output: &mut Vec<i16>, channels: usize) {
    let input_frame_bytes = 4 * channels;
    while bytes.len() >= input_frame_bytes * 3 {
        let mut sum = 0.0f32;
        for _ in 0..3 {
            let mut frame = vec![0u8; input_frame_bytes];
            for byte in &mut frame {
                *byte = bytes.pop_front().unwrap();
            }
            let channel_sum: f32 = frame
                .chunks_exact(4)
                .map(|sample| f32::from_le_bytes(sample.try_into().unwrap()))
                .sum();
            sum += channel_sum / channels as f32;
        }
        let sample = (sum / 3.0).clamp(-1.0, 1.0);
        output.push(if sample < 0.0 {
            (sample * 32768.0) as i16
        } else {
            (sample * 32767.0) as i16
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_stereo_48k_to_mono_16k() {
        let mut input = VecDeque::new();
        for sample in [0.6f32, 0.3, 0.0] {
            input.extend(sample.to_le_bytes());
            input.extend(sample.to_le_bytes());
        }
        let mut output = Vec::new();
        convert_48k_to_mono_16k(&mut input, &mut output, 2);
        assert_eq!(output.len(), 1);
        assert!((output[0] - 9829).abs() <= 1);
        assert!(input.is_empty());
    }

    #[test]
    fn converts_mono_microphone_48k_to_16k() {
        let mut input = VecDeque::new();
        for sample in [0.6f32, 0.3, 0.0] {
            input.extend(sample.to_le_bytes());
        }
        let mut output = Vec::new();
        convert_48k_to_mono_16k(&mut input, &mut output, 1);
        assert_eq!(output.len(), 1);
        assert!((output[0] - 9829).abs() <= 1);
        assert!(input.is_empty());
    }

    #[test]
    fn derives_readable_application_names_from_audio_sessions() {
        assert_eq!(application_name("", r"C:\Program Files\Video\player.exe%b{session}", 42), "player");
        assert_eq!(application_name("Browser", "ignored", 42), "Browser");
        assert_eq!(application_name("", "", 42), "Application 42");
    }
}
