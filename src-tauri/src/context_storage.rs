use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

fn message(error: impl std::fmt::Display) -> String {
    format!("Context storage unavailable: {error}. Check ~/.audeeo permissions and retry.")
}
fn home() -> Result<PathBuf, String> {
    ["HOME", "USERPROFILE"]
        .into_iter()
        .find_map(|name| std::env::var_os(name).filter(|value| !value.is_empty()))
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| message("home directory unavailable"))
}
fn root() -> Result<PathBuf, String> {
    let path = home()?.join(".audeeo");
    fs::create_dir_all(&path).map_err(message)?;
    let metadata = fs::symlink_metadata(&path).map_err(message)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(message("storage directory must be a real directory"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(message)?;
    }
    Ok(path)
}
fn path() -> Result<PathBuf, String> {
    Ok(root()?.join("context.json"))
}
fn open_read(path: &Path) -> Result<File, std::io::Error> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(std::io::Error::other("context.json must be a real file"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.uid() != unsafe { libc::geteuid() } || metadata.nlink() != 1 {
            return Err(std::io::Error::other(
                "context.json must be owned by this user",
            ));
        }
    }
    File::open(path)
}
fn get_from(path: &Path) -> Result<Option<String>, String> {
    let mut file = match open_read(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(message(error)),
    };
    if file.metadata().map_err(message)?.len() > 2 * 1024 * 1024 {
        return Err(message("context.json is too large"));
    }
    let mut value = String::new();
    file.read_to_string(&mut value).map_err(message)?;
    serde_json::from_str::<serde_json::Value>(&value)
        .map_err(|_| message("context.json is invalid JSON; it has not been overwritten"))?;
    Ok(Some(value))
}
pub fn get() -> Result<Option<String>, String> {
    get_from(&path()?)
}
fn set_to(path: &Path, value: &str) -> Result<(), String> {
    if value.len() > 2 * 1024 * 1024 {
        return Err(message("context is too large"));
    }
    serde_json::from_str::<serde_json::Value>(value).map_err(|_| message("context is invalid"))?;
    if path.exists() {
        open_read(path).map_err(message)?;
    }
    static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let temporary = path.with_file_name(format!(
        ".context-{}-{}.tmp",
        std::process::id(),
        SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(message)?;
    let result = (|| {
        file.write_all(value.as_bytes()).map_err(message)?;
        file.write_all(b"\n").map_err(message)?;
        file.sync_all().map_err(message)?;
        drop(file);
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStrExt;
            use windows::core::PCWSTR;
            use windows::Win32::Storage::FileSystem::{
                MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MOVE_FILE_FLAGS,
            };
            let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
            let destination: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
            unsafe {
                MoveFileExW(
                    PCWSTR(source.as_ptr()),
                    PCWSTR(destination.as_ptr()),
                    MOVE_FILE_FLAGS(MOVEFILE_REPLACE_EXISTING.0 | MOVEFILE_WRITE_THROUGH.0),
                )
                .map_err(message)?;
            }
        }
        #[cfg(not(windows))]
        {
            fs::rename(&temporary, &path).map_err(message)?;
            File::open(path.parent().unwrap())
                .and_then(|directory| directory.sync_all())
                .map_err(message)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
pub fn set(value: &str) -> Result<(), String> {
    set_to(&path()?, value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_persistence_and_corruption_handling() {
        let root = std::env::temp_dir().join(format!("audeeo-context-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let path = root.join("context.json");
        set_to(&path, r#"{"category":"general"}"#).unwrap();
        assert_eq!(
            get_from(&path).unwrap().unwrap().trim(),
            r#"{"category":"general"}"#
        );
        fs::write(&path, "not-json").unwrap();
        assert!(get_from(&path).unwrap_err().contains("invalid JSON"));
        assert!(set_to(&path, &format!("\"{}\"", "x".repeat(2 * 1024 * 1024 + 1))).is_err());
        let _ = fs::remove_dir_all(&root);
    }
}
