//! macOS session persistence. Called only on the existing blocking storage worker.
use std::{collections::BTreeMap, fs::{self, File, OpenOptions}, io::{Read, Write}, path::{Path, PathBuf}};
use std::os::{fd::AsRawFd, unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt}};

type Entries = BTreeMap<String, String>;
fn error(error: impl std::fmt::Display) -> String {
    format!("Configuration storage unavailable: {error}. Check ~/.audeeo/.config permissions, then choose Retry storage.")
}
fn directory(path: &Path) -> Result<(), String> {
    match fs::DirBuilder::new().mode(0o700).create(path) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(e) => return Err(error(e)),
    }
    let metadata = fs::symlink_metadata(path).map_err(error)?;
    if !metadata.is_dir() || metadata.uid() != unsafe { libc::geteuid() } {
        return Err(error("config directory must be a real directory owned by this user"));
    }
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(error)
}
fn private_file(path: &Path, create: bool) -> Result<File, std::io::Error> {
    let file = OpenOptions::new().read(true).write(create).create(create)
        .mode(0o600).custom_flags(libc::O_NOFOLLOW).open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.uid() != unsafe { libc::geteuid() } || metadata.nlink() != 1 {
        return Err(std::io::Error::other("config file must be a regular file without hard links owned by this user"));
    }
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    Ok(file)
}
fn load(path: &Path) -> Result<Entries, String> {
    let mut file = match private_file(path, false) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Entries::new()),
        Err(e) => return Err(error(e)),
    };
    let mut data = String::new();
    file.read_to_string(&mut data).map_err(error)?;
    // Do not echo malformed file contents, which may contain tokens.
    serde_json::from_str(&data).map_err(|_| error("auth.json is invalid JSON; it has not been overwritten"))
}
fn save(path: &Path, entries: &Entries) -> Result<(), String> {
    static SERIAL: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let temporary = path.with_file_name(format!(".auth-{}-{}.tmp", std::process::id(), SERIAL.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    let mut file = OpenOptions::new().write(true).create_new(true).mode(0o600).open(&temporary).map_err(error)?;
    let result = (|| {
        serde_json::to_writer(&mut file, entries).map_err(|_| error("unable to encode configuration"))?;
        file.write_all(b"\n").map_err(error)?;
        file.sync_all().map_err(error)?;
        fs::rename(&temporary, path).map_err(error)?;
        File::open(path.parent().unwrap()).and_then(|directory| directory.sync_all()).map_err(error)
    })();
    if result.is_err() { let _ = fs::remove_file(&temporary); }
    result
}
fn access<T>(home: &Path, action: impl FnOnce(&Path) -> Result<T, String>) -> Result<T, String> {
    let root = home.join(".audeeo");
    directory(&root)?;
    let config = root.join(".config");
    directory(&config)?;
    let lock = private_file(&config.join(".auth.lock"), true).map_err(error)?;
    // Closing the file releases this lock, including on error. Serialize across app instances.
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX) } != 0 { return Err(error(std::io::Error::last_os_error())); }
    action(&config.join("auth.json"))
}
fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME").filter(|value| !value.is_empty()).map(PathBuf::from)
        .filter(|path| path.is_absolute()).ok_or_else(|| error("home directory unavailable"))
}
pub fn get(key: &str) -> Result<Option<String>, String> {
    access(&home()?, |path| Ok(load(path)?.remove(key)))
}
pub fn set(key: &str, value: Option<String>) -> Result<(), String> {
    access(&home()?, |path| {
        let mut entries = load(path)?;
        match value { Some(value) => { entries.insert(key.to_owned(), value); }, None => { entries.remove(key); } }
        save(path, &entries)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persistence_permissions_deletion_and_corruption() {
        let home = std::env::temp_dir().join(format!("audeeo-file-store-{}", std::process::id()));
        fs::create_dir_all(&home).unwrap();
        access(&home, |path| {
            assert!(load(path)?.is_empty());
            let mut entries = Entries::new();
            entries.insert("session".into(), "synthetic-session".into());
            entries.insert("pkce".into(), "synthetic-verifier".into());
            save(path, &entries)?;
            assert_eq!(load(path)?, entries);
            assert_eq!(fs::metadata(path).unwrap().permissions().mode() & 0o777, 0o600);
            assert_eq!(fs::metadata(path.parent().unwrap()).unwrap().permissions().mode() & 0o777, 0o700);
            entries.remove("session"); save(path, &entries)?;
            assert!(load(path)?.get("session").is_none());
            assert!(load(path)?.contains_key("pkce"));
            fs::write(path, "invalid synthetic data").unwrap();
            assert!(load(path).is_err());
            fs::remove_file(path).unwrap();
            let other = home.join("other"); fs::write(&other, "{}").unwrap();
            std::os::unix::fs::symlink(&other, path).unwrap();
            assert!(load(path).is_err());
            Ok(())
        }).unwrap();
        fs::remove_dir_all(home).unwrap();
    }
}
