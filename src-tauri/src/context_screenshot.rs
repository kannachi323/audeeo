// User-triggered, noninteractive capture of the complete primary display.
// The caller hides Audeeo first and restores it on both success and failure.
#[cfg(target_os = "macos")]
pub fn capture() -> Result<String, String> {
    use base64::Engine;
    use std::{fs, os::unix::fs::DirBuilderExt, time::{SystemTime, UNIX_EPOCH}};
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let directory = std::env::temp_dir().join(format!("audeeo-screen-{}-{stamp}", std::process::id()));
    fs::DirBuilder::new().mode(0o700).create(&directory).map_err(|_| "Could not prepare screen capture.")?;
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }
    let _cleanup = Cleanup(directory.clone());
    let path = directory.join("screen.jpg");
    let output = std::process::Command::new("/usr/sbin/screencapture")
        .args(["-x", "-m", "-t", "jpg"]).arg(&path).output()
        .map_err(|_| "Could not start screen capture.")?;
    if !output.status.success() {
        return Err("Could not capture the screen. Allow Audeeo in System Settings → Privacy & Security → Screen & System Audio Recording, then retry.".into());
    }
    let size = fs::metadata(&path).map_err(|_| "Screen capture produced no image.")?.len();
    if size == 0 || size > 32 * 1024 * 1024 { return Err("Screenshot is too large. Try a smaller display resolution.".into()); }
    let bytes = fs::read(path).map_err(|_| "Could not read the screenshot.")?;
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[cfg(target_os = "windows")]
pub fn capture() -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    // Fixed script, no user input or shell interpolation. Use the inbox Windows
    // PowerShell path rather than resolving an executable through PATH.
    let root = std::env::var_os("SystemRoot").ok_or("Windows system directory is unavailable.")?;
    let executable = std::path::PathBuf::from(root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let script = r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class AudeeoDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
[void][AudeeoDpi]::SetProcessDPIAware()
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$stream = New-Object System.IO.MemoryStream
try {
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  if ($stream.Length -gt 33554432) { throw 'Screenshot too large' }
  [Console]::Out.Write([Convert]::ToBase64String($stream.ToArray()))
} finally { $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose() }
"#;
    let output = std::process::Command::new(executable)
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000).output().map_err(|_| "Could not start screen capture.")?;
    if !output.status.success() { return Err("Could not capture the main display. Check screen capture access and retry.".into()); }
    let encoded = String::from_utf8(output.stdout).map_err(|_| "Could not read the screenshot.")?;
    if encoded.is_empty() || encoded.len() > 45 * 1024 * 1024 { return Err("Screenshot is empty or too large.".into()); }
    Ok(format!("data:image/jpeg;base64,{}", encoded.trim()))
}
