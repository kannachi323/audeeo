use crate::{AudioSource, Capabilities, CaptureError, CaptureSources, PcmChunk};
use std::sync::Arc;

#[cfg(target_os = "macos")]
use crate::macos as platform;
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use crate::unsupported as platform;
#[cfg(target_os = "windows")]
use crate::windows as platform;

pub(crate) type Sink = Arc<dyn Fn(PcmChunk) + Send + Sync + 'static>;
pub(crate) type FailureSink = Arc<dyn Fn(CaptureError) + Send + Sync + 'static>;

/// A running capture. Audio stops when this is stopped or dropped; nothing in
/// this crate keeps a device open on its own.
pub struct Capture {
    inner: Option<platform::Running>,
}

impl Capture {
    pub fn stop(mut self) {
        if let Some(inner) = self.inner.take() {
            inner.stop();
        }
    }
}

impl Drop for Capture {
    fn drop(&mut self) {
        if let Some(inner) = self.inner.take() {
            inner.stop();
        }
    }
}

/// Opens `source` and calls `on_chunk` with 16 kHz mono PCM16 until the
/// returned [`Capture`] is stopped. `on_failure` runs at most once if the
/// device disappears mid-capture; the capture is already stopped by then.
///
/// On macOS, call this off the main thread: it waits for the microphone
/// permission prompt.
pub fn start(
    source: AudioSource,
    on_chunk: impl Fn(PcmChunk) + Send + Sync + 'static,
    on_failure: impl Fn(CaptureError) + Send + Sync + 'static,
) -> Result<Capture, CaptureError> {
    if let AudioSource::Processes(pids) = &source {
        if pids.is_empty() {
            return Err(CaptureError::NoSuchProcess);
        }
    }
    let running = platform::start(source, Arc::new(on_chunk), Arc::new(on_failure))?;
    Ok(Capture {
        inner: Some(running),
    })
}

/// The default microphone's name and the apps currently playing audio.
pub fn capture_sources() -> Result<CaptureSources, CaptureError> {
    platform::capture_sources()
}

pub fn capabilities() -> Capabilities {
    platform::capabilities()
}

/// Numbers samples per capture so chunks carry continuous frame indices.
#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
pub(crate) struct FrameCounter(u64);

#[cfg_attr(not(any(target_os = "macos", target_os = "windows")), allow(dead_code))]
impl FrameCounter {
    pub fn new() -> Self {
        Self(0)
    }

    pub fn chunk(&mut self, channel: crate::Channel, samples: Vec<i16>) -> PcmChunk {
        let start_frame = self.0;
        self.0 += samples.len() as u64;
        PcmChunk {
            channel,
            start_frame,
            samples,
        }
    }
}
