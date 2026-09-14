use base64::Engine;
use std::collections::VecDeque;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;
use tauri::Emitter;
use wasapi::{DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};

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
        let output = enumerator
            .get_default_device(&Direction::Render)
            .and_then(|device| device.get_friendlyname())
            .unwrap_or_else(|_| "All device audio".into());
        Ok(serde_json::json!({
            "microphone": microphone,
            "applications": [output]
        }))
    })();
    wasapi::deinitialize();
    result
}

pub struct WindowsAudioCapture {
    stop: mpsc::Sender<()>,
    worker: thread::JoinHandle<()>,
}

impl WindowsAudioCapture {
    pub fn start(app: tauri::AppHandle) -> Result<Self, String> {
        let (stop, stop_rx) = mpsc::channel();
        let (started_tx, started_rx) = mpsc::sync_channel(1);
        let worker = thread::Builder::new()
            .name("audeeo-wasapi-loopback".into())
            .spawn(move || {
                if let Err(error) = capture_loop(&app, &stop_rx, &started_tx) {
                    let message = format!("Device audio capture failed: {error}");
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
) -> Result<(), String> {
    wasapi::initialize_mta()
        .ok()
        .map_err(|error| format!("COM initialization failed: {error}"))?;
    let enumerator = DeviceEnumerator::new().map_err(|error| error.to_string())?;
    let device = enumerator
        .get_default_device(&Direction::Render)
        .map_err(|error| format!("No default Windows output device is available: {error}"))?;
    let mut client = device
        .get_iaudioclient()
        .map_err(|error| error.to_string())?;
    let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, 2, None);
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
    let _ = app.emit("system-ready", ());

    let mut bytes = VecDeque::new();
    let mut pcm = Vec::<i16>::with_capacity(1600);
    while stop.try_recv().is_err() {
        capture
            .read_from_device_to_deque(&mut bytes)
            .map_err(|error| format!("Could not read the Windows output mix: {error}"))?;
        convert_stereo_48k_to_mono_16k(&mut bytes, &mut pcm);
        if !pcm.is_empty() {
            let raw =
                unsafe { std::slice::from_raw_parts(pcm.as_ptr().cast::<u8>(), pcm.len() * 2) };
            let _ = app.emit(
                "system-audio-chunk",
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

fn convert_stereo_48k_to_mono_16k(bytes: &mut VecDeque<u8>, output: &mut Vec<i16>) {
    const INPUT_FRAME_BYTES: usize = 8;
    while bytes.len() >= INPUT_FRAME_BYTES * 3 {
        let mut sum = 0.0f32;
        for _ in 0..3 {
            let mut frame = [0u8; INPUT_FRAME_BYTES];
            for byte in &mut frame {
                *byte = bytes.pop_front().unwrap();
            }
            let left = f32::from_le_bytes(frame[0..4].try_into().unwrap());
            let right = f32::from_le_bytes(frame[4..8].try_into().unwrap());
            sum += (left + right) * 0.5;
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
        convert_stereo_48k_to_mono_16k(&mut input, &mut output);
        assert_eq!(output.len(), 1);
        assert!((output[0] - 9829).abs() <= 1);
        assert!(input.is_empty());
    }
}
