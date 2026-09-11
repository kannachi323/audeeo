mod credentials;
#[cfg(target_os = "macos")]
mod file_credentials;
use serde::Serialize;
use tauri::Emitter;
use tauri::Manager;

#[derive(Default)]
struct OAuthCallbacks(std::sync::Mutex<Vec<String>>);

fn queue_oauth_callback(app: &tauri::AppHandle, url: String) {
    if let Ok(mut pending) = app.state::<OAuthCallbacks>().0.lock() {
        // Bound queued callbacks while the WebView is starting.
        if pending.len() < 8 {
            pending.push(url);
        }
    }
    let _ = app.emit("oauth-callback", ());
}

#[tauri::command]
fn take_oauth_callbacks(state: tauri::State<OAuthCallbacks>) -> Result<Vec<String>, String> {
    let mut pending = state.0.lock().map_err(|_| "Sign-in callback unavailable")?;
    Ok(std::mem::take(&mut *pending))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformCapabilities {
    platform: &'static str,
    microphone: bool,
    local_video: bool,
    system_audio: bool,
    global_overlay: bool,
    native_pip: bool,
    native_session: bool,
}

#[tauri::command]
fn platform_capabilities() -> PlatformCapabilities {
    PlatformCapabilities {
        platform: std::env::consts::OS,
        microphone: cfg!(any(target_os = "macos", target_os = "ios")),
        local_video: false,
        system_audio: cfg!(target_os = "macos"),
        global_overlay: cfg!(target_os = "macos"),
        native_pip: cfg!(target_os = "ios"),
        native_session: cfg!(target_os = "ios"),
    }
}
#[cfg(target_os = "macos")]
extern "C" {
    fn audeeo_system_start(callback: extern "C" fn(*const u8, usize, i32));
    fn audeeo_system_stop();
    fn audeeo_capture_sources() -> *mut std::ffi::c_char;
    fn audeeo_source_volume(volume: f64);
    fn audeeo_window_mode(window: *mut std::ffi::c_void, overlay: bool, clear: bool);
    fn audeeo_show_controls_popover(main: *mut std::ffi::c_void, host: *mut std::ffi::c_void, x: f64, y: f64, width: f64, height: f64, content_height: f64, presentation: i64, closed: extern "C" fn(i64));
    fn audeeo_close_controls_popover();
    fn audeeo_resize_window(window: *mut std::ffi::c_void, height: f64);
    fn audeeo_nudge_window(window: *mut std::ffi::c_void, dx: f64, dy: f64);
    fn audeeo_microphone_start(callback: extern "C" fn(*const u8, usize, i32));
    fn audeeo_microphone_stop();
}
#[tauri::command]
async fn capture_sources() -> Result<serde_json::Value, String> {
    // CoreAudio metadata queries can block; never run them in the UI IPC handler.
    tauri::async_runtime::spawn_blocking(read_capture_sources)
        .await
        .map_err(|error| error.to_string())?
}

fn read_capture_sources() -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let pointer = unsafe { audeeo_capture_sources() };
        if pointer.is_null() { return Err("Capture source metadata is unavailable".into()); }
        let json = unsafe { std::ffi::CStr::from_ptr(pointer) }.to_string_lossy().into_owned();
        unsafe { audeeo_secret_free(pointer); }
        return serde_json::from_str(&json).map_err(|error| error.to_string());
    }
    #[cfg(not(target_os = "macos"))]
    Ok(serde_json::json!({"microphone":"Microphone", "applications":[]}))
}
#[cfg(any(target_os = "macos", target_os = "ios"))]
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();
#[cfg(target_os = "macos")]
extern "C" fn microphone_data(bytes: *const u8, len: usize, error: i32) {
    if let Some(app) = APP.get() {
        if error != 0 {
            let _ = app.emit("capture-error", "Microphone unavailable. Allow access in System Settings and check the input device.");
        } else if !bytes.is_null() && len > 0 {
            use base64::Engine;
            let data = unsafe { std::slice::from_raw_parts(bytes, len) };
            let _ = app.emit(
                "microphone-chunk",
                SystemAudioChunk {
                    data: base64::engine::general_purpose::STANDARD.encode(data),
                    level: 0,
                },
            );
        } else {
            let _ = app.emit("microphone-ready", ());
        }
    }
}
#[cfg(any(target_os = "macos", target_os = "ios"))]
extern "C" {
    fn audeeo_begin_oauth(
        url: *const std::ffi::c_char,
        callback: extern "C" fn(*const std::ffi::c_char),
    );
}
#[cfg(any(target_os = "macos", target_os = "ios"))]
extern "C" fn oauth_callback(url: *const std::ffi::c_char) {
    if !url.is_null() {
        if let Some(app) = APP.get() {
            let text = unsafe { std::ffi::CStr::from_ptr(url) }.to_string_lossy();
            queue_oauth_callback(app, text.into_owned());
        }
    }
}
#[cfg(any(target_os = "macos", target_os = "ios"))]
extern "C" {
    #[cfg(target_os = "ios")]
    fn audeeo_secret_get(key: *const std::ffi::c_char, status: *mut i32) -> *mut std::ffi::c_char;
    #[cfg(target_os = "ios")]
    fn audeeo_secret_set(key: *const std::ffi::c_char, value: *const std::ffi::c_char) -> i32;
    fn audeeo_secret_free(pointer: *mut std::ffi::c_char);
    fn audeeo_purchase_action(
        action: *const std::ffi::c_char,
        owner: *const std::ffi::c_char,
        key: *const std::ffi::c_char,
        callback: extern "C" fn(*const std::ffi::c_char),
    );
}
#[cfg(any(target_os = "macos", target_os = "ios"))]
extern "C" {
    fn audeeo_history_delete(owner: *const std::ffi::c_char) -> i32;
    fn audeeo_history_get(owner: *const std::ffi::c_char) -> *mut std::ffi::c_char;
    fn audeeo_history_ack(owner: *const std::ffi::c_char, raw: *const std::ffi::c_char) -> i32;
}
#[tauri::command]
fn native_history_delete(owner: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let owner = std::ffi::CString::new(owner).map_err(|e| e.to_string())?;
        if unsafe { audeeo_history_delete(owner.as_ptr()) } != 0 {
            return Err("Local history deletion failed. Retry.".into());
        }
    }
    Ok(())
}
#[tauri::command]
fn native_history_get(owner: String) -> Result<String, String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let owner = std::ffi::CString::new(owner).map_err(|e| e.to_string())?;
        let pointer = unsafe { audeeo_history_get(owner.as_ptr()) };
        if pointer.is_null() {
            return Err("Native history is unavailable".into());
        }
        let value = unsafe { std::ffi::CStr::from_ptr(pointer) }
            .to_string_lossy()
            .into_owned();
        unsafe {
            audeeo_secret_free(pointer);
        }
        return Ok(value);
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = owner;
        Ok("[]".into())
    }
}
#[tauri::command]
fn native_history_ack(owner: String, snapshots: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let owner = std::ffi::CString::new(owner).map_err(|e| e.to_string())?;
        let snapshots = std::ffi::CString::new(snapshots).map_err(|e| e.to_string())?;
        if unsafe { audeeo_history_ack(owner.as_ptr(), snapshots.as_ptr()) } != 0 {
            return Err("Native history acknowledgement failed".into());
        }
    }
    Ok(())
}
#[tauri::command]
async fn auth_storage_get(key: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        credential_cache().lock().map_err(|_| "Credential storage unavailable".to_owned())?
            .get(&key, || read_credential(&key))
    }).await.map_err(|_| "Credential worker unavailable".to_owned())?
}
#[tauri::command]
async fn auth_storage_retry() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        credential_cache().lock().map_err(|_| "Credential storage unavailable".to_owned())?.retry_errors();
        Ok(())
    }).await.map_err(|_| "Credential worker unavailable".to_owned())?
}
fn credential_cache() -> &'static std::sync::Mutex<credentials::CredentialCache> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<credentials::CredentialCache>> = std::sync::OnceLock::new();
    CACHE.get_or_init(Default::default)
}
#[cfg(target_os = "ios")]
fn credential_error(status: i32) -> String {
    format!("Keychain access unavailable ({status}). Unlock your login keychain or review Audeeo’s access in Keychain Access, then choose Retry Keychain. No permission dialog was opened.")
}
fn read_credential(key: &str) -> Result<Option<String>, String> {
    #[cfg(target_os = "macos")]
    { return file_credentials::get(key); }
    #[cfg(target_os = "ios")]
    {
        let key = std::ffi::CString::new(key).map_err(|e| e.to_string())?;
        let mut status = 0;
        let pointer = unsafe { audeeo_secret_get(key.as_ptr(), &mut status) };
        if status == -25300 { return Ok(None); } // errSecItemNotFound only.
        if status != 0 { return Err(credential_error(status)); }
        if pointer.is_null() { return Err("Keychain returned an invalid credential".into()); }
        let value = unsafe { std::ffi::CStr::from_ptr(pointer) }
            .to_string_lossy()
            .into_owned();
        unsafe {
            audeeo_secret_free(pointer);
        }
        return Ok(Some(value));
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = key;
        Err("Secure storage unavailable".into())
    }
}
#[tauri::command]
async fn auth_storage_set(key: String, value: Option<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        credential_cache().lock().map_err(|_| "Credential storage unavailable".to_owned())?
            .set(&key, value.clone(), || write_credential(&key, value))
    }).await.map_err(|_| "Credential worker unavailable".to_owned())?
}
fn write_credential(key: &str, value: Option<String>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    { return file_credentials::set(key, value); }
    #[cfg(target_os = "ios")]
    {
        let key = std::ffi::CString::new(key).map_err(|e| e.to_string())?;
        let value = value
            .map(std::ffi::CString::new)
            .transpose()
            .map_err(|e| e.to_string())?;
        let status = unsafe {
            audeeo_secret_set(
                key.as_ptr(),
                value.as_ref().map_or(std::ptr::null(), |v| v.as_ptr()),
            )
        };
        if status != 0 {
            return Err(credential_error(status));
        }
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = (key, value);
        Err("Secure storage unavailable".into())
    }
}
#[cfg(any(target_os = "macos", target_os = "ios"))]
extern "C" fn purchase_callback(event: *const std::ffi::c_char) {
    if !event.is_null() {
        if let Some(app) = APP.get() {
            let text = unsafe { std::ffi::CStr::from_ptr(event) }.to_string_lossy();
            let _ = app.emit("purchase-result", text.as_ref());
        }
    }
}
#[tauri::command]
fn purchase_action(action: String, owner: String, key: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let values: Result<Vec<_>, _> = [action, owner, key]
            .into_iter()
            .map(std::ffi::CString::new)
            .collect();
        let v = values.map_err(|e| e.to_string())?;
        unsafe {
            audeeo_purchase_action(
                v[0].as_ptr(),
                v[1].as_ptr(),
                v[2].as_ptr(),
                purchase_callback,
            );
        }
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        let _ = (action, owner, key);
        Err("Native purchases unavailable".into())
    }
}
#[tauri::command]
fn begin_oauth(url: String) -> Result<(), String> {
    let parsed = tauri::Url::parse(&url).map_err(|_| "Invalid sign-in URL")?;
    if parsed.scheme() != "https"
        || parsed.host_str() != Some("etbpmzwqqihnydlmibvd.supabase.co")
        || parsed.path() != "/auth/v1/authorize"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
    {
        return Err("Invalid sign-in URL".into());
    }
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        let url = std::ffi::CString::new(url).map_err(|e| e.to_string())?;
        unsafe {
            audeeo_begin_oauth(url.as_ptr(), oauth_callback);
        }
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    {
        Err("Native sign-in is unavailable on this platform.".into())
    }
}
#[cfg(target_os = "ios")]
extern "C" {
    fn audeeo_native_session_start(
        endpoint: *const std::ffi::c_char,
        token: *const std::ffi::c_char,
        source: *const std::ffi::c_char,
        target: *const std::ffi::c_char,
        owner: *const std::ffi::c_char,
        save: bool,
        silence_timeout: i32,
        silence_threshold: i32,
        callback: extern "C" fn(*const std::ffi::c_char),
    );
    fn audeeo_native_session_stop();
    fn audeeo_pip_start();
    fn audeeo_pip_stop();
    fn audeeo_pip_caption_size(size: f64);
}
#[cfg(target_os = "ios")]
extern "C" fn native_event(event: *const std::ffi::c_char) {
    if !event.is_null() {
        if let Some(app) = APP.get() {
            let text = unsafe { std::ffi::CStr::from_ptr(event) }.to_string_lossy();
            let _ = app.emit("native-session-event", text.as_ref());
        }
    }
}
#[tauri::command]
fn start_native_session(
    endpoint: String,
    token: String,
    source: String,
    target: String,
    owner: String,
    save: bool,
    silence_timeout: i32,
    silence_threshold: i32,
) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        let values: Result<Vec<_>, _> = [endpoint, token, source, target, owner]
            .into_iter()
            .map(std::ffi::CString::new)
            .collect();
        let v = values.map_err(|e| e.to_string())?;
        unsafe {
            audeeo_native_session_start(
                v[0].as_ptr(),
                v[1].as_ptr(),
                v[2].as_ptr(),
                v[3].as_ptr(),
                v[4].as_ptr(),
                save,
                silence_timeout,
                silence_threshold,
                native_event,
            );
        }
        return Ok(());
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (endpoint, token, source, target, owner, save, silence_timeout, silence_threshold);
        Err("Native mobile sessions are unavailable.".into())
    }
}
#[tauri::command]
fn stop_native_session() {
    #[cfg(target_os = "ios")]
    unsafe {
        audeeo_native_session_stop();
    }
}
#[tauri::command]
fn start_native_pip() -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        unsafe {
            audeeo_pip_start();
        }
        return Ok(());
    }
    #[cfg(not(target_os = "ios"))]
    {
        Err("Picture in Picture requires iOS.".into())
    }
}
#[tauri::command]
fn stop_native_pip() {
    #[cfg(target_os = "ios")]
    unsafe {
        audeeo_pip_stop();
    }
}
#[tauri::command]
fn start_microphone_capture() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        unsafe {
            audeeo_microphone_start(microphone_data);
        }
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Native microphone bridge is not integrated on this platform yet.".into())
    }
}
#[tauri::command]
fn stop_microphone_capture() {
    #[cfg(target_os = "macos")]
    unsafe {
        audeeo_microphone_stop();
    }
}

#[cfg(target_os = "macos")]
extern "C" fn system_audio_data(bytes: *const u8, len: usize, error: i32) {
    if let Some(app) = APP.get() {
        if error != 0 {
            let message = if error == 3 { "Independent source audio requires macOS 14.2 or later." }
                else if error == 1 { "Source audio could not start. Allow Audeeo in Privacy & Security → Screen & System Audio Recording, then retry." }
                else { "Audio route changed or buffering failed. Source playback was restored; restart captions." };
            let _ = app.emit("capture-error", message);
        } else if bytes.is_null() {
            let _ = app.emit("system-ready", ());
        } else {
            use base64::Engine;
            let data = unsafe { std::slice::from_raw_parts(bytes, len) };
            let _ = app.emit("system-audio-chunk", serde_json::json!({"data": base64::engine::general_purpose::STANDARD.encode(data), "sampleRate": 24000}));
        }
    }
}
#[cfg(any(target_os = "macos", target_os = "ios"))]
extern "C" { fn audeeo_playback_command(json: *const std::ffi::c_char, callback: extern "C" fn(i32)); }
#[cfg(any(target_os = "macos", target_os = "ios"))]
extern "C" fn playback_state(state: i32) {
    if let Some(app) = APP.get() { let _ = app.emit("playback-state", state); }
}
#[tauri::command]
fn audio_output(command: serde_json::Value) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        #[cfg(target_os = "macos")]
        if let Some(volume) = command.get("sourceVolume").and_then(|v| v.as_f64()) {
            if !volume.is_finite() || !(0.0..=1.0).contains(&volume) { return Err("Invalid volume".into()); }
            unsafe { audeeo_source_volume(volume); }
        }
        let json = std::ffi::CString::new(command.to_string()).map_err(|e| e.to_string())?;
        unsafe { audeeo_playback_command(json.as_ptr(), playback_state); }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios")))]
    { let _ = command; Err("Native playback unavailable".into()) }
}
#[cfg(target_os = "macos")]
extern "C" fn controls_popover_closed(presentation: i64) {
    if let Some(app) = APP.get() { let _ = app.emit("controls-popover-closed", presentation); }
}
#[tauri::command]
fn show_controls_popover(app: tauri::AppHandle, window: tauri::Window, x: f64, y: f64, width: f64, height: f64, content_height: f64, presentation: i64) -> Result<(), String> {
    if window.label() != "main" || ![x,y,width,height,content_height].iter().all(|v| v.is_finite()) || !(80.0..=600.0).contains(&content_height) { return Err("Invalid controls anchor".into()); }
    #[cfg(target_os = "macos")]
    {
        let host = app.get_webview_window("controls-popup").ok_or("Controls are not ready")?;
        let main = window.ns_window().map_err(|e| e.to_string())? as usize;
        let raw = host.ns_window().map_err(|e| e.to_string())? as usize;
        window.run_on_main_thread(move || unsafe { audeeo_show_controls_popover(main as *mut _, raw as *mut _, x,y,width,height,content_height,presentation,controls_popover_closed); }).map_err(|e| e.to_string())?;
    }
    Ok(())
}
#[tauri::command]
fn close_controls_popover(window: tauri::Window) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    window.run_on_main_thread(|| unsafe { audeeo_close_controls_popover(); }).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_window_mode(window: tauri::Window, overlay: bool, clear: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let raw = window.ns_window().map_err(|e| e.to_string())? as usize;
        window.run_on_main_thread(move || unsafe { audeeo_window_mode(raw as *mut std::ffi::c_void, overlay, clear); }).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, overlay, clear);
    Ok(())
}

#[tauri::command]
fn update_overlay(
    source: String,
    translation: String,
    size: f64,
    opaque: bool,
    recording: bool,
    preferences: Option<serde_json::Value>,
) -> Result<(), String> {
    let _ = (&source, &translation, size, opaque, recording, &preferences);
    #[cfg(target_os = "ios")]
    unsafe {
        audeeo_pip_caption_size(size);
    }
    Ok(())
}

#[derive(Default)]
pub struct AudioCaptureState;

#[cfg(target_os = "macos")]
#[derive(Clone, Serialize)]
struct SystemAudioChunk {
    data: String,
    level: u8,
}

#[tauri::command]
async fn start_system_audio_capture(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioCaptureState>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = (app, state);
        unsafe { audeeo_system_start(system_audio_data); }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, state);
        Err("Native system audio capture is currently supported on macOS.".to_string())
    }
}

#[tauri::command]
async fn stop_system_audio_capture(
    state: tauri::State<'_, AudioCaptureState>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let _ = state;
        unsafe { audeeo_system_stop(); }
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = state;
        Ok(())
    }
}

#[tauri::command]
async fn request_screen_capture_permission() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        screencapturekit::shareable_content::SCShareableContent::get().map_err(|e| {
            format!("Allow Screen & System Audio Recording in System Settings: {e}")
        })?;
        return Ok("Screen capture permission granted.".into());
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Playback capture is unavailable on this platform.".into())
    }
}

#[tauri::command]
fn nudge_main_window(window: tauri::Window, dx: f64, dy: f64) -> Result<(), String> {
    if !dx.is_finite() || !dy.is_finite() || dx.abs() > 40.0 || dy.abs() > 40.0 {
        return Err("Unsupported movement".into());
    }
    #[cfg(target_os = "macos")]
    {
        let raw = window.ns_window().map_err(|e| e.to_string())? as usize;
        window
            .run_on_main_thread(move || unsafe {
                audeeo_nudge_window(raw as *mut std::ffi::c_void, dx, dy);
            })
            .map_err(|e| e.to_string())?;
    }
    let _ = (window, dx, dy);
    Ok(())
}

// AppKit preserves the top edge and clamps the expanded frame to the visible screen.
#[tauri::command]
fn resize_main_window(window: tauri::Window, height: f64) -> Result<(), String> {
    if !height.is_finite() || !(224.0..=640.0).contains(&height) {
        return Err("Unsupported window height".into());
    }
    #[cfg(target_os = "macos")]
    {
        let raw = window.ns_window().map_err(|e| e.to_string())? as usize;
        window
            .run_on_main_thread(move || unsafe {
                audeeo_resize_window(raw as *mut std::ffi::c_void, height);
            })
            .map_err(|e| e.to_string())?;
    }
    let _ = (window, height);
    Ok(())
}

#[tauri::command]
fn minimize_window(window: tauri::Window) -> Result<(), String> {
    #[cfg(desktop)]
    {
        window.minimize().map_err(|error| error.to_string())?;
    }
    let _ = window;
    Ok(())
}

#[tauri::command]
fn close_window(window: tauri::Window) -> Result<(), String> {
    #[cfg(desktop)]
    {
        window.close().map_err(|error| error.to_string())?;
    }
    let _ = window;
    Ok(())
}

#[tauri::command]
fn set_always_on_top(window: tauri::Window, always_on_top: bool) -> Result<(), String> {
    #[cfg(desktop)]
    {
        window
            .set_always_on_top(always_on_top)
            .map_err(|error| error.to_string())?;
    }
    let _ = window;
    let _ = always_on_top;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OAuthCallbacks::default())
        .manage(AudioCaptureState::default())
        .setup(|_app| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            let _ = APP.set(_app.handle().clone());
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                if let Some(main_win) = _app.get_webview_window("main") {
                    let _ = main_win.center();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform_capabilities,
            capture_sources,
            begin_oauth,
            take_oauth_callbacks,
            native_history_delete,
            native_history_get,
            native_history_ack,
            auth_storage_get,
            auth_storage_set,
            auth_storage_retry,
            purchase_action,
            start_native_session,
            stop_native_session,
            start_native_pip,
            stop_native_pip,
            start_microphone_capture,
            stop_microphone_capture,
            update_overlay,
            audio_output,
            set_window_mode,
            show_controls_popover,
            close_controls_popover,
            request_screen_capture_permission,
            start_system_audio_capture,
            stop_system_audio_capture,
            nudge_main_window,
            resize_main_window,
            minimize_window,
            close_window,
            set_always_on_top
        ])
        .build(tauri::generate_context!())
        .expect("error while building Audeeo")
        .run(|_app, _event| {
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { ref urls } = _event {
                for url in urls {
                    if url.scheme() == "audeeo"
                        && url.host_str() == Some("auth")
                        && url.path() == "/callback"
                    {
                        queue_oauth_callback(_app, url.to_string());
                        if let Some(window) = _app.get_webview_window("main") {
                            let _ = window.show();
                            #[cfg(target_os = "macos")]
                            let _ = window.set_focus();
                        }
                    }
                }
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                // Dock activation restores the window, preserving its page and session.
                if let Some(window) = _app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
