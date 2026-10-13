pub mod card_source;
pub mod parser;
pub mod path_query;
pub mod search;
pub mod types;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::SystemTime;

use dashmap::DashMap;
use parking_lot::Mutex;

use crate::error::AppResult;
use types::ParseResult;

/// Cached per-file parse result. Re-uses the parsed AST when `mtime` matches.
pub struct CppParserCache {
    inner: DashMap<PathBuf, CachedEntry>,
    parse_lock: Mutex<()>,
    tick: AtomicU64,
}

struct CachedEntry {
    mtime:  SystemTime,
    parsed: Arc<ParseResult>,
    last_used: AtomicU64,
}

const CACHE_LIMIT: usize = 3;

impl Default for CppParserCache {
    fn default() -> Self { Self::new() }
}

impl CppParserCache {
    pub fn new() -> Self {
        Self { inner: DashMap::new(), parse_lock: Mutex::new(()), tick: AtomicU64::new(1) }
    }

    /// Get a parsed result for `path`; re-parses if the file's mtime changed.
    pub fn get(&self, path: &Path) -> AppResult<Arc<ParseResult>> {
        let canon: PathBuf = std::fs::canonicalize(path)?;
        let mtime = std::fs::metadata(&canon)?.modified()?;

        if let Some(entry) = self.inner.get(&canon) {
            if entry.mtime == mtime {
                entry.last_used.store(self.tick.fetch_add(1, Ordering::Relaxed), Ordering::Relaxed);
                return Ok(Arc::clone(&entry.parsed));
            }
        }

        let _guard = self.parse_lock.lock();
        if let Some(entry) = self.inner.get(&canon) {
            if entry.mtime == mtime {
                entry.last_used.store(self.tick.fetch_add(1, Ordering::Relaxed), Ordering::Relaxed);
                return Ok(Arc::clone(&entry.parsed));
            }
        }

        let parsed = parser::parse_file(&canon)?;
        let arc = Arc::new(parsed);
        self.inner.insert(canon.clone(), CachedEntry {
            mtime,
            parsed: Arc::clone(&arc),
            last_used: AtomicU64::new(self.tick.fetch_add(1, Ordering::Relaxed)),
        });

        // Keep recently used parse trees without retaining every imported file.
        while self.inner.len() > CACHE_LIMIT {
            // Evict the least recently used tree, keeping the new result.
            let mut oldest_key: Option<PathBuf> = None;
            let mut oldest_t:   Option<u64> = None;
            for kv in self.inner.iter() {
                if kv.key() == &canon { continue; }
                let last_used = kv.value().last_used.load(Ordering::Relaxed);
                match oldest_t {
                    None => {
                        oldest_t = Some(last_used);
                        oldest_key = Some(kv.key().clone());
                    }
                    Some(t) if last_used < t => {
                        oldest_t = Some(last_used);
                        oldest_key = Some(kv.key().clone());
                    }
                    _ => {}
                }
            }
            if let Some(k) = oldest_key {
                self.inner.remove(&k);
            }
        }
        Ok(arc)
    }

    pub fn clear(&self) {
        let _guard = self.parse_lock.lock();
        self.inner.clear();
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn concurrent_reads_share_a_bounded_cache() {
        let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("luxe-cpp-cache-{}-{unique}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        let paths: Vec<_> = (0..5).map(|index| {
            let path = dir.join(format!("sample-{index}.cpp"));
            std::fs::write(&path, format!("int value_{index} = {index};\n")).unwrap();
            path
        }).collect();

        let cache = Arc::new(CppParserCache::new());
        let handles: Vec<_> = (0..8).map(|_| {
            let cache = Arc::clone(&cache);
            let path = paths[0].clone();
            std::thread::spawn(move || cache.get(&path).unwrap())
        }).collect();
        let results: Vec<_> = handles.into_iter().map(|handle| handle.join().unwrap()).collect();
        assert!(results.iter().all(|result| Arc::ptr_eq(result, &results[0])));

        for path in paths.iter().skip(1) { cache.get(path).unwrap(); }
        assert_eq!(cache.len(), CACHE_LIMIT);
        assert!(Arc::ptr_eq(&cache.get(&paths[4]).unwrap(), &cache.get(&paths[4]).unwrap()));

        std::fs::remove_dir_all(dir).unwrap();
    }
}
