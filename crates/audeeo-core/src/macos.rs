//! Core Audio and AVAudioEngine capture through the Swift package in
//! `apple/`. Swift owns the devices; Rust owns the callbacks.

use crate::capture::{FailureSink, FrameCounter, Sink};
use crate::{AudioSource, Capabilities, CaptureError, CaptureSource, CaptureSources, Channel};
use serde::Deserialize;
use std::ffi::{c_char, c_void, CStr};
use std::sync::Mutex;

type PcmCallback = extern "C" fn(*mut c_void, *const i16, usize, i32);

extern "C" {
    fn audeeo_core_mic_start(
        context: *mut c_void,
        callback: PcmCallback,
        status: *mut i32,
    ) -> *mut c_void;
    fn audeeo_core_system_start(
        pids: *const i32,
        count: usize,
        exclude_self: bool,
        context: *mut c_void,
        callback: PcmCallback,
        status: *mut i32,
    ) -> *mut c_void;
    fn audeeo_core_capture_stop(handle: *mut c_void);
    fn audeeo_core_capture_sources() -> *mut c_char;
    fn audeeo_core_string_free(value: *mut c_char);
    fn audeeo_core_system_supported() -> bool;
}

struct Context {
    channel: Channel,
    frames: Mutex<FrameCounter>,
    sink: Sink,
    failure: FailureSink,
}

extern "C" fn deliver(context: *mut c_void, samples: *const i16, count: usize, status: i32) {
    // SAFETY: `context` is the Box leaked in `start` and outlives every call,
    // because Swift stops delivery synchronously before `Running::stop` frees it.
    let context = unsafe { &*(context as *const Context) };
    if status != 0 {
        (context.failure)(CaptureError::Device("the audio device changed".into()));
        return;
    }
    if samples.is_null() || count == 0 {
        return;
    }
    // SAFETY: Swift passes `count` valid samples for the duration of the call.
    let samples = unsafe { std::slice::from_raw_parts(samples, count) }.to_vec();
    let chunk = context
        .frames
        .lock()
        .unwrap()
        .chunk(context.channel, samples);
    (context.sink)(chunk);
}

pub(crate) struct Running {
    handle: *mut c_void,
    context: *mut Context,
}

// SAFETY: the handle is an opaque retained Swift object whose stop is
// thread-safe; the context is only freed after stop.
unsafe impl Send for Running {}

impl Running {
    pub fn stop(self) {
        // SAFETY: both pointers came from `start` and are released exactly once.
        unsafe {
            audeeo_core_capture_stop(self.handle);
            drop(Box::from_raw(self.context));
        }
    }
}

pub(crate) fn start(
    source: AudioSource,
    sink: Sink,
    failure: FailureSink,
) -> Result<Running, CaptureError> {
    let channel = source.channel();
    let context = Box::into_raw(Box::new(Context {
        channel,
        frames: Mutex::new(FrameCounter::new()),
        sink,
        failure,
    }));
    let mut status = 0i32;
    // SAFETY: `context` stays valid until `Running::stop`, or is freed below on failure.
    let handle = unsafe {
        match &source {
            AudioSource::Mic => audeeo_core_mic_start(context.cast(), deliver, &mut status),
            AudioSource::System { exclude_self } => audeeo_core_system_start(
                std::ptr::null(),
                0,
                *exclude_self,
                context.cast(),
                deliver,
                &mut status,
            ),
            AudioSource::Processes(pids) => {
                let pids: Vec<i32> = pids.iter().map(|pid| *pid as i32).collect();
                audeeo_core_system_start(
                    pids.as_ptr(),
                    pids.len(),
                    false,
                    context.cast(),
                    deliver,
                    &mut status,
                )
            }
        }
    };
    if handle.is_null() {
        // SAFETY: Swift did not keep the context when it returned no handle.
        drop(unsafe { Box::from_raw(context) });
        return Err(match status {
            1 => CaptureError::PermissionDenied,
            3 => CaptureError::Unsupported("System audio capture (macOS 14.2 or later)"),
            4 => CaptureError::NoSuchProcess,
            _ => CaptureError::Device("the audio device could not start".into()),
        });
    }
    Ok(Running { handle, context })
}

pub(crate) fn capabilities() -> Capabilities {
    // SAFETY: a pure query.
    let system = unsafe { audeeo_core_system_supported() };
    Capabilities {
        mic: true,
        system_audio: system,
        process_audio: system,
        exclude_self: system,
    }
}

#[derive(Deserialize)]
struct RawSources {
    microphone: String,
    applications: Vec<RawSource>,
}

#[derive(Deserialize)]
struct RawSource {
    name: String,
    pids: Vec<u32>,
}

pub(crate) fn capture_sources() -> Result<CaptureSources, CaptureError> {
    // SAFETY: Swift returns a strdup'd C string or null; we free it with its allocator.
    let json = unsafe {
        let raw = audeeo_core_capture_sources();
        if raw.is_null() {
            return Err(CaptureError::Device("audio sources are unavailable".into()));
        }
        let text = CStr::from_ptr(raw).to_string_lossy().into_owned();
        audeeo_core_string_free(raw);
        text
    };
    let raw: RawSources =
        serde_json::from_str(&json).map_err(|e| CaptureError::Device(e.to_string()))?;
    Ok(CaptureSources {
        microphone: raw.microphone,
        applications: raw
            .applications
            .into_iter()
            .map(|a| CaptureSource {
                name: a.name,
                pids: a.pids,
            })
            .collect(),
    })
}
