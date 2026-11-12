//! Resolve the existing logical TOML path without changing workspace identities.
//!
//! A real sidecar remains an explicit compatibility override. Otherwise an
//! existing sibling JPEG is decoded lazily, in process, with no disk writes.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_METADATA_TEXT_BYTES: u64 = 16 * 1024 * 1024;

use crate::error::{AppError, AppResult};

pub(super) struct MetadataSource {
    path: PathBuf,
    direct: bool,
}

impl MetadataSource {
    /// UI reads never start JPEG decoding, including when a sidecar disappeared
    /// after import or could not be written. Preparation is an explicit job.
    pub(super) fn prepared(path: &Path) -> AppResult<Self> {
        if !path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("toml"))
        {
            return Err(AppError::Invalid(
                "prepared metadata must be a TOML path".into(),
            ));
        }
        Ok(Self {
            path: path.to_path_buf(),
            direct: false,
        })
    }

    pub(super) fn resolve(path: &Path) -> AppResult<Self> {
        if path.is_file() {
            let direct = is_jpeg(path);
            return Ok(Self {
                path: path.to_path_buf(),
                direct,
            });
        }
        if !path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("toml"))
        {
            return Err(AppError::NotFound(format!(
                "image metadata: {}",
                path.display()
            )));
        }

        // Windows paths are case-insensitive, so these also resolve .JPG,
        // .JPEG and mixed-case extensions without enumerating the directory.
        let candidates: Vec<_> = ["jpg", "jpeg"]
            .into_iter()
            .map(|extension| path.with_extension(extension))
            .filter(|candidate| candidate.is_file())
            .collect();
        if !candidates.is_empty() && path.with_extension("png").is_file() {
            return Err(ambiguous_source(path));
        }
        match candidates.len() {
            1 => {
                return Ok(Self {
                    path: candidates[0].clone(),
                    direct: true,
                })
            }
            0 => {}
            _ => return Err(ambiguous_source(path)),
        }

        // Windows does not enumerate the directory for every missing/PNG item.
        #[cfg(windows)]
        return Err(AppError::NotFound(format!(
            "image metadata: {}",
            path.display()
        )));

        #[cfg(not(windows))]
        {
            // Portable uppercase-extension fixtures; retain at most one path.
            let parent = path.parent().unwrap_or_else(|| Path::new("."));
            let mut candidate = None;
            for entry in fs::read_dir(parent)? {
                let entry = entry?;
                if !entry.file_type()?.is_file() {
                    continue;
                }
                let source = entry.path();
                if source.file_stem() != path.file_stem() || !is_jpeg(&source) {
                    continue;
                }
                if candidate.is_some() {
                    return Err(ambiguous_source(path));
                }
                candidate = Some(source);
            }
            candidate
                .map(|path| Self { path, direct: true })
                .ok_or_else(|| AppError::NotFound(format!("image metadata: {}", path.display())))
        }
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }

    pub(super) fn is_direct(&self) -> bool {
        self.direct
    }

    pub(super) fn cache_identity(&self) -> String {
        format!(
            "{}\0{}",
            if self.direct { "jpeg" } else { "toml" },
            self.path.to_string_lossy()
        )
    }

    pub(super) fn progress(&self, completed: usize) -> super::ExifParseProgress {
        super::ExifParseProgress {
            stage: if self.direct { "JPEG" } else { "TOML" },
            completed,
            total: self.progress_total(),
        }
    }

    pub(super) fn progress_total(&self) -> usize {
        if self.direct {
            super::mtk_exif::INSPECTION_STEPS + 2
        } else {
            2
        }
    }

    pub(super) fn read_text(&self) -> AppResult<String> {
        self.read_text_with_progress(&mut |_| {})
    }

    pub(super) fn read_text_with_progress(
        &self,
        on_progress: &mut impl FnMut(super::ExifParseProgress),
    ) -> AppResult<String> {
        on_progress(self.progress(0));
        if !self.direct {
            let mut bytes = Vec::new();
            fs::File::open(&self.path)?
                .take(MAX_METADATA_TEXT_BYTES + 1)
                .read_to_end(&mut bytes)?;
            if bytes.len() as u64 > MAX_METADATA_TEXT_BYTES {
                return Err(AppError::Invalid(
                    "image metadata text exceeds the 16 MiB limit".into(),
                ));
            }
            on_progress(self.progress(1));
            return String::from_utf8(bytes).map_err(|error| {
                AppError::Invalid(format!("image metadata is not UTF-8: {error}"))
            });
        }
        let metadata = super::read_jpeg_metadata(&self.path)?;
        on_progress(self.progress(1));
        let output = super::mtk_exif::decode_to_toml_with_progress(&metadata, |completed, _| {
            on_progress(self.progress(1 + completed));
        })
        .map_err(AppError::Other)?;
        Ok(output.toml)
    }
}

fn is_jpeg(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("jpg") || extension.eq_ignore_ascii_case("jpeg")
        })
}

fn ambiguous_source(path: &Path) -> AppError {
    AppError::Invalid(format!(
        "multiple images share the metadata stem: {}",
        path.display()
    ))
}
