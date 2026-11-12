//! Two-phase cleanup of explicitly selected images' metadata sidecars.
//!
//! Both APIs revalidate the complete image selection. Confirmation is a closed
//! filename allowlist, not permission to glob `.exif` or delete new sidecars.
//! No image/sidecar contents are read and no cleanup cache is retained. The IPC
//! caller owns the EXIF-task mutex and cache invalidation after this operation.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};

const MAX_IMAGES: usize = 4096;
const MAX_DIRECTORY_ENTRIES: usize = 262_144;
const MAX_PATH_BYTES: usize = 32_768;
const MAX_NAME_BYTES: usize = 1024;
const MAX_DIRECTORY_DEPTH: usize = 128;

#[derive(Debug, Serialize)]
pub struct ImageSidecarCleanupSummary {
    pub deleted: Vec<String>,
    pub failed: Vec<String>,
}

struct DirectoryScope {
    requested: PathBuf,
    canonical: PathBuf,
    // On Windows, deny rename/delete sharing on every directory in the chain.
    // This pins the checked parents while sidecars are inspected/deleted.
    _directory_handles: Vec<fs::File>,
}

struct CleanupPlan {
    scope: DirectoryScope,
    allowed_names: BTreeSet<String>,
    // At most two actual spellings per folded name: two already means unsafe
    // ambiguity on a case-sensitive fixture / case-sensitive Windows folder.
    actual_names: BTreeMap<String, Vec<String>>,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::Invalid(message.into())
}

fn unsafe_path(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}

fn folded(name: &str) -> String {
    name.to_lowercase()
}

fn is_image_name(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("jpg")
                || extension.eq_ignore_ascii_case("jpeg")
                || extension.eq_ignore_ascii_case("png")
        })
}

fn stem(name: &str) -> Option<&str> {
    Path::new(name).file_stem()?.to_str()
}

fn protected_name(name: &str) -> bool {
    name.eq_ignore_ascii_case("state.toml")
}

fn valid_component(name: &str) -> bool {
    if name.is_empty()
        || name.len() > MAX_NAME_BYTES
        || name.ends_with('.')
        || name.ends_with(' ')
        || name
            .chars()
            .any(|ch| ch.is_control() || "<>:\"/\\|?*".contains(ch))
    {
        return false;
    }
    // Reject Win32 device/stream aliases on portable fixtures as well.
    let base = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(
        base.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) {
        return false;
    }
    if base.len() == 4 && (base.starts_with("COM") || base.starts_with("LPT")) {
        return !matches!(base.as_bytes()[3], b'1'..=b'9');
    }
    true
}

fn validate_absolute(path: &Path) -> AppResult<()> {
    let text = path
        .to_str()
        .ok_or_else(|| invalid("cleanup paths must be valid UTF-8"))?;
    if !path.is_absolute() || text.len() > MAX_PATH_BYTES {
        return Err(invalid("cleanup paths must be bounded absolute paths"));
    }
    let mut depth = 0;
    for component in path.components() {
        match component {
            Component::ParentDir | Component::CurDir => {
                return Err(invalid(
                    "cleanup paths cannot traverse parent/current directories",
                ))
            }
            Component::Normal(name) => {
                depth += 1;
                if !name.to_str().is_some_and(valid_component) {
                    return Err(invalid("cleanup paths contain an unsafe filename"));
                }
            }
            Component::Prefix(prefix) => {
                #[cfg(windows)]
                if !matches!(
                    prefix.kind(),
                    std::path::Prefix::Disk(_)
                        | std::path::Prefix::VerbatimDisk(_)
                        | std::path::Prefix::UNC(_, _)
                        | std::path::Prefix::VerbatimUNC(_, _)
                ) {
                    return Err(invalid("cleanup does not accept device namespace paths"));
                }
                #[cfg(not(windows))]
                let _ = prefix;
            }
            Component::RootDir => {}
        }
    }
    if depth > MAX_DIRECTORY_DEPTH {
        return Err(invalid("cleanup path nesting exceeds its budget"));
    }
    Ok(())
}

fn is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Includes junctions, cloud placeholders and all other reparse tags.
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

fn directory_chain(path: &Path) -> Vec<PathBuf> {
    let mut current = PathBuf::new();
    let mut result = Vec::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if current.is_absolute() {
            result.push(current.clone());
        }
    }
    result
}

fn check_directory(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() || is_link_or_reparse(&metadata) {
        return Err(unsafe_path(
            "cleanup directory/ancestors must not be links or reparse points",
        ));
    }
    Ok(())
}

impl DirectoryScope {
    fn new(path: &Path) -> AppResult<Self> {
        validate_absolute(path)?;
        let mut handles: Vec<fs::File> = Vec::new();
        for directory in directory_chain(path) {
            check_directory(&directory)?;
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                use windows::Win32::Storage::FileSystem::{
                    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ, FILE_SHARE_WRITE,
                };
                let handle = fs::OpenOptions::new()
                    .read(true)
                    .access_mode(FILE_READ_ATTRIBUTES.0)
                    .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0)
                    .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
                    .open(&directory)?;
                let metadata = handle.metadata()?;
                if !metadata.is_dir() || is_link_or_reparse(&metadata) {
                    return Err(invalid("cleanup directory changed into a reparse point"));
                }
                handles.push(handle);
            }
        }
        // Keep the empty portable vector immutable without a platform warning.
        #[cfg(not(windows))]
        handles.shrink_to_fit();
        let canonical = fs::canonicalize(path)?;
        check_directory(&canonical)?;
        Ok(Self {
            requested: path.to_path_buf(),
            canonical,
            _directory_handles: handles,
        })
    }

    fn check_parent(&self, path: &Path) -> io::Result<()> {
        for directory in directory_chain(&self.requested) {
            check_directory(&directory)?;
        }
        if fs::canonicalize(&self.requested)? != self.canonical {
            return Err(unsafe_path("cleanup directory identity changed"));
        }
        let parent = path
            .parent()
            .ok_or_else(|| unsafe_path("cleanup target has no parent"))?;
        for directory in directory_chain(parent) {
            check_directory(&directory)?;
        }
        if fs::canonicalize(parent)? != self.canonical {
            return Err(unsafe_path(
                "cleanup target is outside the selected image directory",
            ));
        }
        Ok(())
    }

    fn regular_file(&self, path: &Path) -> io::Result<Option<fs::Metadata>> {
        self.check_parent(path)?;
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        if !metadata.is_file() || is_link_or_reparse(&metadata) {
            return Err(unsafe_path(
                "cleanup target is not a regular non-reparse file",
            ));
        }
        let resolved = match fs::canonicalize(path) {
            Ok(resolved) => resolved,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        if resolved.parent() != Some(self.canonical.as_path()) {
            return Err(unsafe_path(
                "cleanup target resolves outside the selected directory",
            ));
        }
        Ok(Some(metadata))
    }
}

fn sidecar_names(image_name: &str) -> AppResult<BTreeSet<String>> {
    let stem = stem(image_name).ok_or_else(|| invalid("selected image has no filename stem"))?;
    Ok([
        format!("{stem}.toml"),
        format!("{stem}.exif"),
        format!("{image_name}.exif"),
    ]
    .into_iter()
    .filter(|name| !protected_name(name))
    .map(|name| folded(&name))
    .collect())
}

impl CleanupPlan {
    fn new(image_dir: &Path, image_paths: &[String]) -> AppResult<Self> {
        if image_paths.len() > MAX_IMAGES {
            return Err(invalid(
                "sidecar cleanup accepts at most 4096 selected images",
            ));
        }
        let scope = DirectoryScope::new(image_dir)?;
        let mut requested_names = BTreeSet::new();
        let mut requested_stems = BTreeMap::new();
        let mut allowed_names = BTreeSet::new();
        // Validate the entire input before any deletion, even when an earlier
        // image has valid sidecars. File lookup below resolves actual casing.
        for text in image_paths {
            let path = Path::new(text);
            validate_absolute(path)?;
            scope.check_parent(path)?;
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| invalid("selected image has no filename"))?;
            if !is_image_name(name) {
                return Err(invalid(
                    "cleanup selection must contain only jpg/jpeg/png images",
                ));
            }
            requested_names.insert(folded(name));
            requested_stems
                .entry(folded(
                    stem(name).ok_or_else(|| invalid("selected image has no stem"))?,
                ))
                .or_insert(0usize);
            allowed_names.extend(sidecar_names(name)?);
        }
        let mut actual_names: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut sidecar_owners: BTreeMap<String, usize> =
            allowed_names.iter().map(|name| (name.clone(), 0)).collect();
        for (index, entry) in fs::read_dir(&scope.canonical)?.enumerate() {
            if index >= MAX_DIRECTORY_ENTRIES {
                return Err(invalid(
                    "sidecar cleanup directory exceeds its entry budget",
                ));
            }
            let entry = entry?;
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if is_image_name(name) {
                if let Some(count) =
                    stem(name).and_then(|stem| requested_stems.get_mut(&folded(stem)))
                {
                    // Count even unsafe entries conservatively. A symlink or
                    // a directory named as another image is not an owner hint.
                    *count = (*count + 1).min(2);
                }
                // A dotted image name can also share `<image>.exif` with
                // another image's `<stem>.exif` even when their stems differ.
                for sidecar in sidecar_names(name)? {
                    if let Some(count) = sidecar_owners.get_mut(&sidecar) {
                        *count = (*count + 1).min(2);
                    }
                }
            }
            let key = folded(name);
            if requested_names.contains(&key) || allowed_names.contains(&key) {
                let names = actual_names.entry(key).or_default();
                if names.len() < 2 {
                    names.push(name.to_string());
                }
            }
        }
        if requested_stems.values().any(|count| *count > 1)
            || sidecar_owners.values().any(|count| *count > 1)
        {
            return Err(invalid("images have ambiguous shared sidecar ownership"));
        }
        for name in requested_names {
            let names = actual_names.get(&name).ok_or_else(|| {
                AppError::NotFound("selected image does not exist in the image directory".into())
            })?;
            if names.len() != 1 {
                return Err(invalid(
                    "selected image filename is case-insensitively ambiguous",
                ));
            }
            let actual = scope.canonical.join(&names[0]);
            if scope.regular_file(&actual)?.is_none() {
                return Err(AppError::NotFound(
                    "selected image disappeared before cleanup".into(),
                ));
            }
        }
        Ok(Self {
            scope,
            allowed_names,
            actual_names,
        })
    }

    fn actual_path(&self, key: &str, missing_name: &str) -> AppResult<PathBuf> {
        match self.actual_names.get(key) {
            Some(names) if names.len() != 1 => {
                Err(invalid("sidecar filename is case-insensitively ambiguous"))
            }
            Some(names) => Ok(self.scope.canonical.join(&names[0])),
            None => Ok(self.scope.canonical.join(missing_name)),
        }
    }

    fn confirmed_targets(&self, confirmed_files: &[String]) -> AppResult<Vec<PathBuf>> {
        let mut names = BTreeMap::new();
        for text in confirmed_files {
            let path = Path::new(text);
            validate_absolute(path)?;
            self.scope.check_parent(path)?;
            let name = path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| invalid("confirmed sidecar has no filename"))?;
            let key = folded(name);
            if protected_name(name) || !self.allowed_names.contains(&key) {
                return Err(invalid(
                    "confirmed file is not a sidecar owned by the selected images",
                ));
            }
            names.entry(key).or_insert_with(|| name.to_string());
        }
        // Resolve every candidate/ambiguity before deleting the first target.
        names
            .into_iter()
            .map(|(key, name)| self.actual_path(&key, &name))
            .collect()
    }
}

fn absolute_string(path: &Path) -> AppResult<String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| invalid("cleanup output path is not valid UTF-8"))
}

/// List existing, unambiguous regular sidecars without modifying the directory.
/// The caller must show this exact list and obtain confirmation before clearing.
pub fn list_image_sidecars(image_dir: &Path, image_paths: Vec<String>) -> AppResult<Vec<String>> {
    let plan = CleanupPlan::new(image_dir, &image_paths)?;
    let mut result = Vec::new();
    for key in &plan.allowed_names {
        if !plan.actual_names.contains_key(key) {
            continue;
        }
        let path = plan.actual_path(key, key)?;
        if plan.scope.regular_file(&path)?.is_some() {
            result.push(absolute_string(&path)?);
        }
    }
    Ok(result)
}

fn remove_confirmed(scope: &DirectoryScope, path: &Path) -> io::Result<bool> {
    let Some(metadata) = scope.regular_file(path)? else {
        return Ok(false);
    };
    if metadata.permissions().readonly() {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "sidecar is read-only",
        ));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use std::os::windows::io::AsRawHandle;
        use windows::Win32::Foundation::HANDLE;
        use windows::Win32::Storage::FileSystem::{
            FileDispositionInfo, SetFileInformationByHandle, DELETE, FILE_DISPOSITION_INFO,
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
        };
        // OPEN_REPARSE_POINT never follows a substituted link. Holding this
        // non-delete-shared handle and pinned parent handles closes the usual
        // metadata-check/remove_file rename race on the production platform.
        let file = match fs::OpenOptions::new()
            .read(true)
            .access_mode(DELETE.0 | FILE_READ_ATTRIBUTES.0)
            .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0)
            .open(path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error),
        };
        let metadata = file.metadata()?;
        if !metadata.is_file() || is_link_or_reparse(&metadata) || metadata.permissions().readonly()
        {
            return Err(unsafe_path(
                "confirmed sidecar became unsafe before deletion",
            ));
        }
        scope.check_parent(path)?;
        let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
        // SAFETY: the handle is live, opened with DELETE, and refers to the
        // checked ordinary file. The information buffer has its exact ABI size.
        unsafe {
            SetFileInformationByHandle(
                HANDLE(file.as_raw_handle()),
                FileDispositionInfo,
                (&disposition as *const FILE_DISPOSITION_INFO).cast(),
                std::mem::size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
        }
        .map_err(|error| io::Error::other(error.to_string()))?;
        drop(file);
        Ok(true)
    }
    #[cfg(not(windows))]
    {
        // Portable fixtures retain the same validation. Production Windows uses
        // handle-based deletion above rather than a pathname after validation.
        match fs::remove_file(path) {
            Ok(()) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        }
    }
}

/// Delete only confirmed names intersecting a newly validated image selection.
/// Invalid input rejects the entire call before mutation; disappeared files are
/// idempotent no-ops, while existing unsafe/locked/read-only files are `failed`.
pub fn clear_image_sidecars(
    image_dir: &Path,
    image_paths: Vec<String>,
    confirmed_files: Vec<String>,
) -> AppResult<ImageSidecarCleanupSummary> {
    if image_paths.len() > MAX_IMAGES || confirmed_files.len() > image_paths.len().saturating_mul(3)
    {
        return Err(invalid(
            "sidecar cleanup selection/confirmation exceeds its budget",
        ));
    }
    let plan = CleanupPlan::new(image_dir, &image_paths)?;
    let targets = plan.confirmed_targets(&confirmed_files)?;
    // Build every output string up front, preserving all-or-nothing validation.
    let targets: Vec<_> = targets
        .into_iter()
        .map(|path| absolute_string(&path).map(|text| (path, text)))
        .collect::<AppResult<_>>()?;
    let mut summary = ImageSidecarCleanupSummary {
        deleted: Vec::new(),
        failed: Vec::new(),
    };
    for (path, text) in targets {
        match remove_confirmed(&plan.scope, &path) {
            Ok(true) => summary.deleted.push(text),
            Ok(false) => {}
            Err(error) => {
                log::warn!(
                    "sidecar cleanup could not remove {}: {error}",
                    path.display()
                );
                summary.failed.push(text);
            }
        }
    }
    Ok(summary)
}
