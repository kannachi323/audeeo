import { invoke } from '@tauri-apps/api/core'
/** Native AVKit owns subtitle rendering; no canvas/video or WebView background loop. */
export async function startNativePip(){await invoke('start_native_pip')}
export async function stopNativePip(){await invoke('stop_native_pip')}
