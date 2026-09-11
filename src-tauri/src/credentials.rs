use std::collections::HashMap;

/// Lives only in this process. Its caller serializes access on blocking workers.
#[derive(Default)]
pub struct CredentialCache {
    values: HashMap<String, Result<Option<String>, String>>,
}
impl CredentialCache {
    pub fn retry_errors(&mut self) { self.values.retain(|_, value| value.is_ok()); }
    pub fn get(&mut self, key: &str, read: impl FnOnce() -> Result<Option<String>, String>) -> Result<Option<String>, String> {
        self.values.entry(key.to_owned()).or_insert_with(read).clone()
    }
    pub fn set(&mut self, key: &str, value: Option<String>, write: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        if matches!(self.values.get(key), Some(Ok(previous)) if previous == &value) { return Ok(()); }
        write()?;
        self.values.insert(key.to_owned(), Ok(value));
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn repeated_reads_and_identical_writes_do_not_touch_keychain() {
        let mut cache = CredentialCache::default();
        assert_eq!(cache.get("session", || Ok(Some("token".into()))).unwrap(), Some("token".into()));
        assert_eq!(cache.get("session", || panic!("Repeated read")).unwrap(), Some("token".into()));
        cache.set("session", Some("token".into()), || panic!("Redundant write")).unwrap();
        cache.set("session", Some("new".into()), || Ok(())).unwrap();
        assert_eq!(cache.get("session", || panic!()).unwrap(), Some("new".into()));
        cache.set("session", None, || Ok(())).unwrap();
        assert_eq!(cache.get("session", || panic!("Deleted credential resurrected")).unwrap(), None);
    }
    #[test]
    fn denied_read_is_not_absence_and_is_not_retried() {
        let mut cache = CredentialCache::default();
        assert!(cache.get("session", || Err("denied".into())).is_err());
        assert_eq!(cache.get("session", || panic!("Repeated denial")), Err("denied".into()));
        assert!(cache.set("session", Some("new".into()), || Err("write denied".into())).is_err());
        assert!(cache.get("session", || panic!()).is_err());
        cache.retry_errors();
        assert_eq!(cache.get("session", || Ok(Some("unlocked".into()))).unwrap(), Some("unlocked".into()));
        cache.set("session", Some("new".into()), || Ok(())).unwrap();
        assert_eq!(cache.get("session", || panic!()).unwrap(), Some("new".into()));
    }
    #[test]
    fn concurrent_session_checks_share_one_native_read() {
        use std::sync::{Arc, Mutex, atomic::{AtomicUsize, Ordering}};
        let cache = Arc::new(Mutex::new(CredentialCache::default()));
        let calls = Arc::new(AtomicUsize::new(0));
        let handles: Vec<_> = (0..16).map(|_| {
            let cache = cache.clone(); let calls = calls.clone();
            std::thread::spawn(move || cache.lock().unwrap().get("session", || {
                calls.fetch_add(1, Ordering::SeqCst);
                Ok(Some("token".into()))
            }).unwrap())
        }).collect();
        for handle in handles { assert_eq!(handle.join().unwrap(), Some("token".into())); }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
    #[test]
    fn missing_items_and_accounts_are_cached_separately() {
        let mut cache = CredentialCache::default();
        assert_eq!(cache.get("a", || Ok(None)).unwrap(), None);
        assert_eq!(cache.get("a", || panic!()).unwrap(), None);
        assert_eq!(cache.get("b", || Ok(Some("b".into()))).unwrap(), Some("b".into()));
    }
}
