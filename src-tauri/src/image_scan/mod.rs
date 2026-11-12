//! Image directory scanning + per-image TOML loading.
//!
//! Import prepares same-stem TOML once from JPEG/existing data. IPC projections
//! use the strict prepared readers; only explicit compatibility helpers may
//! lazily decode a missing sidecar. Both preserve the existing `AE_TAG_*` map.

#[cfg(test)]
mod bench;
#[cfg(test)]
mod metadata_pipeline_tests;
mod exif_document;
mod metadata_import;
mod metadata_source;

pub use self::metadata_import::{prepare_image_metadata, merge_image_metadata, replace_image_metadata, ImageMetadataPreparationResult, ImageMetadataPreparationSummary};
mod mtk_exif;
mod natural_order;
pub use self::exif_document::{
    load_image_exif, load_image_exif_with_progress, load_prepared_image_exif, ImageExifDocument, ImageExifModule, ImageExifSource, ImageExifTable,
};

use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
#[cfg(not(windows))]
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use image::{metadata::Orientation, DynamicImage, ImageDecoder, ImageEncoder, Limits};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use self::metadata_source::MetadataSource;

const TOML_CACHE_LIMIT: usize = 96;
const TOML_CACHE_BYTES_LIMIT: usize = 16 * 1024 * 1024;
const TOML_FIELD_CACHE_LIMIT: usize = 512;
const TOML_FIELD_CACHE_BYTES_LIMIT: usize = 8 * 1024 * 1024;
const THUMBNAIL_CACHE_LIMIT: usize = 256;
const PREVIEW_CACHE_LIMIT: usize = 16;
const PREVIEW_SIZE: u32 = 1600;
const HOVER_PREVIEW_CACHE_LIMIT: usize = 8;
const HOVER_PREVIEW_SIZE: u32 = 448;
const MAX_DECODE_ALLOC: u64 = 128 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageEntry {
    /// Stem (no extension).
    pub name:      String,
    pub jpg_path:  String,
    pub toml_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageTomlField {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageTomlSection {
    pub name: String,
    pub fields: Vec<ImageTomlField>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExifParseProgress {
    /// IPC stages mirror src/types/ipc.ts. DP has no reliable tool percentage;
    /// explicit tasks use total=0 there, and count real PREPARE/TOML image work.
    pub stage: &'static str,
    pub completed: usize,
    pub total: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExifParseSummary {
    pub processed: usize,
    pub skipped: usize,
    pub failed: usize,
    pub total: usize,
    /// Images handled by the in-process MTK decoder.
    pub direct: usize,
    /// Images written from an existing/generated DebugParser sidecar.
    pub fallback: usize,
    /// Direct results still missing unsupported modules; import caches preserve fallback eligibility.
    pub partial: usize,
}

struct ParseTempDir(PathBuf);

impl Drop for ParseTempDir {
    fn drop(&mut self) {
        let temp_parent = std::env::temp_dir().canonicalize();
        let target = self.0.canonicalize();
        if let (Ok(parent), Ok(target)) = (temp_parent, target) {
            let named_for_this_task = target.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("luxe-exif-"));
            if target.parent() == Some(parent.as_path()) && named_for_this_task {
                let _ = fs::remove_dir_all(target);
            }
        }
    }
}

struct PendingExifWork {
    entry: ImageEntry,
    sidecar: Option<PathBuf>,
    direct_partial: bool,
    copied_image: Option<PathBuf>,
    direct_written: bool,
}

const MAX_DIRECT_EXIF_BYTES: usize = 16 * 1024 * 1024;

fn read_jpeg_metadata(path: &Path) -> std::io::Result<Vec<u8>> {
    let mut file = std::io::BufReader::with_capacity(64 * 1024, fs::File::open(path)?);
    let invalid = |message| std::io::Error::new(std::io::ErrorKind::InvalidData, message);
    let mut soi = [0u8; 2];
    file.read_exact(&mut soi)?;
    if soi != [0xff, 0xd8] {
        return Err(invalid("not a JPEG"));
    }
    let mut data = Vec::with_capacity(256 * 1024);
    data.extend_from_slice(&soi);
    let mut scanned = 2usize;
    loop {
        let mut byte = [0u8; 1];
        file.read_exact(&mut byte)?;
        scanned += 1;
        if byte[0] != 0xff {
            return Err(invalid("invalid JPEG metadata marker"));
        }
        loop {
            file.read_exact(&mut byte)?;
            scanned += 1;
            if scanned > MAX_DIRECT_EXIF_BYTES {
                return Err(invalid("JPEG metadata exceeds the 16 MiB parser limit"));
            }
            if byte[0] != 0xff { break; }
        }
        let marker = byte[0];
        if marker == 0 {
            return Err(invalid("unexpected stuffed byte in JPEG metadata"));
        }
        if marker == 0x01 || (0xd0..=0xd8).contains(&marker) {
            continue;
        }
        if matches!(marker, 0xda | 0xd9) { data.extend_from_slice(&[0xff, marker]); break; }

        let mut length_bytes = [0u8; 2];
        file.read_exact(&mut length_bytes)?;
        let segment_length = u16::from_be_bytes(length_bytes) as usize;
        if segment_length < 2 { return Err(invalid("invalid JPEG segment length")); }
        scanned = scanned.saturating_add(segment_length);
        if scanned > MAX_DIRECT_EXIF_BYTES {
            return Err(invalid("JPEG metadata exceeds the 16 MiB parser limit"));
        }
        let payload_length = segment_length - 2;
        // Native 3A decoding needs only APP5/6/7. Skip standard EXIF/XMP,
        // embedded thumbnails and quantization/Huffman tables without copying
        // them into the private-metadata buffer. The scanned-byte limit still
        // applies, and a truncated skip fails on the next marker read.
        if !matches!(marker, 0xe5..=0xe7) {
            file.seek_relative(payload_length as i64)?;
            continue;
        }
        data.extend_from_slice(&[0xff, marker]);
        data.extend_from_slice(&length_bytes);
        let payload_start = data.len();
        data.resize(payload_start + payload_length, 0);
        file.read_exact(&mut data[payload_start..])?;
    }
    Ok(data)
}

fn prepared_needs_fallback(path: &Path) -> bool {
    MetadataSource::prepared(path).and_then(|source| source.read_text()).ok()
        .and_then(|text| toml::from_str::<toml::Value>(&text).ok())
        .and_then(|root| root.get("__luxe_exif").and_then(|info| info.get("needs_fallback")).and_then(toml::Value::as_bool))
        .unwrap_or(false)
}

pub fn parse_exif_directory(
    parser_path: Option<&Path>,
    image_dir: &Path,
    mut on_progress: impl FnMut(ExifParseProgress),
) -> AppResult<ExifParseSummary> {
    if !image_dir.is_dir() {
        return Err(AppError::NotFound(format!("image directory: {}", image_dir.display())));
    }
    let entries = scan_directory(image_dir)?;
    if entries.is_empty() {
        return Err(AppError::Invalid("图片文件夹中没有 JPG、JPEG 或 PNG 图片".into()));
    }

    let mut target_counts = HashMap::<String, usize>::new();
    for entry in &entries {
        *target_counts.entry(entry.toml_path.to_ascii_lowercase()).or_default() += 1;
    }
    let pending: Vec<_> = entries
        .iter()
        .filter(|entry| !Path::new(&entry.toml_path).is_file() || prepared_needs_fallback(Path::new(&entry.toml_path)))
        .cloned()
        .collect();
    let total = pending.len();
    let can_fallback = parser_path.is_some_and(Path::is_file);
    let mut summary = ExifParseSummary {
        processed: 0,
        skipped: entries.len() - total,
        failed: 0,
        total: entries.len(),
        direct: 0,
        fallback: 0,
        partial: 0,
    };

    on_progress(ExifParseProgress { stage: "EXIF", completed: 0, total });
    let temp_root = if can_fallback && total > 0 {
        let root = std::env::temp_dir().join(format!(
            "luxe-exif-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos(),
        ));
        fs::create_dir(&root)?;
        Some(root)
    } else {
        None
    };
    let _temp_guard = temp_root.clone().map(ParseTempDir);

    let mut work = Vec::with_capacity(total);
    for (index, entry) in pending.into_iter().enumerate() {
        let image_path = PathBuf::from(&entry.jpg_path);
        let sidecar = PathBuf::from(format!("{}.exif", entry.jpg_path));
        let mut item = PendingExifWork {
            entry,
            sidecar: sidecar.is_file().then_some(sidecar),
            direct_partial: false,
            copied_image: None,
            direct_written: false,
        };
        if target_counts.get(&item.entry.toml_path.to_ascii_lowercase()).copied().unwrap_or(0) > 1 {
            tracing::warn!(path = %image_path.display(), "ambiguous image metadata stem; not exporting a guessed sidecar");
            item.sidecar = None;
            work.push(item);
            on_progress(ExifParseProgress { stage: "EXIF", completed: index + 1, total });
            continue;
        }

        if Path::new(&item.entry.toml_path).is_file() {
            // Import has already inspected the JPEG, even for partial/native
            // or metadata-only files. DP is last resort, not a second decoder pass.
            item.direct_partial = MetadataSource::prepared(Path::new(&item.entry.toml_path))
                .and_then(|source| source.read_text()).ok()
                .and_then(|text| toml::from_str::<toml::Value>(&text).ok())
                .and_then(|root| metadata_import::read_preparation(&root))
                .is_some_and(|info| info.selected_source == "jpeg");
            if item.sidecar.is_none() {
                if let Some(root) = temp_root.as_ref() {
                    item.copied_image = copy_fallback_image(root, &image_path, index);
                }
            }
            work.push(item);
            on_progress(ExifParseProgress { stage: "EXIF", completed: index + 1, total });
            continue;
        }

        let direct_result = read_jpeg_metadata(&image_path)
            .map_err(AppError::from)
            .and_then(|data| mtk_exif::decode_to_toml(&data).map_err(AppError::Other));

        match direct_result {
            Ok(output) if output.needs_fallback => {
                // Supported tags remain available through the lazy JPEG reader.
                // Never write a partial sidecar that would mask a later DP retry.
                item.direct_partial = true;
                if item.sidecar.is_none() {
                    if let Some(root) = temp_root.as_ref() {
                        item.copied_image = copy_fallback_image(root, &image_path, index);
                    }
                }
            }
            Ok(output) => {
                tracing::debug!(path = %image_path.display(), bytes = output.toml.len(), "direct MTK EXIF decoded");
                let export = exif_document::stamp_export(&output.toml, "native", output.modules, false);
                if let Err(error) = export.and_then(|contents| write_toml_atomic(Path::new(&item.entry.toml_path), &contents).map_err(AppError::from)) {
                    tracing::warn!(path = %item.entry.toml_path, %error, "write direct image TOML failed");
                } else {
                    item.direct_written = true;
                }
            }
            Err(error) => {
                tracing::debug!(path = %image_path.display(), %error, "direct MTK EXIF decode unavailable");
                if item.sidecar.is_none() && can_fallback {
                    if let Some(root) = temp_root.as_ref() {
                        item.copied_image = copy_fallback_image(root, &image_path, index);
                    }
                }
            }
        }
        work.push(item);
        on_progress(ExifParseProgress { stage: "EXIF", completed: index + 1, total });
    }

    let fallback_items = work.iter().filter(|item| item.copied_image.is_some()).count();
    if fallback_items > 0 {
        on_progress(ExifParseProgress { stage: "DP", completed: 0, total: fallback_items });
        let root = temp_root.as_ref().expect("fallback work requires a temp directory");
        let parser = parser_path.expect("fallback work requires a parser path");
        match spawn_debug_parser(parser, root) {
            Ok(mut child) => loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        if !status.success() {
                            tracing::warn!(%status, "DebugParser failed");
                        }
                        break;
                    }
                    Ok(None) => thread::sleep(Duration::from_millis(250)),
                    Err(error) => {
                        tracing::warn!(%error, "DebugParser wait failed");
                        let _ = child.wait();
                        break;
                    }
                }
            },
            Err(error) => tracing::warn!(%error, "DebugParser launch failed"),
        }
        on_progress(ExifParseProgress { stage: "DP", completed: fallback_items, total: fallback_items });
    }

    on_progress(ExifParseProgress { stage: "TOML", completed: 0, total });
    for (index, item) in work.into_iter().enumerate() {
        if item.direct_written {
            summary.processed += 1;
            summary.direct += 1;
        } else {
            let sidecar = item.sidecar.or_else(|| item.copied_image
                .map(|image| PathBuf::from(format!("{}.exif", image.display()))));
            let contents = match sidecar.as_ref().map(|path| exif_to_toml(path)) {
                Some(Ok(contents)) => contents,
                Some(Err(error)) => {
                    tracing::warn!(path = %item.entry.jpg_path, %error, "read EXIF fallback failed");
                    None
                }
                None => None,
            };
            if let Some(contents) = contents {
                match metadata_import::replace_debug_parser_metadata(Path::new(&item.entry.jpg_path), Path::new(&item.entry.toml_path), &contents) {
                    Ok(true) => {
                        summary.processed += 1;
                        summary.fallback += 1;
                    }
                    Ok(false) if item.direct_partial => {
                        summary.processed += 1;
                        summary.direct += 1;
                        summary.partial += 1;
                    }
                    Ok(false) => summary.failed += 1,
                    Err(error) => {
                        tracing::warn!(path = %item.entry.toml_path, %error, "write image TOML failed");
                        summary.failed += 1;
                    }
                }
            } else if item.direct_partial {
                summary.processed += 1;
                summary.direct += 1;
                summary.partial += 1;
            } else {
                summary.failed += 1;
            }
        }
        on_progress(ExifParseProgress { stage: "TOML", completed: index + 1, total });
    }
    Ok(summary)
}

/// Explicit left-click action: run the configured tool on fresh temporary
/// copies and replace TOML with that run's payload. No native decode or reuse
/// of a stale `.jpg.exif` from the user's directory is permitted here.
pub fn parse_debug_parser_directory(
    parser_path: Option<&Path>, image_dir: &Path, on_progress: impl FnMut(ExifParseProgress),
) -> AppResult<ExifParseSummary> {
    parse_debug_parser_directory_with(parser_path, image_dir, on_progress, |parser, root| {
        let mut child = spawn_debug_parser(parser, root)?;
        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => return Ok(()),
                Ok(Some(status)) => return Err(AppError::Other(format!("DebugParser exited with {status}"))),
                Ok(None) => thread::sleep(Duration::from_millis(100)),
                Err(error) => { let _ = child.wait(); return Err(error.into()); }
            }
        }
    })
}

fn parse_debug_parser_directory_with(
    parser_path: Option<&Path>, image_dir: &Path, mut on_progress: impl FnMut(ExifParseProgress),
    mut run_parser: impl FnMut(&Path, &Path) -> AppResult<()>,
) -> AppResult<ExifParseSummary> {
    let started = std::time::Instant::now();
    let parser = parser_path.filter(|path| path.is_file())
        .ok_or_else(|| AppError::Invalid("DebugParser executable is required for explicit overwrite".into()))?;
    on_progress(ExifParseProgress { stage: "PREPARE", completed: 0, total: 0 });
    let writer = metadata_import::DebugParserMetadataWriter::new(image_dir)?;
    let entries = scan_directory(image_dir)?;
    if entries.is_empty() { return Err(AppError::Invalid("no images to parse".into())); }
    let total = entries.len();
    let root = std::env::temp_dir().join(format!("luxe-exif-{}-{}", std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()));
    fs::create_dir(&root)?;
    let _guard = ParseTempDir(root.clone());
    let mut summary = ExifParseSummary { processed: 0, skipped: 0, failed: 0, total, direct: 0, fallback: 0, partial: 0 };
    let mut work = Vec::with_capacity(total);
    on_progress(ExifParseProgress { stage: "PREPARE", completed: 0, total });
    for (index, entry) in entries.into_iter().enumerate() {
        let image = Path::new(&entry.jpg_path);
        let target = Path::new(&entry.toml_path);
        let Some(filename) = image.file_name() else {
            summary.failed += 1;
            on_progress(ExifParseProgress { stage: "PREPARE", completed: index + 1, total });
            continue;
        };
        let copied = root.join(filename);
        match writer.copy_for_parser(image, target, &copied) {
            Ok(snapshot) => work.push((entry, copied, snapshot)),
            Err(error) => { tracing::warn!(path = %entry.jpg_path, %error, "DP overwrite copy/preflight rejected"); summary.failed += 1; }
        }
        on_progress(ExifParseProgress { stage: "PREPARE", completed: index + 1, total });
    }
    if !work.is_empty() {
        // This runner receives neither a per-image callback nor a reliable
        // tool percentage. Keep this phase indeterminate, not simulated 0/N.
        on_progress(ExifParseProgress { stage: "DP", completed: 0, total: 0 });
        if let Err(error) = run_parser(parser, &root) {
            tracing::warn!(%error, "DP overwrite process failed");
            summary.failed += work.len();
            return Ok(summary);
        }
    }
    on_progress(ExifParseProgress { stage: "TOML", completed: summary.failed, total });
    for (entry, copied, snapshot) in work {
        let sidecar = PathBuf::from(format!("{}.exif", copied.display()));
        // Sidecars live only in the newly created directory. Refuse links or
        // nested output paths rather than treating tool output as trusted IO.
        let result = fs::symlink_metadata(&sidecar).map_err(AppError::from).and_then(|metadata| {
            let mut unsafe_output = !metadata.is_file() || metadata.file_type().is_symlink();
            #[cfg(windows)] {
                use std::os::windows::fs::MetadataExt;
                unsafe_output |= metadata.file_attributes() & 0x400 != 0;
            }
            #[cfg(not(windows))] { let _ = &mut unsafe_output; }
            if unsafe_output { return Err(AppError::Invalid("unsafe DebugParser output".into())); }
            snapshot.recheck(Path::new(&entry.jpg_path))?;
            let text = exif_to_toml(&sidecar)?.ok_or_else(|| AppError::Invalid("DebugParser produced no usable fields".into()))?;
            writer.replace(Path::new(&entry.jpg_path), Path::new(&entry.toml_path), &text)
        });
        match result {
            Ok(true) => { summary.processed += 1; summary.fallback += 1; }
            Ok(false) => summary.failed += 1,
            Err(error) => { tracing::warn!(path = %entry.toml_path, %error, "DP overwrite failed; original retained"); summary.failed += 1; }
        }
        on_progress(ExifParseProgress { stage: "TOML", completed: summary.processed + summary.failed, total });
    }
    if summary.processed > 0 { clear_memory_caches(); }
    tracing::info!(total, written = summary.processed, failed = summary.failed, elapsed_ms = started.elapsed().as_millis() as u64, "explicit DP overwrite complete");
    Ok(summary)
}

fn copy_fallback_image(root: &Path, source: &Path, index: usize) -> Option<PathBuf> {
    let filename = source.file_name()?.to_owned();
    let mut target = root.join(&filename);
    if target.exists() {
        target = root.join(format!("{index:06}_{}", filename.to_string_lossy()));
    }
    match fs::copy(source, &target) {
        Ok(_) => Some(target),
        Err(error) => {
            tracing::warn!(path = %source.display(), %error, "copy image for DebugParser fallback failed");
            None
        }
    }
}

fn write_toml_atomic(path: &Path, contents: &str) -> std::io::Result<()> {
    let filename = path.file_name().and_then(|value| value.to_str()).unwrap_or("image.toml");
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = path.with_file_name(format!(".{filename}.luxe-{}-{nonce}-{}.tmp", std::process::id(), next_cache_tick()));
    if let Err(error) = fs::write(&temporary, contents) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    match fs::rename(&temporary, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(error)
        }
    }
}

#[cfg(not(windows))]
fn spawn_debug_parser(parser_path: &Path, image_dir: &Path) -> std::io::Result<std::process::Child> {
    Command::new(parser_path).arg("-dump").arg(image_dir)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
}

#[cfg(windows)]
struct HiddenParserProcess(std::os::windows::io::OwnedHandle);

#[cfg(windows)]
impl HiddenParserProcess {
    fn try_wait(&mut self) -> std::io::Result<Option<std::process::ExitStatus>> {
        use std::os::windows::io::AsRawHandle;
        use std::os::windows::process::ExitStatusExt;
        use windows::Win32::Foundation::{HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT};
        use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};

        let handle = HANDLE(self.0.as_raw_handle());
        match unsafe { WaitForSingleObject(handle, 0) } {
            WAIT_TIMEOUT => Ok(None),
            WAIT_OBJECT_0 => {
                let mut code = 0;
                unsafe { GetExitCodeProcess(handle, &mut code) }
                    .map_err(|error| std::io::Error::other(error.to_string()))?;
                Ok(Some(std::process::ExitStatus::from_raw(code)))
            }
            _ => Err(std::io::Error::last_os_error()),
        }
    }

    fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        loop {
            if let Some(status) = self.try_wait()? { return Ok(status); }
            thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(windows)]
fn spawn_debug_parser(parser_path: &Path, image_dir: &Path) -> std::io::Result<HiddenParserProcess> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{FromRawHandle, OwnedHandle};
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::System::Threading::{
        CreateProcessW, CREATE_NO_WINDOW, PROCESS_INFORMATION, STARTF_USESHOWWINDOW, STARTUPINFOW,
    };

    let application: Vec<u16> = parser_path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut command_line: Vec<u16> = [b'"' as u16].into_iter()
        .chain(parser_path.as_os_str().encode_wide())
        .chain("\" -dump \"".encode_utf16())
        .chain(image_dir.as_os_str().encode_wide())
        .chain([b'"' as u16, 0])
        .collect();
    let mut startup = STARTUPINFOW::default();
    startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
    startup.dwFlags = STARTF_USESHOWWINDOW;
    startup.wShowWindow = 0; // SW_HIDE
    let mut process = PROCESS_INFORMATION::default();
    unsafe {
        CreateProcessW(
            PCWSTR(application.as_ptr()), Some(PWSTR(command_line.as_mut_ptr())),
            None, None, false, CREATE_NO_WINDOW, None, PCWSTR::null(), &startup, &mut process,
        )
    }.map_err(|error| std::io::Error::other(error.to_string()))?;
    let _thread = unsafe { OwnedHandle::from_raw_handle(process.hThread.0) };
    Ok(HiddenParserProcess(unsafe { OwnedHandle::from_raw_handle(process.hProcess.0) }))
}

fn exif_to_toml(path: &Path) -> AppResult<Option<String>> {
    if !path.is_file() {
        return Ok(None);
    }
    let text = MetadataSource::resolve(path)?.read_text()?;
    exif_document::debug_parser_to_toml(&text)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct TomlSignature {
    len:      u64,
    modified: Option<SystemTime>,
}

struct CachedToml {
    signature: TomlSignature,
    data:      HashMap<String, String>,
    bytes: usize,
    last_used: AtomicU64,
}

struct CachedTomlFields {
    signature: TomlSignature,
    data:      HashMap<String, String>,
    bytes: usize,
    last_used: AtomicU64,
}

struct CachedThumbnail {
    signature: TomlSignature,
    path:      String,
    last_used: AtomicU64,
}

struct EncodedThumbnail {
    bytes:     Vec<u8>,
    extension: &'static str,
}

static TOML_CACHE: Lazy<DashMap<String, Arc<CachedToml>>> = Lazy::new(DashMap::new);
static TOML_FIELD_CACHE: Lazy<DashMap<String, Arc<CachedTomlFields>>> = Lazy::new(DashMap::new);
static THUMBNAIL_CACHE: Lazy<DashMap<String, Arc<CachedThumbnail>>> = Lazy::new(DashMap::new);
static PREVIEW_CACHE: Lazy<DashMap<String, Arc<CachedThumbnail>>> = Lazy::new(DashMap::new);
static HOVER_PREVIEW_CACHE: Lazy<DashMap<String, Arc<CachedThumbnail>>> = Lazy::new(DashMap::new);
static CACHE_TICK: AtomicU64 = AtomicU64::new(1);
static CACHE_GENERATION: AtomicU64 = AtomicU64::new(1);
static CACHE_WRITE_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
static ACTIVE_IMAGE_DIR: Lazy<Mutex<Option<PathBuf>>> = Lazy::new(|| Mutex::new(None));
static THUMBNAIL_POOL: Lazy<rayon::ThreadPool> = Lazy::new(|| {
    rayon::ThreadPoolBuilder::new()
        .num_threads(2)
        .thread_name(|index| format!("luxe-thumbnail-{index}"))
        .build()
        .expect("thumbnail rayon pool must initialize")
});

pub fn clear_memory_caches() {
    let _write = CACHE_WRITE_LOCK.lock();
    CACHE_GENERATION.fetch_add(1, Ordering::AcqRel);
    TOML_CACHE.clear();
    TOML_FIELD_CACHE.clear();
    THUMBNAIL_CACHE.clear();
    PREVIEW_CACHE.clear();
    HOVER_PREVIEW_CACHE.clear();
}

/// Scan `dir` for image files (`.jpg`, `.jpeg`, `.png`). A sibling `.toml`
/// with the same stem is used when present; otherwise its expected path is
/// retained so the UI can show the image with placeholder values.
pub fn scan_directory(dir: &Path) -> AppResult<Vec<ImageEntry>> {
    clear_runtime_caches_if_dir_changed(dir);

    let mut images: Vec<(String, PathBuf)> = Vec::new();
    let mut tomls: HashMap<String, PathBuf> = HashMap::new();

    for entry in fs::read_dir(dir)? {
        let Ok(entry) = entry else { continue };
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_file() { continue; }

        let p = entry.path();
        let Some(ext) = p.extension().and_then(|s| s.to_str()) else { continue };
        let Some(stem) = p.file_stem().and_then(|s| s.to_str()) else { continue };

        match ext.to_ascii_lowercase().as_str() {
            "jpg" | "jpeg" | "png" => images.push((stem.to_string(), p)),
            "toml" => {
                tomls.entry(stem.to_string()).or_insert(p);
            }
            _ => {}
        }
    }

    let mut entries = Vec::new();
    for (stem, jpg_path) in images {
        let toml_path = tomls
            .get(&stem)
            .cloned()
            .unwrap_or_else(|| jpg_path.with_extension("toml"));
        entries.push(ImageEntry {
            name:      stem,
            jpg_path:  jpg_path.to_string_lossy().into_owned(),
            toml_path: toml_path.to_string_lossy().into_owned(),
        });
    }
    entries.sort_by(|a, b| {
        natural_order::compare_names(&a.name, &b.name)
            .then_with(|| a.jpg_path.cmp(&b.jpg_path))
    });
    Ok(entries)
}

fn clear_runtime_caches_if_dir_changed(dir: &Path) {
    let next_dir = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    let mut active = ACTIVE_IMAGE_DIR.lock();
    if active.as_ref() == Some(&next_dir) {
        return;
    }

    clear_memory_caches();
    let _ = fs::remove_dir_all(thumbnail_cache_dir());
    *active = Some(next_dir);
}

fn next_cache_tick() -> u64 {
    CACHE_TICK.fetch_add(1, Ordering::Relaxed)
}

fn prune_cache<T>(
    cache: &DashMap<String, Arc<T>>,
    limit: usize,
    last_used: impl Fn(&T) -> u64,
) {
    if cache.len() <= limit {
        return;
    }

    let mut entries: Vec<(String, u64)> = cache
        .iter()
        .map(|entry| (entry.key().clone(), last_used(entry.value().as_ref())))
        .collect();
    if entries.len() <= limit {
        return;
    }

    entries.sort_by_key(|(_, used)| *used);
    let remove_count = entries.len().saturating_sub(limit);
    for (key, _) in entries.into_iter().take(remove_count) {
        cache.remove(&key);
    }
}

fn metadata_map_bytes(data: &HashMap<String, String>) -> usize {
    data.capacity().saturating_mul(std::mem::size_of::<(String, String)>() + 1)
        .saturating_add(data.iter().map(|(key, value)| key.capacity() + value.capacity()).sum::<usize>())
}

fn prune_metadata_cache<T>(
    cache: &DashMap<String, Arc<T>>,
    limit: usize,
    budget: usize,
    describe: impl Fn(&T) -> (u64, usize),
) {
    let mut entries: Vec<_> = cache.iter().map(|entry| {
        let (used, bytes) = describe(entry.value().as_ref());
        (entry.key().clone(), used, bytes)
    }).collect();
    let mut count = entries.len();
    let mut bytes = entries.iter().map(|(_, _, bytes)| *bytes).sum::<usize>();
    if count <= limit && bytes <= budget { return; }
    entries.sort_by_key(|(_, used, _)| *used);
    for (key, _, size) in entries {
        if count <= limit && bytes <= budget { break; }
        cache.remove(&key);
        count = count.saturating_sub(1);
        bytes = bytes.saturating_sub(size);
    }
}

/// Load a sidecar, or lazily decode a sibling JPEG when the sidecar is absent.
/// The logical path and the existing key/value IPC contract stay unchanged.
///
/// Flattening rules (mirrors hiz `_flatten_toml_items`):
/// - For every nested map node, walk recursively and record leaves.
/// - For every leaf, record BOTH the dotted path AND the bare leaf name —
///   that way `AE_TAG_FOO` resolves whether the TOML places it at top level
///   or under a section like `[hw_status]`.
/// - Arrays are joined with ", " (so the value is a single string just like
///   the Python flattener returns).
pub fn load_image_toml(path: &Path) -> AppResult<HashMap<String, String>> {
    load_image_toml_with_progress(path, |_| {})
}

pub fn load_image_toml_with_progress(
    path: &Path, on_progress: impl FnMut(ExifParseProgress),
) -> AppResult<HashMap<String, String>> {
    load_metadata_map(path, MetadataSource::resolve(path)?, on_progress)
}

/// UI entry: never decode a JPEG implicitly after import.
pub fn load_prepared_image_toml(path: &Path) -> AppResult<HashMap<String, String>> {
    load_metadata_map(path, MetadataSource::prepared(path)?, |_| {})
}

fn load_metadata_map(
    path: &Path, source: MetadataSource, mut on_progress: impl FnMut(ExifParseProgress),
) -> AppResult<HashMap<String, String>> {
    let generation = CACHE_GENERATION.load(Ordering::Acquire);
    let cache_key = format!("{}\0{}", path.to_string_lossy(), source.cache_identity());
    let signature = toml_signature(source.path())?;

    if let Some(cached) = TOML_CACHE.get(&cache_key) {
        if cached.signature == signature {
            cached.last_used.store(next_cache_tick(), Ordering::Relaxed);
            on_progress(source.progress(source.progress_total()));
            return Ok(cached.data.clone());
        }
    }

    let text = source.read_text_with_progress(&mut on_progress)?;
    let root: toml::Value = toml::from_str(&text)?;
    let mut data = HashMap::new();
    walk(&root, "", &mut data);
    on_progress(source.progress(source.progress_total()));
    let _write = CACHE_WRITE_LOCK.lock();
    if generation != CACHE_GENERATION.load(Ordering::Acquire) {
        return Ok(data);
    }
    TOML_CACHE.insert(
        cache_key,
        Arc::new(CachedToml {
            signature,
            bytes: metadata_map_bytes(&data),
            data: data.clone(),
            last_used: AtomicU64::new(next_cache_tick()),
        }),
    );
    prune_metadata_cache(&TOML_CACHE, TOML_CACHE_LIMIT, TOML_CACHE_BYTES_LIMIT, |entry| {
        (entry.last_used.load(Ordering::Relaxed), entry.bytes)
    });
    Ok(data)
}

pub fn load_image_toml_batch(paths: Vec<String>) -> AppResult<HashMap<String, HashMap<String, String>>> {
    metadata_map_batch(paths, false)
}

pub fn load_prepared_image_toml_batch(paths: Vec<String>) -> AppResult<HashMap<String, HashMap<String, String>>> {
    metadata_map_batch(paths, true)
}

fn metadata_map_batch(paths: Vec<String>, prepared_only: bool) -> AppResult<HashMap<String, HashMap<String, String>>> {
    let mut out = HashMap::with_capacity(paths.len());

    for path in paths {
        if out.contains_key(&path) {
            continue;
        }

        let data = if prepared_only { load_prepared_image_toml(Path::new(&path)) } else { load_image_toml(Path::new(&path)) };
        match data {
            Ok(data) => {
                out.insert(path, data);
            }
            Err(err) => {
                tracing::warn!(%path, %err, "image TOML batch item failed");
                out.insert(path, HashMap::new());
            }
        }
    }

    Ok(out)
}

pub fn load_image_toml_fields_batch(
    paths: Vec<String>, keys: Vec<String>,
) -> AppResult<HashMap<String, HashMap<String, String>>> {
    metadata_fields_batch(paths, keys, false)
}

pub fn load_prepared_image_toml_fields_batch(
    paths: Vec<String>, keys: Vec<String>,
) -> AppResult<HashMap<String, HashMap<String, String>>> {
    metadata_fields_batch(paths, keys, true)
}

fn metadata_fields_batch(
    paths: Vec<String>, keys: Vec<String>, prepared_only: bool,
) -> AppResult<HashMap<String, HashMap<String, String>>> {
    let request_keys: Vec<String> = keys
        .into_iter()
        .filter(|key| !key.is_empty())
        .collect();
    let key_lookup = selected_key_lookup(&request_keys);
    let key_signature = request_keys.join("\u{1f}");
    let mut seen = HashSet::with_capacity(paths.len());
    let mut unique_paths = Vec::with_capacity(paths.len());
    for path in paths {
        if seen.insert(path.clone()) {
            unique_paths.push(path);
        }
    }

    // The command layer already bounds concurrent batches. Keep each batch
    // single threaded so two overlapping UI requests cannot oversubscribe the
    // worker pool while repeatedly reading the same sidecar files.
    let out = unique_paths
        .iter()
        .map(|path| {
            (
                path.clone(),
                load_image_toml_fields_for_batch(path, &key_lookup, &key_signature, prepared_only),
            )
        })
        .collect();
    Ok(out)
}

fn load_image_toml_fields_for_batch(
    path: &str,
    key_lookup: &HashMap<String, String>,
    key_signature: &str,
    prepared_only: bool,
) -> HashMap<String, String> {
    match load_image_toml_fields(Path::new(path), key_lookup, key_signature, prepared_only) {
        Ok(data) => data,
        Err(err) => {
            tracing::warn!(%path, %err, "image TOML field batch item failed");
            HashMap::new()
        }
    }
}

fn load_image_toml_fields(
    path: &Path,
    key_lookup: &HashMap<String, String>,
    key_signature: &str,
    prepared_only: bool,
) -> AppResult<HashMap<String, String>> {
    let generation = CACHE_GENERATION.load(Ordering::Acquire);
    if key_lookup.is_empty() {
        return Ok(HashMap::new());
    }

    let source = if prepared_only { MetadataSource::prepared(path)? } else { MetadataSource::resolve(path)? };
    let path_key = path.to_string_lossy().into_owned();
    let cache_key = format!("{path_key}\0{}\0{key_signature}", source.cache_identity());
    let signature = toml_signature(source.path())?;

    if let Some(cached) = TOML_FIELD_CACHE.get(&cache_key) {
        if cached.signature == signature {
            cached.last_used.store(next_cache_tick(), Ordering::Relaxed);
            return Ok(cached.data.clone());
        }
    }

    // The selected image may already have a full map. Reuse only the requested
    // fields without cloning that map or decoding its JPEG a second time.
    let full_cache_key = format!("{path_key}\0{}", source.cache_identity());
    let cached_fields = TOML_CACHE.get(&full_cache_key).and_then(|cached| {
        if cached.signature != signature { return None; }
        cached.last_used.store(next_cache_tick(), Ordering::Relaxed);
        Some(key_lookup.iter().filter_map(|(normalized, requested)| {
            cached.data.get(normalized).map(|value| (requested.clone(), value.clone()))
        }).collect::<HashMap<String, String>>())
    });
    let data = match cached_fields {
        Some(data) => data,
        None => parse_image_toml_fields(&source, key_lookup)?,
    };
    let _write = CACHE_WRITE_LOCK.lock();
    if generation != CACHE_GENERATION.load(Ordering::Acquire) {
        return Ok(data);
    }
    TOML_FIELD_CACHE.insert(
        cache_key,
        Arc::new(CachedTomlFields {
            signature,
            bytes: metadata_map_bytes(&data),
            data: data.clone(),
            last_used: AtomicU64::new(next_cache_tick()),
        }),
    );
    prune_metadata_cache(&TOML_FIELD_CACHE, TOML_FIELD_CACHE_LIMIT, TOML_FIELD_CACHE_BYTES_LIMIT, |entry| {
        (entry.last_used.load(Ordering::Relaxed), entry.bytes)
    });
    Ok(data)
}

pub fn load_image_thumbnail_batch(
    paths: Vec<String>,
    size: u32,
    fast_only: bool,
) -> AppResult<HashMap<String, String>> {
    let size = size.clamp(16, 128);
    let unique_paths: Vec<String> = paths.into_iter().collect::<HashSet<_>>().into_iter().collect();
    let process = || {
        unique_paths.par_iter().map(|path| {
            let value = match load_image_thumbnail(Path::new(path), size, fast_only) {
                Ok(data_url) => data_url,
                Err(err) => {
                    tracing::warn!(%path, %err, "image thumbnail batch item failed");
                    String::new()
                }
            };
            (path.clone(), value)
        }).collect::<HashMap<_, _>>()
    };
    Ok(if unique_paths.len() > 1 { THUMBNAIL_POOL.install(process) } else { process() })
}

pub fn load_image_preview(path: &Path) -> AppResult<String> {
    load_cached_preview(path, PREVIEW_SIZE, &PREVIEW_CACHE, PREVIEW_CACHE_LIMIT, true)
}

pub fn load_image_hover_preview(path: &Path) -> AppResult<String> {
    load_cached_preview(path, HOVER_PREVIEW_SIZE, &HOVER_PREVIEW_CACHE, HOVER_PREVIEW_CACHE_LIMIT, false)
}

fn load_cached_preview(
    path: &Path,
    size: u32,
    cache: &DashMap<String, Arc<CachedThumbnail>>,
    limit: usize,
    allow_platform_thumbnail: bool,
) -> AppResult<String> {
    let generation = CACHE_GENERATION.load(Ordering::Acquire);
    let signature = toml_signature(path)?;
    let key = path.to_string_lossy().into_owned();
    if let Some(cached) = cache.get(&key) {
        if cached.signature == signature && Path::new(&cached.path).exists() {
            cached.last_used.store(next_cache_tick(), Ordering::Relaxed);
            return Ok(cached.path.clone());
        }
    }

    let encoded = generate_image_thumbnail(path, size, false, allow_platform_thumbnail)?;
    let preview_path = write_thumbnail_cache_file(path, size, false, &signature, encoded)?;
    let _write = CACHE_WRITE_LOCK.lock();
    if generation != CACHE_GENERATION.load(Ordering::Acquire) {
        return Ok(preview_path);
    }
    let replaced = cache.insert(key, Arc::new(CachedThumbnail {
        signature,
        path: preview_path.clone(),
        last_used: AtomicU64::new(next_cache_tick()),
    }));
    if let Some(old) = replaced {
        if old.path != preview_path {
            let _ = fs::remove_file(&old.path);
        }
    }
    prune_preview_cache(cache, limit);
    Ok(preview_path)
}

fn prune_preview_cache(cache: &DashMap<String, Arc<CachedThumbnail>>, limit: usize) {
    if cache.len() <= limit { return; }
    let mut entries: Vec<_> = cache.iter()
        .map(|entry| (entry.key().clone(), entry.last_used.load(Ordering::Relaxed)))
        .collect();
    entries.sort_by_key(|(_, used)| *used);
    for (key, _) in entries.into_iter().take(cache.len().saturating_sub(limit)) {
        if let Some((_, cached)) = cache.remove(&key) {
            let _ = fs::remove_file(&cached.path);
        }
    }
}

fn toml_signature(path: &Path) -> AppResult<TomlSignature> {
    let meta = fs::metadata(path)?;
    Ok(TomlSignature {
        len:      meta.len(),
        modified: meta.modified().ok(),
    })
}

fn load_image_thumbnail(path: &Path, size: u32, fast_only: bool) -> AppResult<String> {
    let generation = CACHE_GENERATION.load(Ordering::Acquire);
    let cache_key = format!(
        "{}\0{size}\0{}",
        if fast_only { "fast" } else { "full" },
        path.to_string_lossy(),
    );
    let full_cache_key = format!("full\0{size}\0{}", path.to_string_lossy());
    let signature = toml_signature(path)?;

    if fast_only {
        if let Some(cached) = THUMBNAIL_CACHE.get(&full_cache_key) {
            if cached.signature == signature && (cached.path.is_empty() || Path::new(&cached.path).exists()) {
                cached.last_used.store(next_cache_tick(), Ordering::Relaxed);
                return Ok(cached.path.clone());
            }
        }
    }

    if let Some(cached) = THUMBNAIL_CACHE.get(&cache_key) {
        if cached.signature == signature && (cached.path.is_empty() || Path::new(&cached.path).exists()) {
            cached.last_used.store(next_cache_tick(), Ordering::Relaxed);
            return Ok(cached.path.clone());
        }
    }

    let Some(encoded) = (if fast_only {
        embedded_thumbnail_data_url_from_jpeg_file(path, size)
            .or_else(|| platform_thumbnail_data_url(path, size))
    } else {
        Some(generate_image_thumbnail(path, size, true, true)?)
    }) else {
        let _write = CACHE_WRITE_LOCK.lock();
        if generation == CACHE_GENERATION.load(Ordering::Acquire) {
            THUMBNAIL_CACHE.insert(
                cache_key,
                Arc::new(CachedThumbnail {
                    signature,
                    path: String::new(),
                    last_used: AtomicU64::new(next_cache_tick()),
                }),
            );
            prune_cache(&THUMBNAIL_CACHE, THUMBNAIL_CACHE_LIMIT, |entry| {
                entry.last_used.load(Ordering::Relaxed)
            });
        }
        return Ok(String::new());
    };

    let thumb_path = write_thumbnail_cache_file(path, size, fast_only, &signature, encoded)?;
    let _write = CACHE_WRITE_LOCK.lock();
    if generation != CACHE_GENERATION.load(Ordering::Acquire) {
        return Ok(thumb_path);
    }
    THUMBNAIL_CACHE.insert(
        cache_key,
        Arc::new(CachedThumbnail {
            signature,
            path: thumb_path.clone(),
            last_used: AtomicU64::new(next_cache_tick()),
        }),
    );
    prune_cache(&THUMBNAIL_CACHE, THUMBNAIL_CACHE_LIMIT, |entry| {
        entry.last_used.load(Ordering::Relaxed)
    });
    Ok(thumb_path)
}

fn write_thumbnail_cache_file(
    path: &Path,
    size: u32,
    fast_only: bool,
    signature: &TomlSignature,
    encoded: EncodedThumbnail,
) -> AppResult<String> {
    let dir = thumbnail_cache_dir();
    fs::create_dir_all(&dir)?;

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.to_string_lossy().hash(&mut hasher);
    size.hash(&mut hasher);
    fast_only.hash(&mut hasher);
    signature.len.hash(&mut hasher);
    signature_modified_key(signature).hash(&mut hasher);
    encoded.extension.hash(&mut hasher);

    let file_path = dir.join(format!("{:016x}.{}", hasher.finish(), encoded.extension));
    if !file_path.exists() {
        fs::write(&file_path, encoded.bytes)?;
    }
    Ok(file_path.to_string_lossy().into_owned())
}

fn thumbnail_cache_dir() -> PathBuf {
    std::env::temp_dir().join("luxe-tauri").join("image-thumbnails")
        .join(std::process::id().to_string())
}

fn signature_modified_key(signature: &TomlSignature) -> u128 {
    signature
        .modified
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

fn generate_image_thumbnail(
    path: &Path,
    size: u32,
    allow_embedded: bool,
    allow_platform_thumbnail: bool,
) -> AppResult<EncodedThumbnail> {
    if allow_embedded {
        if let Some(thumbnail) = embedded_thumbnail_data_url_from_jpeg_file(path, size) {
            return Ok(thumbnail);
        }
    }
    if allow_platform_thumbnail {
        if let Some(data_url) = platform_thumbnail_data_url(path, size) {
            return Ok(data_url);
        }
    }

    if is_jpeg_path(path) {
        let orientation = read_image_orientation(path).unwrap_or(Orientation::NoTransforms);
        if let Ok(encoded) = generate_turbojpeg_thumbnail(path, size, orientation) {
            return Ok(encoded);
        }
    }

    let reader = image::ImageReader::open(path)?;
    let mut decoder = reader
        .with_guessed_format()?
        .into_decoder()
        .map_err(|err| AppError::Other(format!("thumbnail decode error: {err}")))?;
    let mut decode_limits = Limits::default();
    decode_limits.max_image_width = Some(16_000);
    decode_limits.max_image_height = Some(16_000);
    decode_limits.max_alloc = Some(MAX_DECODE_ALLOC);
    decoder
        .set_limits(decode_limits)
        .map_err(|err| AppError::Other(format!("thumbnail decode limits exceeded: {err}")))?;
    let exif = decoder
        .exif_metadata()
        .map_err(|err| AppError::Other(format!("thumbnail EXIF read error: {err}")))?;
    let orientation = decoder
        .orientation()
        .map_err(|err| AppError::Other(format!("thumbnail orientation error: {err}")))?;
    if allow_embedded {
        if let Some(exif) = exif.as_deref() {
            if let Some(thumbnail) = embedded_thumbnail_data_url(exif, orientation, size) {
                return Ok(thumbnail);
            }
        }
    }

    let mut img = DynamicImage::from_decoder(decoder)
        .map_err(|err| AppError::Other(format!("thumbnail decode error: {err}")))?;
    img.apply_orientation(orientation);
    encode_png_thumbnail_data_url(img, size)
}

fn is_jpeg_path(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|ext| ext.to_str()).map(|ext| ext.to_ascii_lowercase()).as_deref(),
        Some("jpg" | "jpeg"),
    )
}

fn read_image_orientation(path: &Path) -> AppResult<Orientation> {
    let mut decoder = image::ImageReader::open(path)?.with_guessed_format()?.into_decoder()
        .map_err(|err| AppError::Other(format!("JPEG metadata decoder error: {err}")))?;
    decoder.orientation().map_err(|err| AppError::Other(format!("JPEG orientation error: {err}")))
}

fn generate_turbojpeg_thumbnail(path: &Path, size: u32, orientation: Orientation) -> AppResult<EncodedThumbnail> {
    let jpeg_data = fs::read(path)?;
    let mut decompressor = turbojpeg::Decompressor::new()
        .map_err(|err| AppError::Other(format!("TurboJPEG initialization error: {err}")))?;
    let header = decompressor.read_header(&jpeg_data)
        .map_err(|err| AppError::Other(format!("TurboJPEG header error: {err}")))?;
    let max_dimension = header.width.max(header.height);
    let scale = turbojpeg::Decompressor::supported_scaling_factors()
        .into_iter()
        .filter(|factor| factor.scale(max_dimension) >= size as usize)
        .min_by_key(|factor| factor.scale(max_dimension))
        .unwrap_or(turbojpeg::ScalingFactor::ONE_EIGHTH);
    decompressor.set_scaling_factor(scale)
        .map_err(|err| AppError::Other(format!("TurboJPEG scaling error: {err}")))?;
    let scaled = header.scaled(scale);
    let pixel_size = turbojpeg::PixelFormat::RGBA.size();
    let mut decoded = turbojpeg::Image {
        pixels: vec![0; scaled.width * scaled.height * pixel_size],
        width: scaled.width,
        pitch: scaled.width * pixel_size,
        height: scaled.height,
        format: turbojpeg::PixelFormat::RGBA,
    };
    decompressor.decompress(&jpeg_data, decoded.as_deref_mut())
        .map_err(|err| AppError::Other(format!("TurboJPEG decode error: {err}")))?;
    let mut image = DynamicImage::ImageRgba8(
        image::RgbaImage::from_raw(scaled.width as u32, scaled.height as u32, decoded.pixels)
            .ok_or_else(|| AppError::Other("TurboJPEG returned invalid image dimensions".into()))?,
    );
    image.apply_orientation(orientation);
    encode_png_thumbnail_data_url(image, size)
}

fn embedded_thumbnail_data_url_from_jpeg_file(path: &Path, size: u32) -> Option<EncodedThumbnail> {
    let mut file = fs::File::open(path).ok()?;
    let mut soi = [0; 2];
    file.read_exact(&mut soi).ok()?;
    if soi != [0xFF, 0xD8] {
        return None;
    }

    loop {
        let marker = read_jpeg_marker(&mut file)?;
        match marker {
            // Start of Scan / End of Image: metadata segments are over.
            0xDA | 0xD9 => return None,
            // Restart markers and TEM have no payload length.
            0x01 | 0xD0..=0xD7 => continue,
            _ => {
                let len = read_be_u16(&mut file)? as usize;
                if len < 2 {
                    return None;
                }
                let payload_len = len - 2;

                if marker == 0xE1 {
                    let mut payload = vec![0; payload_len];
                    file.read_exact(&mut payload).ok()?;
                    if !payload.starts_with(b"Exif\0\0") {
                        continue;
                    }
                    let orientation = exif_orientation(&payload);
                    if let Some(data_url) = embedded_thumbnail_data_url(&payload, orientation, size) {
                        return Some(data_url);
                    }
                } else {
                    file.seek(SeekFrom::Current(payload_len as i64)).ok()?;
                }
            }
        }
    }
}

fn read_jpeg_marker(file: &mut fs::File) -> Option<u8> {
    let mut byte = [0; 1];

    loop {
        file.read_exact(&mut byte).ok()?;
        if byte[0] == 0xFF {
            break;
        }
    }

    loop {
        file.read_exact(&mut byte).ok()?;
        match byte[0] {
            0xFF => continue,
            0x00 => return None,
            marker => return Some(marker),
        }
    }
}

fn read_be_u16(file: &mut fs::File) -> Option<u16> {
    let mut bytes = [0; 2];
    file.read_exact(&mut bytes).ok()?;
    Some(u16::from_be_bytes(bytes))
}

fn exif_orientation(exif: &[u8]) -> Orientation {
    let tiff = exif.strip_prefix(b"Exif\0\0").unwrap_or(exif);
    Orientation::from_exif_chunk(tiff).unwrap_or(Orientation::NoTransforms)
}

fn embedded_thumbnail_data_url(
    exif: &[u8],
    orientation: Orientation,
    size: u32,
) -> Option<EncodedThumbnail> {
    let jpeg = extract_exif_jpeg_thumbnail(exif)?;
    if orientation == Orientation::NoTransforms {
        return Some(EncodedThumbnail {
            bytes: jpeg.to_vec(),
            extension: "jpg",
        });
    }

    let mut img = image::load_from_memory(jpeg).ok()?;
    img.apply_orientation(orientation);
    encode_png_thumbnail_data_url(img, size).ok()
}

fn encode_png_thumbnail_data_url(img: DynamicImage, size: u32) -> AppResult<EncodedThumbnail> {
    let thumb = img.thumbnail(size, size).to_rgba8();
    let mut bytes = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut bytes);
    encoder
        .write_image(
            thumb.as_raw(),
            thumb.width(),
            thumb.height(),
            image::ExtendedColorType::Rgba8,
        )
        .map_err(|err| AppError::Other(format!("thumbnail encode error: {err}")))?;
    Ok(EncodedThumbnail {
        bytes,
        extension: "png",
    })
}

#[cfg(target_os = "windows")]
fn platform_thumbnail_data_url(path: &Path, size: u32) -> Option<EncodedThumbnail> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{RPC_E_CHANGED_MODE, SIZE};
    use windows::Win32::Graphics::Gdi::{
        DeleteObject, HGDIOBJ,
    };
    use windows::Win32::System::Com::{
        CoInitializeEx, CoUninitialize, IBindCtx, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        SHCreateItemFromParsingName, IShellItemImageFactory,
        SIIGBF_RESIZETOFIT,
    };

    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let should_uninit = hr.is_ok();
        if !hr.is_ok() && hr != RPC_E_CHANGED_MODE {
            return None;
        }

        let wide: Vec<u16> = OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let factory: IShellItemImageFactory = match SHCreateItemFromParsingName::<_, _, IShellItemImageFactory>(
            PCWSTR(wide.as_ptr()),
            None::<&IBindCtx>,
        ) {
            Ok(factory) => factory,
            Err(_) => {
                if should_uninit {
                    CoUninitialize();
                }
                return None;
            }
        };

        let hbitmap = match factory.GetImage(
            SIZE {
                cx: size as i32,
                cy: size as i32,
            },
            SIIGBF_RESIZETOFIT,
        ) {
            Ok(hbitmap) => hbitmap,
            Err(_) => {
                if should_uninit {
                    CoUninitialize();
                }
                return None;
            }
        };

        let data_url = hbitmap_to_png_data_url(hbitmap, size);
        let _ = DeleteObject(HGDIOBJ(hbitmap.0));
        if should_uninit {
            CoUninitialize();
        }
        data_url
    }
}

#[cfg(target_os = "windows")]
unsafe fn hbitmap_to_png_data_url(
    hbitmap: windows::Win32::Graphics::Gdi::HBITMAP,
    size: u32,
) -> Option<EncodedThumbnail> {
    use std::mem::size_of;

    use windows::Win32::Graphics::Gdi::{
        GetDC, GetDIBits, GetObjectW, ReleaseDC, BI_RGB, BITMAP, BITMAPINFO, DIB_RGB_COLORS,
        HGDIOBJ,
    };

    let mut bitmap = BITMAP::default();
    let got = GetObjectW(
        HGDIOBJ(hbitmap.0),
        size_of::<BITMAP>() as i32,
        Some((&mut bitmap as *mut BITMAP).cast()),
    );
    if got == 0 || bitmap.bmWidth <= 0 || bitmap.bmHeight == 0 {
        return None;
    }

    let width = bitmap.bmWidth as usize;
    let height = bitmap.bmHeight.unsigned_abs() as usize;
    if width > size as usize || height > size as usize {
        return None;
    }
    let mut info = BITMAPINFO::default();
    info.bmiHeader.biSize = size_of::<windows::Win32::Graphics::Gdi::BITMAPINFOHEADER>() as u32;
    info.bmiHeader.biWidth = width as i32;
    info.bmiHeader.biHeight = -(height as i32);
    info.bmiHeader.biPlanes = 1;
    info.bmiHeader.biBitCount = 32;
    info.bmiHeader.biCompression = BI_RGB.0;

    let hdc = GetDC(None);
    if hdc.0.is_null() {
        return None;
    }

    let mut pixels = vec![0u8; width.checked_mul(height)?.checked_mul(4)?];
    let lines = GetDIBits(
        hdc,
        hbitmap,
        0,
        height as u32,
        Some(pixels.as_mut_ptr().cast()),
        &mut info,
        DIB_RGB_COLORS,
    );
    let _ = ReleaseDC(None, hdc);
    if lines == 0 {
        return None;
    }

    let all_alpha_zero = pixels.chunks_exact(4).all(|px| px[3] == 0);
    for px in pixels.chunks_exact_mut(4) {
        px.swap(0, 2);
        if all_alpha_zero {
            px[3] = 255;
        }
    }

    let img = image::RgbaImage::from_raw(width as u32, height as u32, pixels)?;
    encode_png_thumbnail_data_url(DynamicImage::ImageRgba8(img), size).ok()
}

#[cfg(not(target_os = "windows"))]
fn platform_thumbnail_data_url(_path: &Path, _size: u32) -> Option<EncodedThumbnail> {
    None
}

#[derive(Clone, Copy)]
enum TiffEndian {
    Big,
    Little,
}

fn extract_exif_jpeg_thumbnail(exif: &[u8]) -> Option<&[u8]> {
    let tiff = exif.strip_prefix(b"Exif\0\0").unwrap_or(exif);
    if tiff.len() < 8 {
        return None;
    }

    let endian = match &tiff[0..2] {
        b"II" => TiffEndian::Little,
        b"MM" => TiffEndian::Big,
        _ => return None,
    };
    if read_tiff_u16(tiff, 2, endian)? != 42 {
        return None;
    }

    let ifd0_offset = read_tiff_u32(tiff, 4, endian)? as usize;
    let ifd1_offset = next_ifd_offset(tiff, ifd0_offset, endian)? as usize;
    if ifd1_offset == 0 {
        return None;
    }

    let entries = read_tiff_u16(tiff, ifd1_offset, endian)? as usize;
    let entries_start = ifd1_offset.checked_add(2)?;
    let entries_bytes = entries.checked_mul(12)?;
    entries_start.checked_add(entries_bytes)?;

    let mut jpeg_offset: Option<usize> = None;
    let mut jpeg_len: Option<usize> = None;

    for index in 0..entries {
        let entry = entries_start.checked_add(index.checked_mul(12)?)?;
        let tag = read_tiff_u16(tiff, entry, endian)?;
        let value = read_tiff_u32(tiff, entry + 8, endian)? as usize;
        match tag {
            0x0201 => jpeg_offset = Some(value),
            0x0202 => jpeg_len = Some(value),
            _ => {}
        }
    }

    let start = jpeg_offset?;
    let len = jpeg_len?;
    let end = start.checked_add(len)?;
    let jpeg = tiff.get(start..end)?;
    if jpeg.starts_with(&[0xFF, 0xD8]) && jpeg.ends_with(&[0xFF, 0xD9]) {
        Some(jpeg)
    } else {
        None
    }
}

fn next_ifd_offset(tiff: &[u8], ifd_offset: usize, endian: TiffEndian) -> Option<u32> {
    let entries = read_tiff_u16(tiff, ifd_offset, endian)? as usize;
    let next_offset_pos = ifd_offset
        .checked_add(2)?
        .checked_add(entries.checked_mul(12)?)?;
    read_tiff_u32(tiff, next_offset_pos, endian)
}

fn read_tiff_u16(buf: &[u8], offset: usize, endian: TiffEndian) -> Option<u16> {
    let bytes = buf.get(offset..offset.checked_add(2)?)?;
    Some(match endian {
        TiffEndian::Big => u16::from_be_bytes([bytes[0], bytes[1]]),
        TiffEndian::Little => u16::from_le_bytes([bytes[0], bytes[1]]),
    })
}

fn read_tiff_u32(buf: &[u8], offset: usize, endian: TiffEndian) -> Option<u32> {
    let bytes = buf.get(offset..offset.checked_add(4)?)?;
    Some(match endian {
        TiffEndian::Big => u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
        TiffEndian::Little => u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
    })
}

pub fn load_image_toml_sections(path: &Path) -> AppResult<Vec<ImageTomlSection>> {
    project_metadata_sections(MetadataSource::resolve(path)?)
}

pub fn load_prepared_image_toml_sections(path: &Path) -> AppResult<Vec<ImageTomlSection>> {
    project_metadata_sections(MetadataSource::prepared(path)?)
}

fn project_metadata_sections(source: MetadataSource) -> AppResult<Vec<ImageTomlSection>> {
    let text = source.read_text()?;
    let root: toml::Value = toml::from_str(&text)?;
    let mut sections = Vec::new();
    if let toml::Value::Table(table) = root {
        collect_toml_sections("", &table, &mut sections);
    }
    Ok(sections)
}

fn collect_toml_sections(
    prefix: &str,
    table: &toml::map::Map<String, toml::Value>,
    sections: &mut Vec<ImageTomlSection>,
) {
    let mut fields = Vec::new();
    for (key, value) in table {
        if matches!(value, toml::Value::Table(_))
            || matches!(value, toml::Value::Array(items) if !items.is_empty() && items.iter().all(|item| item.is_table()))
        {
            continue;
        }
        fields.push(ImageTomlField { key: key.clone(), value: format_toml_field(value) });
    }
    if !fields.is_empty() || !prefix.is_empty() {
        sections.push(ImageTomlSection {
            name: if prefix.is_empty() { "根级".into() } else { prefix.into() },
            fields,
        });
    }
    for (key, value) in table {
        if prefix.is_empty() && key == "__luxe_exif" { continue; }
        let name = if prefix.is_empty() { key.clone() } else { format!("{prefix}.{key}") };
        match value {
            toml::Value::Table(child) => collect_toml_sections(&name, child, sections),
            toml::Value::Array(items) if !items.is_empty() && items.iter().all(|item| item.is_table()) => {
                for (index, item) in items.iter().enumerate() {
                    if let toml::Value::Table(child) = item {
                        collect_toml_sections(&format!("{name}[{}]", index + 1), child, sections);
                    }
                }
            }
            _ => {}
        }
    }
}

fn format_toml_field(value: &toml::Value) -> String {
    match value {
        toml::Value::Array(items) => items.iter().map(format_toml_field).collect::<Vec<_>>().join(", "),
        _ => stringify(value),
    }
}

fn selected_key_lookup(keys: &[String]) -> HashMap<String, String> {
    let mut lookup = HashMap::with_capacity(keys.len() * 2);
    for key in keys {
        lookup.entry(key.to_ascii_lowercase()).or_insert_with(|| key.clone());
    }
    lookup
}

fn parse_image_toml_fields(
    source: &MetadataSource,
    key_lookup: &HashMap<String, String>,
) -> AppResult<HashMap<String, String>> {
    let text = source.read_text()?;
    if let Some(out) = fast_parse_image_toml_fields(&text, key_lookup) {
        return Ok(out);
    }

    let root: toml::Value = toml::from_str(&text)?;
    let mut out: HashMap<String, String> = HashMap::with_capacity(key_lookup.len());
    walk_selected(&root, "", key_lookup, &mut out);
    Ok(out)
}

fn fast_parse_image_toml_fields(
    text: &str,
    key_lookup: &HashMap<String, String>,
) -> Option<HashMap<String, String>> {
    let mut out = HashMap::with_capacity(key_lookup.len());
    let mut section: Vec<String> = Vec::new();

    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(array_header) = line.strip_prefix("[[") {
            let (name, trailing) = array_header.split_once("]]")?;
            let array_section = parse_toml_key_path(name.trim())?;
            if !strip_inline_comment(trailing)?.trim().is_empty()
                || !array_section.first().is_some_and(|name| matches!(name.as_str(), "__luxe_exif" | "AE_Table")) {
                return None;
            }
            section = array_section;
            continue;
        }

        if line.starts_with('[') {
            let closing = find_unquoted_char(line, ']')?;
            let trailing = strip_inline_comment(line.get(closing + 1..).unwrap_or(""))?;
            if !trailing.trim().is_empty() {
                return None;
            }
            section = parse_toml_key_path(line.get(1..closing)?.trim())?;
            continue;
        }

        if section.first().is_some_and(|name| matches!(name.as_str(), "__luxe_exif" | "AE_Table")) {
            continue;
        }
        let Some(eq_pos) = find_unquoted_char(line, '=') else {
            continue;
        };
        let key_path = parse_toml_key_path(line.get(..eq_pos)?.trim())?;
        let raw_value = strip_inline_comment(line.get(eq_pos + 1..).unwrap_or(""))?;
        let full_path = compose_toml_path(&section, &key_path);
        if !is_selected_toml_path(&full_path, key_lookup) {
            if value_needs_full_toml_context(raw_value.trim()) {
                return None;
            }
            continue;
        }

        let value = parse_simple_toml_value(raw_value.trim())?;
        insert_selected_value(&full_path, value, key_lookup, &mut out);
    }

    Some(out)
}

fn compose_toml_path(section: &[String], key_path: &[String]) -> String {
    if section.is_empty() {
        return key_path.join(".");
    }

    let mut parts = Vec::with_capacity(section.len() + key_path.len());
    parts.extend(section.iter().cloned());
    parts.extend(key_path.iter().cloned());
    parts.join(".")
}

fn is_selected_toml_path(full_path: &str, key_lookup: &HashMap<String, String>) -> bool {
    if matches!(full_path.split('.').next(), Some("__luxe_exif" | "AE_Table")) {
        return false;
    }
    if key_lookup.contains_key(&full_path.to_ascii_lowercase()) {
        return true;
    }
    full_path
        .rsplit('.')
        .next()
        .map(|leaf| key_lookup.contains_key(&leaf.to_ascii_lowercase()))
        .unwrap_or(false)
}

fn value_needs_full_toml_context(raw: &str) -> bool {
    let raw = raw.trim();
    raw.starts_with("\"\"\"")
        || raw.starts_with("'''")
        || (raw.starts_with('[') && !raw.ends_with(']'))
        || (raw.starts_with('{') && !raw.ends_with('}'))
}

fn find_unquoted_char(text: &str, needle: char) -> Option<usize> {
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for (index, ch) in text.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quote == Some('"') && ch == '\\' {
            escaped = true;
            continue;
        }

        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => {}
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch == needle => return Some(index),
            None => {}
        }
    }

    None
}

fn strip_inline_comment(text: &str) -> Option<&str> {
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for (index, ch) in text.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quote == Some('"') && ch == '\\' {
            escaped = true;
            continue;
        }

        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => {}
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch == '#' => return text.get(..index),
            None => {}
        }
    }

    if quote.is_some() {
        return None;
    }
    Some(text)
}

fn parse_toml_key_path(raw: &str) -> Option<Vec<String>> {
    let mut parts = Vec::new();
    let mut part_start = 0;
    let mut quote: Option<char> = None;
    let mut escaped = false;

    for (index, ch) in raw.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quote == Some('"') && ch == '\\' {
            escaped = true;
            continue;
        }

        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => {}
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch == '.' => {
                parts.push(parse_toml_key_part(raw.get(part_start..index)?.trim())?);
                part_start = index + ch.len_utf8();
            }
            None => {}
        }
    }

    if quote.is_some() {
        return None;
    }
    parts.push(parse_toml_key_part(raw.get(part_start..)?.trim())?);
    Some(parts)
}

fn parse_toml_key_part(raw: &str) -> Option<String> {
    if raw.is_empty() {
        return None;
    }

    if (raw.starts_with('"') && raw.ends_with('"')) || (raw.starts_with('\'') && raw.ends_with('\'')) {
        return Some(raw.get(1..raw.len().checked_sub(1)?)?.to_string());
    }

    Some(raw.to_string())
}

fn parse_simple_toml_value(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.starts_with("\"\"\"") || raw.starts_with("'''") {
        return None;
    }

    if raw.starts_with('"') {
        return parse_basic_toml_string(raw);
    }
    if raw.starts_with('\'') {
        return parse_literal_toml_string(raw);
    }
    if raw.starts_with('[') {
        return parse_simple_toml_array(raw);
    }
    if raw.starts_with('{') {
        return None;
    }
    if raw.eq_ignore_ascii_case("true") {
        return Some("true".to_string());
    }
    if raw.eq_ignore_ascii_case("false") {
        return Some("false".to_string());
    }

    Some(normalise_toml_number_or_raw(raw))
}

fn parse_basic_toml_string(raw: &str) -> Option<String> {
    if !raw.ends_with('"') || raw.len() < 2 {
        return None;
    }

    let inner = raw.get(1..raw.len().checked_sub(1)?)?;
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            out.push(ch);
            continue;
        }

        let escaped = chars.next()?;
        match escaped {
            'b' => out.push('\u{0008}'),
            't' => out.push('\t'),
            'n' => out.push('\n'),
            'f' => out.push('\u{000C}'),
            'r' => out.push('\r'),
            '"' => out.push('"'),
            '\\' => out.push('\\'),
            'u' | 'U' => return None,
            _ => return None,
        }
    }
    Some(out)
}

fn parse_literal_toml_string(raw: &str) -> Option<String> {
    if !raw.ends_with('\'') || raw.len() < 2 {
        return None;
    }
    Some(raw.get(1..raw.len().checked_sub(1)?)?.to_string())
}

fn parse_simple_toml_array(raw: &str) -> Option<String> {
    if !raw.ends_with(']') {
        return None;
    }

    let inner = raw.get(1..raw.len().checked_sub(1)?)?;
    if inner.trim().is_empty() {
        return Some(String::new());
    }

    let mut items = Vec::new();
    let mut start = 0;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (index, ch) in inner.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        if quote == Some('"') && ch == '\\' {
            escaped = true;
            continue;
        }

        match quote {
            Some(q) if ch == q => quote = None,
            Some(_) => {}
            None if ch == '"' || ch == '\'' => quote = Some(ch),
            None if ch == '[' || ch == '{' => return None,
            None if ch == ',' => {
                items.push(parse_simple_toml_value(inner.get(start..index)?.trim())?);
                start = index + ch.len_utf8();
            }
            None => {}
        }
    }

    if quote.is_some() {
        return None;
    }
    items.push(parse_simple_toml_value(inner.get(start..)?.trim())?);
    Some(items.join(", "))
}

fn normalise_toml_number_or_raw(raw: &str) -> String {
    let compact = raw.replace('_', "");
    if let Ok(value) = compact.parse::<i64>() {
        return value.to_string();
    }
    if let Ok(value) = compact.parse::<f64>() {
        if value.is_finite() && value.fract() == 0.0 {
            return format!("{value:.0}");
        }
        if value.is_finite() {
            return format!("{value}");
        }
        return compact;
    }
    raw.to_string()
}

fn walk_selected(
    v: &toml::Value,
    prefix: &str,
    key_lookup: &HashMap<String, String>,
    out: &mut HashMap<String, String>,
) {
    match v {
        toml::Value::Table(t) => {
            for (k, child) in t.iter() {
                // Statistics and provenance are presentation-only; never let
                // their generic leaf names shadow existing camera keywords.
                if prefix.is_empty() && matches!(k.as_str(), "__luxe_exif" | "AE_Table") {
                    continue;
                }
                let full = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                walk_selected(child, &full, key_lookup, out);
            }
        }
        toml::Value::Array(a) => {
            let joined: Vec<String> = a.iter().map(stringify).collect();
            insert_selected_value(prefix, joined.join(", "), key_lookup, out);
        }
        _ => {
            insert_selected_value(prefix, stringify(v), key_lookup, out);
        }
    }
}

fn insert_selected_value(
    full_path: &str,
    value: String,
    key_lookup: &HashMap<String, String>,
    out: &mut HashMap<String, String>,
) {
    if full_path.is_empty() {
        return;
    }

    if let Some(key) = key_lookup.get(&full_path.to_ascii_lowercase()) {
        out.entry(key.clone()).or_insert_with(|| value.clone());
    }
    if let Some(leaf) = full_path.rsplit('.').next() {
        if let Some(key) = key_lookup.get(&leaf.to_ascii_lowercase()) {
            out.entry(key.clone()).or_insert(value);
        }
    }
}

fn walk(v: &toml::Value, prefix: &str, out: &mut HashMap<String, String>) {
    match v {
        toml::Value::Table(t) => {
            for (k, child) in t.iter() {
                // Statistics and provenance are presentation-only; never let
                // their generic leaf names shadow existing camera keywords.
                if prefix.is_empty() && matches!(k.as_str(), "__luxe_exif" | "AE_Table") {
                    continue;
                }
                let full = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                walk(child, &full, out);
            }
        }
        toml::Value::Array(a) => {
            // Hiz joins arrays with ", " in the flat representation.
            let joined: Vec<String> = a.iter().map(stringify).collect();
            let s = joined.join(", ");
            insert_with_aliases(out, prefix, s);
        }
        _ => {
            insert_with_aliases(out, prefix, stringify(v));
        }
    }
}

fn insert_with_aliases(out: &mut HashMap<String, String>, full_path: &str, value: String) {
    if full_path.is_empty() {
        return;
    }
    out.insert(full_path.to_string(), value.clone());
    out.entry(full_path.to_ascii_lowercase()).or_insert(value.clone());
    // Also store the bare leaf name so `AE_TAG_*` lookups work regardless of
    // the section it lives under.
    if let Some(leaf) = full_path.rsplit('.').next() {
        if leaf != full_path {
            out.entry(leaf.to_string()).or_insert(value.clone());
            out.entry(leaf.to_ascii_lowercase()).or_insert(value);
        }
    }
}

fn stringify(v: &toml::Value) -> String {
    match v {
        toml::Value::String(s)   => s.clone(),
        toml::Value::Integer(i)  => i.to_string(),
        toml::Value::Float(f)    => {
            // Avoid the scientific notation that toml's Display can produce.
            if f.fract() == 0.0 { format!("{f:.0}") } else { format!("{f}") }
        }
        toml::Value::Boolean(b)  => b.to_string(),
        toml::Value::Datetime(d) => d.to_string(),
        toml::Value::Array(_) | toml::Value::Table(_) => String::new(),
    }
}

#[cfg(test)]
mod metadata_budget_tests {
    use super::prune_metadata_cache;
    use dashmap::DashMap;
    use std::sync::Arc;

    #[test]
    fn metadata_lru_enforces_both_count_and_payload_budget() {
        let cache = DashMap::new();
        for (name, tick) in [("old", 1), ("middle", 2), ("new", 3)] {
            cache.insert(name.to_string(), Arc::new((tick, 1024usize)));
        }
        prune_metadata_cache(&cache, 96, 1500, |entry| *entry);
        assert_eq!(cache.len(), 1);
        assert!(cache.contains_key("new"));
        cache.insert("newer".into(), Arc::new((4, 100usize)));
        prune_metadata_cache(&cache, 1, 8192, |entry| *entry);
        assert_eq!(cache.len(), 1);
        assert!(cache.contains_key("newer"));
    }
}

#[cfg(test)]
mod hover_preview_tests {
    use super::load_image_hover_preview;
    use image::{Rgb, RgbImage};
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn hover_preview_uses_bounded_source_resolution_and_refreshes() {
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("luxe-hover-test-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let source = dir.join("capture.png");
        RgbImage::from_pixel(2000, 1200, Rgb([90, 120, 150])).save(&source).unwrap();

        let preview = load_image_hover_preview(&source).unwrap();
        assert_eq!(preview, load_image_hover_preview(&source).unwrap());
        let (width, height) = image::image_dimensions(&preview).unwrap();
        assert_eq!((width, height), (448, 269));

        RgbImage::from_pixel(2100, 1200, Rgb([100, 130, 160])).save(&source).unwrap();
        assert_ne!(preview, load_image_hover_preview(&source).unwrap());
        fs::remove_dir_all(dir).unwrap();
    }
}
