//! Windows session persistence in the same user-local path as the desktop Mac app.
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::{
    MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MOVE_FILE_FLAGS,
};

type Entries = BTreeMap<String, String>;

fn error(error: impl std::fmt::Display) -> String {
    format!(
        "Configuration storage unavailable: {error}. Check ~/.audeeo/.config permissions, then choose Retry storage."
    )
}

fn directory(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(error)?;
    let metadata = fs::symlink_metadata(path).map_err(error)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(error("config directory must be a real directory"));
    }
    Ok(())
}

fn load(path: &Path) -> Result<Entries, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(Entries::new()),
        Err(err) => return Err(error(err)),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(error("auth.json must be a real file"));
    }
    let mut data = String::new();
    File::open(path)
        .and_then(|mut file| file.read_to_string(&mut data))
        .map_err(error)?;
    serde_json::from_str(&data)
        .map_err(|_| error("auth.json is invalid JSON; it has not been overwritten"))
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

fn save(path: &Path, entries: &Entries) -> Result<(), String> {
    static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let temporary = path.with_file_name(format!(
        ".auth-{}-{}.tmp",
        std::process::id(),
        SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(error)?;
    let result = (|| {
        serde_json::to_writer(&mut file, entries)
            .map_err(|_| error("unable to encode configuration"))?;
        file.write_all(b"\n").map_err(error)?;
        file.sync_all().map_err(error)?;
        drop(file);
        let source = wide(&temporary);
        let destination = wide(path);
        unsafe {
            MoveFileExW(
                PCWSTR(source.as_ptr()),
                PCWSTR(destination.as_ptr()),
                MOVE_FILE_FLAGS(MOVEFILE_REPLACE_EXISTING.0 | MOVEFILE_WRITE_THROUGH.0),
            )
            .map_err(error)?;
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn home() -> Result<PathBuf, String> {
    ["HOME", "USERPROFILE"]
        .into_iter()
        .find_map(|name| std::env::var_os(name).filter(|value| !value.is_empty()))
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
        .ok_or_else(|| error("home directory unavailable"))
}

fn path() -> Result<PathBuf, String> {
    let root = home()?.join(".audeeo");
    directory(&root)?;
    let config = root.join(".config");
    directory(&config)?;
    Ok(config.join("auth.json"))
}

pub fn get(key: &str) -> Result<Option<String>, String> {
    Ok(load(&path()?)?.remove(key))
}

pub fn set(key: &str, value: Option<String>) -> Result<(), String> {
    let path = path()?;
    let mut entries = load(&path)?;
    match value {
        Some(value) => {
            entries.insert(key.to_owned(), value);
        }
        None => {
            entries.remove(key);
        }
    }
    save(&path, &entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_persistence_and_deletion() {
        let root =
            std::env::temp_dir().join(format!("audeeo-windows-store-{}", std::process::id()));
        directory(&root).unwrap();
        let path = root.join("auth.json");
        let mut entries = Entries::new();
        entries.insert("session".into(), "synthetic-session".into());
        entries.insert("pkce".into(), "synthetic-verifier".into());
        save(&path, &entries).unwrap();
        assert_eq!(load(&path).unwrap(), entries);
        entries.remove("session");
        save(&path, &entries).unwrap();
        assert!(!load(&path).unwrap().contains_key("session"));
        fs::remove_dir_all(root).unwrap();
    }
}
