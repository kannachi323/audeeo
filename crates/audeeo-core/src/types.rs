use serde::Serialize;
use std::fmt;

/// Every chunk this crate emits is mono PCM16 at this rate.
pub const SAMPLE_RATE: u32 = 16_000;

/// What to capture.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AudioSource {
    /// The default input device.
    Mic,
    /// Everything the computer plays. `exclude_self` leaves this process
    /// (and on Windows its process tree) out of the mix.
    System { exclude_self: bool },
    /// Only what these processes play, mixed down. On Windows each PID
    /// includes its process tree.
    Processes(Vec<u32>),
}

impl AudioSource {
    pub fn channel(&self) -> Channel {
        match self {
            AudioSource::Mic => Channel::Mic,
            _ => Channel::System,
        }
    }
}

/// Which stream a chunk belongs to. Kept separate end to end.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Channel {
    Mic,
    System,
}

/// A run of 16 kHz mono PCM16 samples.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PcmChunk {
    pub channel: Channel,
    /// Index of the first sample since the capture started, so consumers can
    /// align channels and keep chunks continuous.
    pub start_frame: u64,
    pub samples: Vec<i16>,
}

impl PcmChunk {
    pub fn end_frame(&self) -> u64 {
        self.start_frame + self.samples.len() as u64
    }

    pub fn duration_ms(&self) -> u64 {
        self.samples.len() as u64 * 1000 / SAMPLE_RATE as u64
    }

    /// Little-endian bytes, the wire format realtime transcribers expect.
    pub fn to_le_bytes(&self) -> Vec<u8> {
        self.samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect()
    }

    /// Root mean square power in 0..=1, for level meters.
    pub fn power(&self) -> f32 {
        if self.samples.is_empty() {
            return 0.0;
        }
        let sum: f32 = self
            .samples
            .iter()
            .map(|s| (*s as f32 / 32768.0).powi(2))
            .sum();
        (sum / self.samples.len() as f32).sqrt()
    }
}

/// What this build and OS version can capture.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub mic: bool,
    pub system_audio: bool,
    pub process_audio: bool,
    pub exclude_self: bool,
}

/// An application currently playing audio.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSource {
    pub name: String,
    pub pids: Vec<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSources {
    pub microphone: String,
    pub applications: Vec<CaptureSource>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CaptureError {
    /// The OS refused access (microphone or audio capture permission).
    PermissionDenied,
    /// Not available on this OS version or platform.
    Unsupported(&'static str),
    /// None of the requested processes is producing audio.
    NoSuchProcess,
    /// The device failed or disappeared.
    Device(String),
}

impl fmt::Display for CaptureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CaptureError::PermissionDenied => f.write_str("Audio access was not allowed."),
            CaptureError::Unsupported(what) => {
                write!(f, "{what} isn't available on this computer.")
            }
            CaptureError::NoSuchProcess => f.write_str("That app isn't playing audio right now."),
            CaptureError::Device(message) => write!(f, "The audio device stopped: {message}"),
        }
    }
}

impl std::error::Error for CaptureError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_report_duration_bytes_and_power() {
        let chunk = PcmChunk {
            channel: Channel::Mic,
            start_frame: 160,
            samples: vec![16384; 1600],
        };
        assert_eq!(chunk.duration_ms(), 100);
        assert_eq!(chunk.end_frame(), 1760);
        assert_eq!(&chunk.to_le_bytes()[..2], &16384i16.to_le_bytes());
        assert!((chunk.power() - 0.5).abs() < 1e-3);
    }

    #[test]
    fn mic_is_its_own_channel() {
        assert_eq!(AudioSource::Mic.channel(), Channel::Mic);
        assert_eq!(
            AudioSource::System { exclude_self: true }.channel(),
            Channel::System
        );
        assert_eq!(AudioSource::Processes(vec![7]).channel(), Channel::System);
    }
}
