use serde::{Deserialize, Serialize};
use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, Manager, Runtime};

const PLUGIN_IDENTIFIER: &str = "com.mattdev727.audeeo";

pub struct AndroidMobile<R: Runtime>(PluginHandle<R>);

#[derive(Deserialize)]
struct SecretResult {
    value: Option<String>,
}

impl<R: Runtime> AndroidMobile<R> {
    pub fn start_session(&self, payload: impl Serialize) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("startSession", payload)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn stop_session(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("stopSession", ())
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn show_presenter(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("showPresenter", ())
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn hide_presenter(&self) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("hidePresenter", ())
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn update_presenter(&self, payload: impl Serialize) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("updatePresenter", payload)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn playback(&self, payload: impl Serialize) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("playback", payload)
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn begin_oauth(&self, url: String) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("beginOAuth", serde_json::json!({ "url": url }))
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn capture_sources(&self) -> Result<serde_json::Value, String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("listApplications", ())
            .map_err(|error| error.to_string())
    }

    pub fn secret_get(&self, key: String) -> Result<Option<String>, String> {
        self.0
            .run_mobile_plugin::<SecretResult>("secretGet", serde_json::json!({ "key": key }))
            .map(|result| result.value)
            .map_err(|error| error.to_string())
    }

    pub fn secret_set(&self, key: String, value: Option<String>) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<serde_json::Value>("secretSet", serde_json::json!({ "key": key, "value": value }))
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("mobile-live")
        .setup(|app, api| {
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "MobileLivePlugin")?;
            app.manage(AndroidMobile(handle));
            Ok(())
        })
        .build()
}
