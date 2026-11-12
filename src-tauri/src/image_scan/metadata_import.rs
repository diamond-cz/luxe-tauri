//! Bounded metadata preparation and explicit native/DP replacement.
//!
//! Automatic import reuses every valid TOML byte-for-byte. Explicit native
//! replacement discards old payload only after a usable fresh JPEG decode; the
//! legacy merge API remains additive. A fixed 1-2 worker pool owns at most two
//! per-image documents; completion messages contain no payload.

use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use serde::Serialize;

use super::{exif_document, mtk_exif, ExifParseProgress, ImageEntry, ImageExifModule};
use crate::error::{AppError, AppResult};

const PROVENANCE: &str = "__luxe_exif";
const MAX_TEXT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES: usize = 262_144;
const MAX_TABLES: usize = 64;
const MAX_TABLE_VALUES: usize = 65_536;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static METADATA_POOL: Lazy<Result<rayon::ThreadPool, String>> = Lazy::new(|| {
    rayon::ThreadPoolBuilder::new()
        .num_threads(worker_count())
        .thread_name(|index| format!("luxe-metadata-{index}"))
        .build()
        .map_err(|error| error.to_string())
});

fn worker_count() -> usize {
    std::thread::available_parallelism().map_or(1, |count| count.get().min(2))
}

#[derive(Debug, Serialize)]
pub struct ImageMetadataPreparationResult {
    /// Full current directory index; summary.total counts only selected work.
    pub entries: Vec<ImageEntry>,
    pub summary: ImageMetadataPreparationSummary,
}

#[derive(Debug, Default, Serialize)]
pub struct ImageMetadataPreparationSummary {
    pub total: usize,
    pub created: usize,
    /// Existing files successfully written by an explicit native operation.
    pub replaced: usize,
    pub retained: usize,
    /// Valid existing TOMLs reused automatically, without JPEG reads or writes.
    pub cached: usize,
    pub unavailable: usize,
    pub failed: usize,
    pub partial: usize,
}

/// Legacy schema-1 history is still readable, but is not an optimization cache.
#[derive(Debug, Clone, Serialize)]
pub(super) struct ImageMetadataPreparation {
    pub(super) first_source: String,
    pub(super) selected_source: String,
    pub(super) decision: String,
}

pub(super) fn read_preparation(root: &toml::Value) -> Option<ImageMetadataPreparation> {
    let preparation = root.get(PROVENANCE)?.get("preparation")?.as_table()?;
    let first_source = preparation.get("first_source")?.as_str()?;
    let selected_source = preparation.get("selected_source")?.as_str()?;
    let decision = preparation.get("decision")?.as_str()?;
    let source = |value| matches!(value, "jpeg" | "toml" | "debug_parser" | "none");
    if !source(first_source)
        || !source(selected_source)
        || !matches!(
            decision,
            "native_created"
                | "native_replaced"
                | "existing_retained"
                | "native_unavailable"
                | "fallback"
                | "unavailable"
        )
    {
        return None;
    }
    Some(ImageMetadataPreparation {
        first_source: first_source.into(),
        selected_source: selected_source.into(),
        decision: decision.into(),
    })
}

#[derive(Clone, Copy)]
enum PreparationMode {
    Automatic,
    NativeMerge,
    NativeReplace,
}

/// Existing valid TOMLs, including unmarked legacy or metadata-only TOMLs,
/// always win automatic import. This call never refreshes their provenance.
pub fn prepare_image_metadata(
    image_dir: &Path,
    on_progress: impl FnMut(ExifParseProgress),
) -> AppResult<ImageMetadataPreparationResult> {
    run_preparation(
        image_dir,
        Vec::new(),
        PreparationMode::Automatic,
        on_progress,
    )
}

/// Legacy additive API: inspect JPEGs and add missing observations without
/// replacing old same-key values. Empty selection means the entire directory.
pub fn merge_image_metadata(
    image_dir: &Path,
    image_paths: Vec<String>,
    on_progress: impl FnMut(ExifParseProgress),
) -> AppResult<ImageMetadataPreparationResult> {
    run_preparation(
        image_dir,
        image_paths,
        PreparationMode::NativeMerge,
        on_progress,
    )
}

/// Explicitly replace sidecars with only usable fresh native JPEG content.
/// Existing bytes are never parsed or merged; unavailable native content leaves
/// them untouched and reports unavailable so callers can offer DebugParser.
/// Empty selection means the entire current image directory.
pub fn replace_image_metadata(
    image_dir: &Path,
    image_paths: Vec<String>,
    on_progress: impl FnMut(ExifParseProgress),
) -> AppResult<ImageMetadataPreparationResult> {
    run_preparation(
        image_dir,
        image_paths,
        PreparationMode::NativeReplace,
        on_progress,
    )
}

fn run_preparation(
    image_dir: &Path,
    image_paths: Vec<String>,
    mode: PreparationMode,
    mut on_progress: impl FnMut(ExifParseProgress),
) -> AppResult<ImageMetadataPreparationResult> {
    let started = Instant::now();
    let scope = DirectoryScope::new(image_dir)?;
    let inventory = Inventory::read(&scope)?;
    let mut entries = super::scan_directory(&scope.requested)?;
    for entry in &mut entries {
        if let Some((_, path)) = inventory.tomls.get(&folded(&entry.name)) {
            entry.toml_path = path.to_string_lossy().into_owned();
        }
    }
    // Reject the entire explicit selection before touching any TOML. Automatic
    // scans instead isolate unsafe stems as individual failed image outcomes.
    let selected = select_entries(&scope, &inventory, &entries, image_paths)?;
    let total = selected.len();
    let mut summary = ImageMetadataPreparationSummary {
        total,
        ..Default::default()
    };
    on_progress(ExifParseProgress {
        stage: "JPEG",
        completed: 0,
        total,
    });
    let mut native_parsed = 0usize;
    let mut written = 0usize;
    if total > 0 {
        let pool = METADATA_POOL
            .as_ref()
            .map_err(|error| AppError::Other(format!("metadata worker pool: {error}")))?;
        let next = AtomicUsize::new(0);
        let (sender, receiver) = mpsc::sync_channel(pool.current_num_threads());
        // The coordinator captures no FnMut callback. Only tiny completion
        // outcomes cross this bounded channel; workers drop their documents
        // before taking the next image. No per-image spawn/collect is used.
        std::thread::scope(|threads| -> AppResult<()> {
            let producer = threads.spawn(|| {
                pool.scope(|workers| {
                    for _ in 0..pool.current_num_threads().min(total) {
                        let sender = sender.clone();
                        let entries = &entries;
                        let selected = &selected;
                        let scope = &scope;
                        let inventory = &inventory;
                        let next = &next;
                        workers.spawn(move |_| loop {
                            let position = next.fetch_add(1, Ordering::Relaxed);
                            let Some(index) = selected.get(position).copied() else {
                                break;
                            };
                            let result = prepare_one(scope, inventory, &entries[index], mode)
                                .map_err(|error| error.to_string());
                            if sender.send((index, result)).is_err() {
                                break;
                            }
                        });
                    }
                });
                drop(sender);
            });
            let mut completed = 0usize;
            for (index, result) in receiver {
                completed += 1;
                match result {
                    Ok(outcome) => {
                        match outcome.decision {
                            OutcomeKind::Created => summary.created += 1,
                            OutcomeKind::Replaced => summary.replaced += 1,
                            OutcomeKind::Retained => summary.retained += 1,
                            OutcomeKind::Reused => summary.cached += 1,
                            OutcomeKind::Unavailable => summary.unavailable += 1,
                        }
                        summary.failed += usize::from(outcome.native_failed);
                        summary.partial += usize::from(outcome.partial);
                        native_parsed += usize::from(outcome.native_parsed);
                        written += usize::from(outcome.written);
                    }
                    Err(error) => {
                        summary.failed += 1;
                        tracing::warn!(path = %entries[index].jpg_path, %error, "image metadata task failed; original TOML retained");
                    }
                }
                // Real completion order is independent of directory order, but
                // counters and callbacks stay monotonic on the calling thread.
                on_progress(ExifParseProgress {
                    stage: "JPEG",
                    completed,
                    total,
                });
            }
            producer
                .join()
                .map_err(|_| AppError::Other("metadata worker panicked".into()))?;
            if completed != total {
                return Err(AppError::Other(
                    "metadata workers stopped before finishing the selection".into(),
                ));
            }
            Ok(())
        })?;
    }
    if written > 0 {
        super::clear_memory_caches();
    }
    tracing::info!(
        operation = match mode {
            PreparationMode::Automatic => "automatic",
            PreparationMode::NativeMerge => "native_merge",
            PreparationMode::NativeReplace => "native_replace",
        },
        total,
        reused = summary.cached,
        native_parsed,
        written,
        failed = summary.failed,
        elapsed_ms = started.elapsed().as_millis() as u64,
        "image metadata batch completed"
    );
    Ok(ImageMetadataPreparationResult { entries, summary })
}

fn select_entries(
    scope: &DirectoryScope,
    inventory: &Inventory,
    entries: &[ImageEntry],
    paths: Vec<String>,
) -> AppResult<Vec<usize>> {
    if paths.is_empty() {
        return Ok((0..entries.len()).collect());
    }
    if paths.len() > MAX_DIRECTORY_ENTRIES {
        return Err(AppError::Invalid(
            "metadata selection exceeds its path budget".into(),
        ));
    }
    let indexed: BTreeMap<_, _> = entries
        .iter()
        .enumerate()
        .map(|(index, entry)| (path_key(Path::new(&entry.jpg_path)), index))
        .collect();
    let mut result = BTreeSet::new();
    for text in paths {
        let path = Path::new(&text);
        validate_absolute(path)?;
        scope
            .regular_file(path)?
            .ok_or_else(|| AppError::NotFound(format!("selected image: {}", path.display())))?;
        let index = indexed.get(&path_key(path)).copied().ok_or_else(|| {
            AppError::Invalid("selected image is not indexed in the current directory".into())
        })?;
        inventory.check(&entries[index])?;
        if fs::canonicalize(path)? != fs::canonicalize(&entries[index].jpg_path)? {
            return Err(AppError::Invalid("selected image identity changed".into()));
        }
        result.insert(index);
    }
    Ok(result.into_iter().collect())
}

#[derive(Clone, Copy)]
enum OutcomeKind {
    Created,
    Replaced,
    Retained,
    Reused,
    Unavailable,
}
struct Outcome {
    decision: OutcomeKind,
    written: bool,
    native_parsed: bool,
    native_failed: bool,
    partial: bool,
}

fn prepare_one(
    scope: &DirectoryScope,
    inventory: &Inventory,
    entry: &ImageEntry,
    mode: PreparationMode,
) -> AppResult<Outcome> {
    let image = Path::new(&entry.jpg_path);
    let target = Path::new(&entry.toml_path);
    inventory.check(entry)?;
    scope
        .regular_file(image)?
        .ok_or_else(|| AppError::NotFound(format!("image disappeared: {}", image.display())))?;
    let previous = FileSnapshot::read(scope, target)?;
    // An explicit native replacement uses old bytes only as a bounded raw
    // concurrency guard. Invalid UTF-8/TOML and reserved user sections cannot
    // influence the freshly decoded payload or prevent its replacement.
    let previous_root = if matches!(mode, PreparationMode::NativeReplace) {
        None
    } else {
        previous.as_ref().map(FileSnapshot::parse).transpose()?
    };
    if matches!(mode, PreparationMode::Automatic) {
        if let Some(root) = previous_root.as_ref() {
            return Ok(Outcome {
                decision: OutcomeKind::Reused,
                written: false,
                native_parsed: false,
                native_failed: false,
                partial: is_partial(root),
            });
        }
    }
    let image_guard = open_checked(scope, image, false)?;
    let image_before = FileIdentity::new(image, &image_guard.metadata()?)?;
    let native = inspect_native(image)?;
    if native.failed && previous.is_some() && !matches!(mode, PreparationMode::NativeReplace) {
        return Err(AppError::Invalid(
            "native metadata read/decode failed; existing TOML left unchanged".into(),
        ));
    }
    let usable = has_payload(&native.root);
    if matches!(mode, PreparationMode::NativeReplace) && previous.is_some() && !usable {
        // Do not stamp even metadata-only diagnostics into an old sidecar. The
        // caller must see this JPEG as unavailable despite any old TOML source
        // or needs_fallback flag, and may explicitly fall back to DebugParser.
        return Ok(Outcome {
            decision: OutcomeKind::Unavailable,
            written: false,
            native_parsed: native.parsed,
            native_failed: native.failed,
            partial: false,
        });
    }
    let (mut root, decision, parser, content_mode) = if let Some(mut root) = previous_root {
        if !usable || !merge_payload(&mut root, native.root) {
            return Ok(Outcome {
                decision: OutcomeKind::Retained,
                written: false,
                native_parsed: native.parsed,
                native_failed: false,
                partial: is_partial(&root),
            });
        }
        (root, OutcomeKind::Replaced, "native", "native_merge")
    } else {
        (
            native.root,
            if previous.is_some() {
                OutcomeKind::Replaced
            } else if usable {
                OutcomeKind::Created
            } else {
                OutcomeKind::Unavailable
            },
            if native.identified {
                "native"
            } else {
                "unknown"
            },
            if usable { "native" } else { "metadata_only" },
        )
    };
    stamp_root(
        &mut root,
        parser,
        content_mode,
        native.modules,
        native.needs_fallback || !usable,
    )?;
    let partial = is_partial(&root);
    let contents = serialize_bounded(&root)?;
    image_before.recheck(image)?;
    write_prepared_atomic(scope, target, &contents, previous.as_ref())?;
    Ok(Outcome {
        decision,
        written: true,
        native_parsed: native.parsed,
        native_failed: native.failed,
        partial,
    })
}

struct NativeMetadata {
    root: toml::Value,
    modules: Vec<ImageExifModule>,
    needs_fallback: bool,
    identified: bool,
    parsed: bool,
    failed: bool,
}

fn inspect_native(image: &Path) -> AppResult<NativeMetadata> {
    let mut result = NativeMetadata {
        root: empty_root(),
        modules: Vec::new(),
        needs_fallback: true,
        identified: false,
        parsed: false,
        failed: false,
    };
    if !is_jpeg(image) {
        return Ok(result);
    }
    let inspected = match super::read_jpeg_metadata(image) {
        Ok(metadata) => {
            result.parsed = true;
            mtk_exif::inspect_exif_with_progress(&metadata, |_, _| {})
        }
        Err(error) => {
            result.failed = true;
            tracing::warn!(path = %image.display(), %error, "native metadata read failed");
            return Ok(result);
        }
    };
    match inspected {
        Ok(output) => {
            // Drop the duplicate typed AE tables before the single TOML parse.
            let mtk_exif::DirectExifOutput {
                toml,
                modules,
                needs_fallback,
                ae_tables,
            } = output;
            drop(ae_tables);
            if toml.len() as u64 > MAX_TEXT_BYTES {
                return Err(AppError::Invalid(
                    "native metadata exceeds the 16 MiB limit".into(),
                ));
            }
            result.root = toml::from_str(&toml)?;
            result.modules = modules;
            result.needs_fallback = needs_fallback;
            result.identified = true;
        }
        Err(error) => {
            result.failed = error != "not an MTK JPEG";
            tracing::debug!(path = %image.display(), %error, "native metadata unavailable");
        }
    }
    Ok(result)
}

fn stamp_root(
    root: &mut toml::Value,
    parser: &str,
    content_mode: &str,
    modules: Vec<ImageExifModule>,
    needs_fallback: bool,
) -> AppResult<()> {
    let modules = if content_mode == "native_merge" {
        exif_document::merged_content_modules(root, modules)?
    } else {
        modules
    };
    let provenance = provenance_mut(root)?;
    if content_mode == "native_merge" {
        provenance.insert("modules".into(), toml::Value::Array(Vec::new()));
    }
    let old_modules = provenance
        .entry("modules")
        .or_insert_with(|| toml::Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| AppError::Invalid("EXIF module provenance is not an array".into()))?;
    if old_modules.len() > 256 {
        return Err(AppError::Invalid(
            "EXIF module diagnostics exceed their budget".into(),
        ));
    }
    for module in modules {
        let module = toml::Value::try_from(module)?;
        if !old_modules.contains(&module) {
            if old_modules.len() >= 256 {
                return Err(AppError::Invalid(
                    "EXIF module diagnostics exceed their budget".into(),
                ));
            }
            old_modules.push(module);
        }
    }
    provenance.insert("schema_version".into(), toml::Value::Integer(1));
    provenance.insert("parser".into(), toml::Value::String(parser.into()));
    provenance.insert(
        "content_mode".into(),
        toml::Value::String(content_mode.into()),
    );
    provenance.insert(
        "needs_fallback".into(),
        toml::Value::Boolean(needs_fallback),
    );
    // Do not generate first/latest history or fingerprints. If an older file
    // contains history, keep its first source but invalidate its obsolete cache.
    if let Some(preparation) = provenance
        .get_mut("preparation")
        .and_then(toml::Value::as_table_mut)
    {
        preparation.remove("signature");
        preparation.insert(
            "selected_source".into(),
            toml::Value::String(
                if parser == "native" {
                    "jpeg"
                } else {
                    "debug_parser"
                }
                .into(),
            ),
        );
        preparation.insert(
            "decision".into(),
            toml::Value::String(
                if parser == "native" {
                    "native_replaced"
                } else {
                    "fallback"
                }
                .into(),
            ),
        );
    }
    Ok(())
}

/// One DP batch pins and indexes its directory once. It owns no decoded image
/// or TOML payload between calls. The caller clears shared caches once after a
/// batch with successful replacements, rather than clearing on every image.
pub(super) struct DebugParserMetadataWriter {
    scope: DirectoryScope,
    inventory: Inventory,
}

pub(super) struct DebugParserImageSnapshot(FileIdentity);
impl DebugParserImageSnapshot {
    pub(super) fn recheck(&self, image: &Path) -> AppResult<()> {
        self.0.recheck(image)
    }
}

impl DebugParserMetadataWriter {
    /// Copy through a checked non-reparse handle. Only a small identity record
    /// survives while the external tool runs; do not hold one handle per image.
    pub(super) fn copy_for_parser(
        &self,
        image: &Path,
        toml: &Path,
        copied: &Path,
    ) -> AppResult<DebugParserImageSnapshot> {
        self.validate_image(image, toml)?;
        let mut input = open_checked(&self.scope, image, false)?;
        let identity = FileIdentity::new(image, &input.metadata()?)?;
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(copied)?;
        io::copy(&mut input, &mut output)?;
        identity.recheck(image)?;
        Ok(DebugParserImageSnapshot(identity))
    }

    pub(super) fn new(image_dir: &Path) -> AppResult<Self> {
        let scope = DirectoryScope::new(image_dir)?;
        let inventory = Inventory::read(&scope)?;
        Ok(Self { scope, inventory })
    }

    /// Read-only eligibility check before the force runner copies an image.
    /// Invalid old text remains replaceable, but unsafe filesystem targets
    /// must not be handed to the external parser or guessed from their stem.
    /// Sharing/occupation is rechecked when the replacement snapshot opens.
    pub(super) fn validate_image(&self, image_path: &Path, toml_path: &Path) -> AppResult<()> {
        validate_absolute(image_path)?;
        validate_absolute(toml_path)?;
        let name = image_path
            .file_stem()
            .and_then(|name| name.to_str())
            .ok_or_else(|| AppError::Invalid("DP image has no valid stem".into()))?;
        if !is_image(image_path)
            || !toml_path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("toml"))
        {
            return Err(AppError::Invalid(
                "DP replacement requires an image and its TOML".into(),
            ));
        }
        self.inventory.check(&ImageEntry {
            name: name.into(),
            jpg_path: image_path.to_string_lossy().into_owned(),
            toml_path: toml_path.to_string_lossy().into_owned(),
        })?;
        self.scope
            .regular_file(image_path)?
            .ok_or_else(|| AppError::NotFound(format!("DP image: {}", image_path.display())))?;
        let target = self.scope.regular_file(toml_path)?;
        if let Some(metadata) = target {
            if metadata.permissions().readonly() || metadata.len() > MAX_TEXT_BYTES {
                return Err(AppError::Invalid(
                    "DP metadata target is read-only or exceeds the 16 MiB limit".into(),
                ));
            }
        }
        if let Some((_, actual)) = self.inventory.tomls.get(&folded(name)) {
            if fs::canonicalize(actual)? != fs::canonicalize(toml_path)? {
                return Err(AppError::Invalid(
                    "DP target is not the unique existing TOML".into(),
                ));
            }
        }
        Ok(())
    }

    /// Only the fresh DP payload survives this explicit replacement. Invalid
    /// old UTF-8/TOML is allowed, with a bounded raw concurrency snapshot.
    pub(super) fn replace(
        &self,
        image_path: &Path,
        toml_path: &Path,
        contents: &str,
    ) -> AppResult<bool> {
        if contents.len() as u64 > MAX_TEXT_BYTES {
            return Err(AppError::Invalid(
                "DebugParser metadata exceeds the 16 MiB limit".into(),
            ));
        }
        self.validate_image(image_path, toml_path)?;
        let image_guard = open_checked(&self.scope, image_path, false)?;
        let image_before = FileIdentity::new(image_path, &image_guard.metadata()?)?;
        let previous = FileSnapshot::read(&self.scope, toml_path)?;
        let mut root: toml::Value = toml::from_str(contents)?;
        if root
            .get(PROVENANCE)
            .and_then(|info| info.get("parser"))
            .and_then(toml::Value::as_str)
            != Some("debug_parser")
        {
            return Err(AppError::Invalid(
                "DP replacement is missing verified parser provenance".into(),
            ));
        }
        if !has_payload(&root) {
            return Ok(false);
        }
        let needs_fallback = root
            .get(PROVENANCE)
            .and_then(|info| info.get("needs_fallback"))
            .and_then(toml::Value::as_bool)
            .unwrap_or(true);
        stamp_root(
            &mut root,
            "debug_parser",
            "replace",
            Vec::new(),
            needs_fallback,
        )?;
        let output = serialize_bounded(&root)?;
        image_before.recheck(image_path)?;
        write_prepared_atomic(&self.scope, toml_path, &output, previous.as_ref())?;
        Ok(true)
    }
}

/// Compatibility wrapper for callers replacing a single image outside a batch.
pub(super) fn replace_debug_parser_metadata(
    image_path: &Path,
    toml_path: &Path,
    contents: &str,
) -> AppResult<bool> {
    let parent = image_path
        .parent()
        .ok_or_else(|| AppError::Invalid("DP image has no directory".into()))?;
    let written =
        DebugParserMetadataWriter::new(parent)?.replace(image_path, toml_path, contents)?;
    if written {
        super::clear_memory_caches();
    }
    Ok(written)
}

fn serialize_bounded(root: &toml::Value) -> AppResult<String> {
    let text = toml::to_string(root)?;
    if text.len() as u64 > MAX_TEXT_BYTES {
        return Err(AppError::Invalid(
            "prepared metadata exceeds the 16 MiB limit".into(),
        ));
    }
    Ok(text)
}

fn empty_root() -> toml::Value {
    toml::Value::Table(toml::map::Map::new())
}
fn provenance_mut(root: &mut toml::Value) -> AppResult<&mut toml::map::Map<String, toml::Value>> {
    root.as_table_mut()
        .ok_or_else(|| AppError::Invalid("image metadata is not a TOML table".into()))?
        .entry(PROVENANCE)
        .or_insert_with(empty_root)
        .as_table_mut()
        .ok_or_else(|| AppError::Invalid("reserved EXIF provenance is not a table".into()))
}
fn is_partial(root: &toml::Value) -> bool {
    root.get(PROVENANCE)
        .and_then(|info| info.get("needs_fallback"))
        .and_then(toml::Value::as_bool)
        == Some(true)
        && has_payload(root)
}

#[derive(PartialEq, Eq)]
enum ScalarKind {
    Number,
    String,
    Boolean,
    Datetime,
}
fn scalar_kind(value: &toml::Value) -> Option<ScalarKind> {
    match value {
        toml::Value::Integer(_) | toml::Value::Float(_) => Some(ScalarKind::Number),
        toml::Value::String(_) => Some(ScalarKind::String),
        toml::Value::Boolean(_) => Some(ScalarKind::Boolean),
        toml::Value::Datetime(_) => Some(ScalarKind::Datetime),
        _ => None,
    }
}
fn observation(value: &toml::Value) -> bool {
    scalar_kind(value).is_some()
        || value.as_array().is_some_and(|values| {
            !values.is_empty() && values.iter().all(|value| scalar_kind(value).is_some())
        })
}
fn has_fields(value: &toml::Value) -> bool {
    observation(value)
        || value
            .as_table()
            .is_some_and(|table| table.values().any(has_fields))
}
fn has_payload(root: &toml::Value) -> bool {
    root.as_table().is_some_and(|root| {
        root.iter().any(|(name, value)| {
            if matches!(name.as_str(), PROVENANCE | "AE_DISPLAY" | "Detail") {
                false
            } else if name == "AE_Table" {
                value.as_table().is_some_and(|blocks| {
                    blocks
                        .iter()
                        .any(|(name, value)| valid_statistics_block(name, value))
                })
            } else {
                has_fields(value)
            }
        })
    })
}

// Borrow validated statistics instead of cloning their potentially large arrays
// through take_ae_tables. Native and converted DP outputs use structured blocks.
fn valid_statistics_block(name: &str, value: &toml::Value) -> bool {
    if name.is_empty() || name.len() > 128 {
        return false;
    }
    let Some(block) = value.as_table() else {
        return false;
    };
    let (Some(rows), Some(columns), Some(values)) = (
        block
            .get("rows")
            .and_then(toml::Value::as_integer)
            .and_then(|value| usize::try_from(value).ok()),
        block
            .get("columns")
            .and_then(toml::Value::as_integer)
            .and_then(|value| usize::try_from(value).ok()),
        block.get("values").and_then(toml::Value::as_array),
    ) else {
        return false;
    };
    rows > 0
        && columns > 0
        && rows <= 512
        && columns <= 512
        && rows
            .checked_mul(columns)
            .is_some_and(|count| count <= MAX_TABLE_VALUES && count == values.len())
        && values.iter().all(|value| value.as_integer().is_some())
        && block
            .get("name")
            .is_none_or(|value| value.as_str() == Some(name))
}

fn canonical_module(name: &str) -> &str {
    match name {
        "MF" => "MFNR",
        "CMN" | "COMMON" => "Common",
        "ISP_HW" | "ISP_SW" => "ISP",
        "SENSOR" => "Sensor",
        "SHADING" => "Shading",
        "STROBE" => "Strobe",
        "RESVA" => "SWNR",
        "RESVB" => "BMDN",
        "STRING" => "String",
        _ => name,
    }
}
fn flat_tag_module(name: &str) -> Option<&'static str> {
    [
        ("AE_TAG_", "AE"),
        ("AF_TAG_", "AF"),
        ("AWB_TAG_", "AWB"),
        ("MF_TAG_", "MFNR"),
        ("CMN_TAG_", "Common"),
        ("SHAD_", "Shading"),
        ("FL_T_", "Strobe"),
    ]
    .into_iter()
    .find_map(|(prefix, module)| name.starts_with(prefix).then_some(module))
}

/// Move incoming values into vacant fields. The boolean is derived from actual
/// additions, never metadata changes or aggregate decoded-field diagnostics.
fn merge_payload(current: &mut toml::Value, incoming: toml::Value) -> bool {
    let (Some(current), toml::Value::Table(incoming)) = (current.as_table_mut(), incoming) else {
        return false;
    };
    let mut changed = false;
    for (name, mut value) in incoming {
        if matches!(name.as_str(), PROVENANCE | "AE_DISPLAY" | "Detail") {
            continue;
        }
        if name == "AE_Table" {
            let toml::Value::Table(blocks) = value else {
                continue;
            };
            let existing = current.entry(name).or_insert_with(empty_root);
            if let Some(existing) = existing.as_table_mut() {
                for (name, block) in blocks {
                    if existing.len() < MAX_TABLES
                        && !existing.contains_key(&name)
                        && valid_statistics_block(&name, &block)
                    {
                        existing.insert(name, block);
                        changed = true;
                    }
                }
            }
            continue;
        }
        if !value.is_table() {
            if let Some(module) = flat_tag_module(&name) {
                if !current.contains_key(&name) {
                    let owners: Vec<_> = current
                        .iter()
                        .filter(|(key, value)| value.is_table() && canonical_module(key) == module)
                        .map(|(key, _)| key.clone())
                        .collect();
                    if owners.len() > 1 {
                        continue;
                    }
                    if let Some(owner) = owners.first() {
                        if let Some(table) =
                            current.get_mut(owner).and_then(toml::Value::as_table_mut)
                        {
                            changed |= merge_field(table, name, value);
                            continue;
                        }
                    }
                }
            }
        }
        if let Some(fields) = value.as_table_mut() {
            for key in fields.keys().cloned().collect::<Vec<_>>() {
                if flat_tag_module(&key) == Some(canonical_module(&name))
                    && current.contains_key(&key)
                {
                    if let Some(additional) = fields.remove(&key) {
                        changed |= merge_observations(
                            current.get_mut(&key).expect("checked root tag"),
                            additional,
                        );
                    }
                }
            }
        }
        let owners: Vec<_> = current
            .keys()
            .filter(|candidate| canonical_module(candidate) == canonical_module(&name))
            .cloned()
            .collect();
        if owners.len() > 1 {
            continue;
        }
        changed |= merge_field(current, owners.into_iter().next().unwrap_or(name), value);
    }
    changed
}
fn merge_field(
    current: &mut toml::map::Map<String, toml::Value>,
    name: String,
    value: toml::Value,
) -> bool {
    if let Some(existing) = current.get_mut(&name) {
        return merge_observations(existing, value);
    }
    if let Some(value) = observations_only(value) {
        current.insert(name, value);
        true
    } else {
        false
    }
}
fn observations_only(value: toml::Value) -> Option<toml::Value> {
    if observation(&value) {
        return Some(value);
    }
    let toml::Value::Table(table) = value else {
        return None;
    };
    let table: toml::map::Map<_, _> = table
        .into_iter()
        .filter_map(|(name, value)| observations_only(value).map(|value| (name, value)))
        .collect();
    (!table.is_empty()).then_some(toml::Value::Table(table))
}
fn merge_observations(current: &mut toml::Value, incoming: toml::Value) -> bool {
    if let toml::Value::Table(incoming) = incoming {
        let Some(current) = current.as_table_mut() else {
            return false;
        };
        let mut changed = false;
        for (name, value) in incoming {
            changed |= merge_field(current, name, value);
        }
        return changed;
    }
    let toml::Value::Array(incoming) = incoming else {
        return false;
    };
    if incoming.is_empty() || incoming.iter().any(|value| scalar_kind(value).is_none()) {
        return false;
    }
    if let Some(existing) = current.as_array_mut() {
        if incoming.len() > existing.len()
            && existing
                .iter()
                .zip(&incoming)
                .all(|(old, new)| scalar_kind(old).is_some() && old == new)
        {
            let old_len = existing.len();
            existing.extend(incoming.into_iter().skip(old_len));
            return true;
        }
    } else if incoming.len() > 1 && scalar_kind(current).is_some() && *current == incoming[0] {
        let first = std::mem::replace(current, toml::Value::Integer(0));
        *current = toml::Value::Array(
            std::iter::once(first)
                .chain(incoming.into_iter().skip(1))
                .collect(),
        );
        return true;
    }
    false
}

#[derive(PartialEq, Eq)]
struct FileIdentity {
    path: PathBuf,
    size: u64,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
}
impl FileIdentity {
    fn new(path: &Path, metadata: &fs::Metadata) -> AppResult<Self> {
        if !metadata.is_file() || is_link(metadata) {
            return Err(AppError::Invalid(
                "image is not a regular non-reparse file".into(),
            ));
        }
        Ok(Self {
            path: fs::canonicalize(path)?,
            size: metadata.len(),
            modified: metadata.modified().ok(),
            created: metadata.created().ok(),
        })
    }
    fn recheck(&self, path: &Path) -> AppResult<()> {
        if Self::new(path, &fs::symlink_metadata(path)?)? != *self {
            return Err(AppError::Invalid(
                "image changed during metadata task".into(),
            ));
        }
        Ok(())
    }
}
fn folded(name: &str) -> String {
    name.to_lowercase()
}
fn path_key(path: &Path) -> String {
    let text = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    let text = text.to_lowercase();
    text
}
fn is_jpeg(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("jpg") || extension.eq_ignore_ascii_case("jpeg")
        })
}
fn is_image(path: &Path) -> bool {
    is_jpeg(path)
        || path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("png"))
}
fn unsafe_path(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}
fn is_link(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}
fn valid_name(name: &str) -> bool {
    if name.is_empty()
        || name.len() > 1024
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|ch| ch.is_control() || "<>:\"/\\|?*".contains(ch))
    {
        return false;
    }
    let base = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    !matches!(
        base.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) && !(base.len() == 4
        && (base.starts_with("COM") || base.starts_with("LPT"))
        && matches!(base.as_bytes()[3], b'1'..=b'9'))
}
fn validate_absolute(path: &Path) -> AppResult<()> {
    if !path.is_absolute() || path.to_str().is_none_or(|path| path.len() > 32_768) {
        return Err(AppError::Invalid(
            "metadata tasks require bounded absolute paths".into(),
        ));
    }
    if path.components().count() > 130 {
        return Err(AppError::Invalid(
            "metadata path exceeds its depth budget".into(),
        ));
    }
    for component in path.components() {
        match component {
            Component::CurDir | Component::ParentDir => {
                return Err(AppError::Invalid(
                    "metadata paths cannot traverse relative components".into(),
                ))
            }
            Component::Normal(name) if !name.to_str().is_some_and(valid_name) => {
                return Err(AppError::Invalid("unsafe metadata path component".into()))
            }
            #[cfg(windows)]
            Component::Prefix(prefix)
                if !matches!(
                    prefix.kind(),
                    std::path::Prefix::Disk(_)
                        | std::path::Prefix::VerbatimDisk(_)
                        | std::path::Prefix::UNC(_, _)
                        | std::path::Prefix::VerbatimUNC(_, _)
                ) =>
            {
                return Err(AppError::Invalid(
                    "metadata tasks reject device namespaces".into(),
                ))
            }
            _ => {}
        }
    }
    Ok(())
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
    if !metadata.is_dir() || is_link(&metadata) {
        return Err(unsafe_path(
            "metadata directory and ancestors must not be links/reparse points",
        ));
    }
    Ok(())
}
struct DirectoryScope {
    requested: PathBuf,
    canonical: PathBuf,
    _handles: Vec<File>,
}
impl DirectoryScope {
    fn new(path: &Path) -> AppResult<Self> {
        validate_absolute(path)?;
        let mut handles: Vec<File> = Vec::new();
        for directory in directory_chain(path) {
            check_directory(&directory)?;
            #[cfg(windows)]
            {
                use std::os::windows::fs::OpenOptionsExt;
                use windows::Win32::Storage::FileSystem::{
                    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ, FILE_SHARE_WRITE,
                };
                let handle = OpenOptions::new()
                    .read(true)
                    .access_mode(FILE_READ_ATTRIBUTES.0)
                    .share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0)
                    .custom_flags(FILE_FLAG_BACKUP_SEMANTICS.0 | FILE_FLAG_OPEN_REPARSE_POINT.0)
                    .open(&directory)?;
                let metadata = handle.metadata()?;
                if !metadata.is_dir() || is_link(&metadata) {
                    return Err(AppError::Invalid(
                        "metadata directory became a reparse point".into(),
                    ));
                }
                handles.push(handle);
            }
        }
        #[cfg(not(windows))]
        handles.shrink_to_fit();
        Ok(Self {
            requested: path.to_path_buf(),
            canonical: fs::canonicalize(path)?,
            _handles: handles,
        })
    }
    fn check_parent(&self, path: &Path) -> io::Result<()> {
        for directory in directory_chain(&self.requested) {
            check_directory(&directory)?;
        }
        let parent = path
            .parent()
            .ok_or_else(|| unsafe_path("metadata target has no parent"))?;
        for directory in directory_chain(parent) {
            check_directory(&directory)?;
        }
        if fs::canonicalize(&self.requested)? != self.canonical
            || fs::canonicalize(parent)? != self.canonical
        {
            return Err(unsafe_path("metadata target left its selected directory"));
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
        if !metadata.is_file() || is_link(&metadata) {
            return Err(unsafe_path(
                "metadata/image target is not a regular non-reparse file",
            ));
        }
        if fs::canonicalize(path)?.parent() != Some(self.canonical.as_path()) {
            return Err(unsafe_path(
                "metadata/image target resolves outside its directory",
            ));
        }
        Ok(Some(metadata))
    }
}
struct Inventory {
    images: BTreeMap<String, usize>,
    tomls: BTreeMap<String, (usize, PathBuf)>,
}
impl Inventory {
    fn read(scope: &DirectoryScope) -> AppResult<Self> {
        let mut result = Self {
            images: BTreeMap::new(),
            tomls: BTreeMap::new(),
        };
        for (index, entry) in fs::read_dir(&scope.requested)?.enumerate() {
            if index >= MAX_DIRECTORY_ENTRIES {
                return Err(AppError::Invalid(
                    "metadata directory exceeds its entry budget".into(),
                ));
            }
            let path = entry?.path();
            let Some(stem) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            if is_image(&path) {
                // Count unsafe image-like entries too: they cannot become an
                // alternative owner of another image's same-stem sidecar.
                *result.images.entry(folded(stem)).or_default() += 1;
            } else if path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("toml"))
            {
                result
                    .tomls
                    .entry(folded(stem))
                    .and_modify(|(count, _)| *count += 1)
                    .or_insert((1, path));
            }
        }
        Ok(result)
    }
    fn check(&self, entry: &ImageEntry) -> AppResult<()> {
        let image = Path::new(&entry.jpg_path);
        let target = Path::new(&entry.toml_path);
        if !image
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(valid_name)
            || !target
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(valid_name)
            || target
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("state.toml"))
            || image.file_stem().and_then(|stem| stem.to_str()).map(folded)
                != target
                    .file_stem()
                    .and_then(|stem| stem.to_str())
                    .map(folded)
            || self.images.get(&folded(&entry.name)) != Some(&1)
            || self
                .tomls
                .get(&folded(&entry.name))
                .is_some_and(|(count, _)| *count != 1)
        {
            return Err(AppError::Invalid(
                "unsafe or ambiguous metadata stem; no TOML was written".into(),
            ));
        }
        Ok(())
    }
}
fn open_checked(scope: &DirectoryScope, path: &Path, replaceable: bool) -> io::Result<File> {
    scope
        .regular_file(path)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "metadata/image disappeared"))?;
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        use windows::Win32::Storage::FileSystem::{
            FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ,
        };
        options
            .share_mode(FILE_SHARE_READ.0 | if replaceable { FILE_SHARE_DELETE.0 } else { 0 })
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT.0);
    }
    #[cfg(not(windows))]
    let _ = replaceable;
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || is_link(&metadata) {
        return Err(unsafe_path(
            "metadata/image changed into a link or reparse point",
        ));
    }
    scope
        .regular_file(path)?
        .ok_or_else(|| unsafe_path("metadata/image disappeared after open"))?;
    Ok(file)
}

struct FileSnapshot {
    bytes: Vec<u8>,
    metadata: fs::Metadata,
    _guard: File,
}
impl FileSnapshot {
    fn read(scope: &DirectoryScope, path: &Path) -> AppResult<Option<Self>> {
        if scope.regular_file(path)?.is_none() {
            return Ok(None);
        }
        let guard = open_checked(scope, path, true)?;
        let metadata = guard.metadata()?;
        if metadata.len() > MAX_TEXT_BYTES {
            return Err(AppError::Invalid(
                "existing image metadata exceeds the 16 MiB limit".into(),
            ));
        }
        // Read the checked handle, not a second pathname open that could race
        // with an editor's delete-sharing rename. Raw bytes also protect invalid
        // UTF-8/TOML during explicitly authorized native or DP replacement.
        let mut bytes = Vec::new();
        (&guard).take(MAX_TEXT_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_TEXT_BYTES {
            return Err(AppError::Invalid(
                "existing image metadata exceeds the 16 MiB limit".into(),
            ));
        }
        Ok(Some(Self {
            bytes,
            metadata,
            _guard: guard,
        }))
    }
    fn parse(&self) -> AppResult<toml::Value> {
        let text = std::str::from_utf8(&self.bytes).map_err(|error| {
            AppError::Invalid(format!("existing image metadata is not UTF-8: {error}"))
        })?;
        Ok(toml::from_str(text)?)
    }
}
struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn write_prepared_atomic(
    scope: &DirectoryScope,
    path: &Path,
    contents: &str,
    previous: Option<&FileSnapshot>,
) -> AppResult<()> {
    scope.check_parent(path)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| unsafe_path("metadata target has no name"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = path.with_file_name(format!(
        ".{name}.luxe-import-{}-{nonce}-{}.tmp",
        std::process::id(),
        TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)?;
    let _cleanup = TemporaryFile(temporary.clone());
    file.write_all(contents.as_bytes())?;
    file.sync_all()?;
    drop(file);
    scope.check_parent(path)?;
    match (previous, scope.regular_file(path)?) {
        (Some(previous), Some(current)) => {
            if current.permissions().readonly()
                || previous.metadata.permissions().readonly()
                || current.len() != previous.metadata.len()
                || current.modified()? != previous.metadata.modified()?
                || current.created().ok() != previous.metadata.created().ok()
            {
                return Err(AppError::Invalid(
                    "existing metadata changed or is read-only; original retained".into(),
                ));
            }
            let mut bytes = Vec::new();
            open_checked(scope, path, true)?
                .take(MAX_TEXT_BYTES + 1)
                .read_to_end(&mut bytes)?;
            if bytes != previous.bytes {
                return Err(AppError::Invalid(
                    "existing metadata was edited during the task; original retained".into(),
                ));
            }
            fs::rename(&temporary, path)?;
        }
        (None, None) => {
            fs::hard_link(&temporary, path)?;
        }
        _ => {
            return Err(AppError::Invalid(
                "metadata target appeared/disappeared during the task; original retained".into(),
            ))
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root(text: &str) -> toml::Value {
        toml::from_str(text).unwrap()
    }
    struct Fixture(PathBuf);
    impl Fixture {
        fn new(bytes: &[u8]) -> Self {
            let nonce = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let directory = std::env::temp_dir().join(format!(
                "luxe-metadata-unit-{}-{}-{nonce}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir(&directory).unwrap();
            fs::write(
                directory.join("image.jpg"),
                b"explicit DP does not inspect JPEG bytes",
            )
            .unwrap();
            fs::write(directory.join("image.toml"), bytes).unwrap();
            Self(directory)
        }
        fn replace(&self, payload: &str) -> AppResult<bool> {
            let text = format!("{payload}\n[__luxe_exif]\nschema_version=1\nparser='debug_parser'\nneeds_fallback=false\nmodules=[]\n");
            replace_debug_parser_metadata(
                &self.0.join("image.jpg"),
                &self.0.join("image.toml"),
                &text,
            )
        }
        fn bytes(&self) -> Vec<u8> {
            fs::read(self.0.join("image.toml")).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn dp_batch_writer_validates_without_decoding_and_reuses_its_directory_scope() {
        let fixture = Fixture::new(&[0xff, 0xfe]);
        fs::write(fixture.0.join("second.jpg"), b"not JPEG either").unwrap();
        fs::write(fixture.0.join("second.toml"), "[AE]\nOLD=9\n").unwrap();
        fs::write(fixture.0.join("blocked.jpg"), b"image-like entry").unwrap();
        fs::create_dir(fixture.0.join("blocked.toml")).unwrap();
        let writer = DebugParserMetadataWriter::new(&fixture.0).unwrap();
        // Validation is filesystem-only: neither invalid image bytes nor old
        // invalid TOML text is decoded before the runner starts a fresh DP.
        writer
            .validate_image(&fixture.0.join("image.jpg"), &fixture.0.join("image.toml"))
            .unwrap();
        assert_eq!(fixture.bytes(), vec![0xff, 0xfe]);
        assert!(writer
            .validate_image(
                &fixture.0.join("blocked.jpg"),
                &fixture.0.join("blocked.toml")
            )
            .is_err());
        let contents =
            "[AF]\nPOS=7\n[__luxe_exif]\nparser='debug_parser'\nneeds_fallback=false\nmodules=[]\n";
        assert!(writer
            .replace(
                &fixture.0.join("image.jpg"),
                &fixture.0.join("image.toml"),
                contents
            )
            .unwrap());
        assert!(writer
            .replace(
                &fixture.0.join("second.jpg"),
                &fixture.0.join("second.toml"),
                contents
            )
            .unwrap());
        let second = root(&fs::read_to_string(fixture.0.join("second.toml")).unwrap());
        assert!(second.get("AE").is_none());
        assert_eq!(second["AF"]["POS"].as_integer(), Some(7));
    }

    #[test]
    fn native_merge_keeps_nested_values_and_only_appends_repeated_observations() {
        let mut current =
            root("[AE]\nA=7\n[AE.nested]\nKEEP=8\n[AF]\nPOS=[10,20]\n[Vendor_Raw]\nDATA='keep'\n");
        assert!(merge_payload(
            &mut current,
            root("[AE]\nA=999\n[AE.nested]\nKEEP=999\nNEW=1\n[AF]\nPOS=[10,20,30,40]\n")
        ));
        assert_eq!(current["AE"]["A"].as_integer(), Some(7));
        assert_eq!(current["AE"]["nested"]["KEEP"].as_integer(), Some(8));
        assert_eq!(current["AE"]["nested"]["NEW"].as_integer(), Some(1));
        assert_eq!(
            current["AF"]["POS"]
                .as_array()
                .unwrap()
                .iter()
                .map(toml::Value::as_integer)
                .collect::<Option<Vec<_>>>()
                .unwrap(),
            vec![10, 20, 30, 40]
        );
        assert_eq!(current["Vendor_Raw"]["DATA"].as_str(), Some("keep"));
        assert!(!merge_payload(
            &mut current,
            root("[AE]\nA=888\n[AF]\nPOS=[9]\n")
        ));
    }
    #[test]
    fn repeated_observations_are_extended_only_when_the_original_prefix_matches() {
        for (previous, incoming) in [
            ("[AF]\nPOS=[10,20]\n", "[AF]\nPOS=[90,80,30,40]\n"),
            ("[AF]\nPOS=10\n", "[AF]\nPOS=[99,11]\n"),
            ("[AF]\nPOS=[10,20]\n", "[AF]\nPOS=[10,99,30]\n"),
        ] {
            let mut current = root(previous);
            let original = current.clone();
            assert!(!merge_payload(&mut current, root(incoming)));
            assert_eq!(
                current, original,
                "different log samples must not become a fabricated mixed array"
            );
        }
        let mut current = root("[AF]\nPOS=10\n");
        assert!(merge_payload(&mut current, root("[AF]\nPOS=[10,11]\n")));
        assert_eq!(current["AF"]["POS"], root("V=[10,11]")["V"]);
    }

    #[test]
    fn aliases_and_bare_tags_do_not_create_conflicting_parallel_fields() {
        let mut bare = root("AE_TAG_CWV=7\n[MFNR]\nMF_TAG_A=4\n");
        assert!(merge_payload(
            &mut bare,
            root("[AE]\nAE_TAG_CWV=999\nAE_TAG_NEW=8\n[MF]\nMF_TAG_A=999\nMF_TAG_B=5\n")
        ));
        assert_eq!(bare["AE_TAG_CWV"].as_integer(), Some(7));
        assert!(bare["AE"].get("AE_TAG_CWV").is_none());
        assert_eq!(bare["MFNR"]["MF_TAG_A"].as_integer(), Some(4));
        assert_eq!(bare["MFNR"]["MF_TAG_B"].as_integer(), Some(5));
        assert!(bare.get("MF").is_none());
        let mut nested = root("[AE]\nAE_TAG_CWV=7\n");
        assert!(merge_payload(
            &mut nested,
            root("AE_TAG_CWV=999\nAE_TAG_NEW=8\n")
        ));
        assert!(nested.get("AE_TAG_CWV").is_none());
        assert_eq!(nested["AE"]["AE_TAG_CWV"].as_integer(), Some(7));
    }
    #[test]
    fn statistics_are_borrow_checked_and_never_resize_an_existing_block() {
        let mut current = root("[AE_Table.shared]\nrows=1\ncolumns=2\nvalues=[1,2]\n");
        assert!(merge_payload(&mut current, root("[AE_Table.shared]\nrows=2\ncolumns=2\nvalues=[9,9,9,9]\n[AE_Table.new]\nrows=1\ncolumns=1\nvalues=[3]\n[AE_Table.bad]\nrows=5\ncolumns=5\nvalues=[1,2]\n")));
        assert_eq!(current["AE_Table"]["shared"]["rows"].as_integer(), Some(1));
        assert_eq!(
            current["AE_Table"]["shared"]["values"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert!(current["AE_Table"].get("bad").is_none());
        assert!(!has_payload(&root("[AE_DISPLAY]\nextra=1\n[Detail]\nextra=2\n[AE_Table.bad]\nrows=2\ncolumns=2\nvalues=[1]\n")));
    }
    #[test]
    fn explicit_dp_replacement_discards_old_business_fields_and_accepts_invalid_old_bytes() {
        for previous in [
            b"[AE]\nOLD=7\n[Vendor_Raw]\nDATA='old'\n".as_slice(),
            b"broken=[".as_slice(),
            &[0xff, 0xfe],
        ] {
            let fixture = Fixture::new(previous);
            assert!(fixture.replace("[AF]\nPOS=[9,8]\n").unwrap());
            let replaced = root(std::str::from_utf8(&fixture.bytes()).unwrap());
            assert!(replaced.get("AE").is_none());
            assert!(replaced.get("Vendor_Raw").is_none());
            assert_eq!(replaced["AF"]["POS"].as_array().unwrap().len(), 2);
            assert_eq!(
                replaced[PROVENANCE]["parser"].as_str(),
                Some("debug_parser")
            );
            assert_eq!(
                replaced[PROVENANCE]["content_mode"].as_str(),
                Some("replace")
            );
        }
    }
    #[test]
    fn empty_or_invalid_dp_payload_cannot_destroy_old_content_or_clear_partial() {
        let fixture =
            Fixture::new(b"[AE]\nA=7\n[__luxe_exif]\nparser='native'\nneeds_fallback=true\n");
        let before = fixture.bytes();
        assert!(!fixture.replace("").unwrap());
        assert!(!fixture
            .replace("[AE_Table.bad]\nrows=5\ncolumns=5\nvalues=[1,2]\n")
            .unwrap());
        assert_eq!(fixture.bytes(), before);
    }
    #[test]
    fn dp_replacement_preserves_readonly_and_ambiguous_targets() {
        let fixture = Fixture::new(b"[AE]\nA=7\n");
        let before = fixture.bytes();
        let path = fixture.0.join("image.toml");
        let permissions = fs::metadata(&path).unwrap().permissions();
        let mut locked = permissions.clone();
        locked.set_readonly(true);
        fs::set_permissions(&path, locked).unwrap();
        assert!(fixture.replace("[AF]\nNEW=1\n").is_err());
        assert_eq!(fixture.bytes(), before);
        fs::set_permissions(&path, permissions).unwrap();
        fs::write(fixture.0.join("image.png"), b"another owner").unwrap();
        assert!(fixture.replace("[AF]\nNEW=1\n").is_err());
        assert_eq!(fixture.bytes(), before);
    }
    #[test]
    fn dp_replacement_refuses_oversized_old_bytes_and_non_dp_provenance() {
        let fixture = Fixture::new(b"invalid old UTF-8 is not permission to remove read limits");
        let path = fixture.0.join("image.toml");
        assert!(replace_debug_parser_metadata(
            &fixture.0.join("image.jpg"),
            &path,
            "[AE]\nA=7\n[__luxe_exif]\nparser='native'\n"
        )
        .is_err());
        let old_len = MAX_TEXT_BYTES + 1;
        OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(old_len)
            .unwrap();
        assert!(fixture.replace("[AF]\nNEW=1\n").is_err());
        assert_eq!(fs::metadata(path).unwrap().len(), old_len);
    }
    #[test]
    fn atomic_publication_rejects_concurrent_raw_edits_and_new_files() {
        let fixture = Fixture::new(b"invalid old TOML is still protected");
        let scope = DirectoryScope::new(&fixture.0).unwrap();
        let path = fixture.0.join("image.toml");
        let previous = FileSnapshot::read(&scope, &path).unwrap().unwrap();
        let edited = fixture.0.join("editor.tmp");
        fs::write(&edited, b"new editor bytes").unwrap();
        fs::rename(&edited, &path).unwrap();
        assert!(write_prepared_atomic(&scope, &path, "[AE]\nA=3\n", Some(&previous)).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"new editor bytes");
        let appeared = fixture.0.join("appeared.toml");
        fs::write(&appeared, b"USER=1\n").unwrap();
        assert!(write_prepared_atomic(&scope, &appeared, "[AE]\nA=3\n", None).is_err());
        assert_eq!(fs::read(&appeared).unwrap(), b"USER=1\n");
        assert!(fs::read_dir(&fixture.0).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
    }
    #[test]
    fn worker_budget_and_legacy_history_remain_bounded_and_compatible() {
        assert!((1..=2).contains(&worker_count()));
        let document = root("[__luxe_exif.preparation]\nfirst_source='jpeg'\nselected_source='toml'\ndecision='existing_retained'\nsignature={parser_revision='obsolete'}\n");
        let preparation = read_preparation(&document).unwrap();
        assert_eq!(preparation.first_source, "jpeg");
        assert_eq!(preparation.selected_source, "toml");
    }
}
