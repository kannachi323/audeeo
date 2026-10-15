use crate::{CaptureError, CaptureSource, CaptureSources};
use std::collections::BTreeMap;
use wasapi::{DeviceEnumerator, Direction, SessionState};

/// Read-only metadata: the default microphone's name and the apps with an
/// active audio session on the default output.
pub(crate) fn capture_sources() -> Result<CaptureSources, CaptureError> {
    wasapi::initialize_mta()
        .ok()
        .map_err(|e| CaptureError::Device(e.to_string()))?;
    let result = (|| {
        let enumerator =
            DeviceEnumerator::new().map_err(|e| CaptureError::Device(e.to_string()))?;
        let microphone = enumerator
            .get_default_device(&Direction::Capture)
            .and_then(|device| device.get_friendlyname())
            .unwrap_or_else(|_| "Microphone".into());
        let render = enumerator
            .get_default_device(&Direction::Render)
            .map_err(|e| CaptureError::Device(e.to_string()))?;
        let sessions = render
            .get_iaudiosessionmanager()
            .and_then(|manager| manager.get_audiosessionenumerator())
            .map_err(|e| CaptureError::Device(e.to_string()))?;
        let mut apps: BTreeMap<String, Vec<u32>> = BTreeMap::new();
        for index in 0..sessions
            .get_count()
            .map_err(|e| CaptureError::Device(e.to_string()))?
        {
            let Ok(session) = sessions.get_session(index) else {
                continue;
            };
            if session.get_state().ok() != Some(SessionState::Active) {
                continue;
            }
            let Ok(pid) = session.get_process_id() else {
                continue;
            };
            if pid == 0 || pid == std::process::id() {
                continue;
            }
            let display = session.get_display_name().unwrap_or_default();
            let identifier = session.get_session_identifier().unwrap_or_default();
            let pids = apps
                .entry(application_name(&display, &identifier, pid))
                .or_default();
            if !pids.contains(&pid) {
                pids.push(pid);
            }
        }
        Ok(CaptureSources {
            microphone,
            applications: apps
                .into_iter()
                .map(|(name, pids)| CaptureSource { name, pids })
                .collect(),
        })
    })();
    wasapi::deinitialize();
    result
}

pub(crate) fn application_name(display: &str, identifier: &str, pid: u32) -> String {
    if !display.trim().is_empty() {
        return display.trim().to_owned();
    }
    let path = identifier.split("%b").next().unwrap_or(identifier);
    let file = path.rsplit(['\\', '/']).next().unwrap_or("").trim();
    if !file.is_empty() {
        return file.strip_suffix(".exe").unwrap_or(file).to_owned();
    }
    format!("Application {pid}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_readable_application_names_from_audio_sessions() {
        assert_eq!(
            application_name("", r"C:\Program Files\Video\player.exe%b{session}", 42),
            "player"
        );
        assert_eq!(application_name("Browser", "ignored", 42), "Browser");
        assert_eq!(application_name("", "", 42), "Application 42");
    }
}
