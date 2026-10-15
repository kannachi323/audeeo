use crate::capture::{FailureSink, Sink};
use crate::{AudioSource, Capabilities, CaptureError, CaptureSources};

pub(crate) struct Running;

impl Running {
    pub fn stop(self) {}
}

pub(crate) fn start(_: AudioSource, _: Sink, _: FailureSink) -> Result<Running, CaptureError> {
    Err(CaptureError::Unsupported("Audio capture"))
}

pub(crate) fn capture_sources() -> Result<CaptureSources, CaptureError> {
    Err(CaptureError::Unsupported("Audio capture"))
}

pub(crate) fn capabilities() -> Capabilities {
    Capabilities::default()
}
