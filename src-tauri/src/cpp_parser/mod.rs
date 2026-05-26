pub mod card_source;
pub mod parser;
pub mod path_query;
pub mod search;
pub mod types;

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::SystemTime;

use dashmap::DashMap;

use crate::error::AppResult;
use types::ParseResult;

/// Cached per-file parse result. Re-uses the parsed AST when `mtime` matches.
pub struct CppParserCache {
    inner: DashMap<PathBuf, CachedEntry>,
}

struct CachedEntry {
    mtime:  SystemTime,
    parsed: Arc<ParseResult>,
}

impl Default for CppParserCache {
    fn default() -> Self { Self::new() }
}

impl CppParserCache {
    pub fn new() -> Self {
        Self { inner: DashMap::new() }
    }

    /// Get a parsed result for `path`; re-parses if the file's mtime changed.
    pub fn get(&self, path: &Path) -> AppResult<Arc<ParseResult>> {
        let canon: PathBuf = std::fs::canonicalize(path)?;
        let mtime = std::fs::metadata(&canon)?.modified()?;

        if let Some(entry) = self.inner.get(&canon) {
            if entry.mtime == mtime {
                return Ok(Arc::clone(&entry.parsed));
            }
        }

        let parsed = parser::parse_file(&canon)?;
        let arc = Arc::new(parsed);
        self.inner.insert(canon, CachedEntry { mtime, parsed: Arc::clone(&arc) });

        // Soft cap — don't let long sessions accumulate parser instances.
        if self.inner.len() > 8 {
            // Drop the entry whose mtime is oldest (least likely to be active).
            let mut oldest_key: Option<PathBuf> = None;
            let mut oldest_t:   Option<SystemTime> = None;
            for kv in self.inner.iter() {
                match oldest_t {
                    None => {
                        oldest_t = Some(kv.value().mtime);
                        oldest_key = Some(kv.key().clone());
                    }
                    Some(t) if kv.value().mtime < t => {
                        oldest_t = Some(kv.value().mtime);
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
        self.inner.clear();
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }
}
