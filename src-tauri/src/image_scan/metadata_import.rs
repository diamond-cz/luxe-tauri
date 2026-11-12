//! Import-time reconciliation of one JPEG and its TOML at a time.
//!
//! The only cache is a versioned signature in the selected TOML. No image bytes,
//! parsed documents, or completed directory results survive this call. A native
//! partial result is useful content, not a claim that DebugParser is unnecessary.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use super::{exif_document, mtk_exif, ExifParseProgress, ImageEntry};
use crate::error::{AppError, AppResult};

const PROVENANCE: &str = "__luxe_exif";
// build.rs hashes the exact decoder, comparison policy and header catalog;
// cached unsupported versions automatically become eligible after an update.
const PARSER_REVISION: &str = env!("LUXE_MTK_METADATA_REVISION");
const MAX_TEXT_BYTES: u64 = 16 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES: usize = 262_144;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
pub struct ImageMetadataPreparationResult {
    pub entries: Vec<ImageEntry>,
    pub summary: ImageMetadataPreparationSummary,
}

#[derive(Debug, Default, Serialize)]
pub struct ImageMetadataPreparationSummary {
    pub total: usize,
    pub created: usize,
    pub replaced: usize,
    pub retained: usize,
    pub cached: usize,
    pub unavailable: usize,
    pub failed: usize,
    pub partial: usize,
}

#[derive(Debug, Clone, Serialize)]
pub(super) struct ImageMetadataPreparation {
    pub(super) first_source: String,
    pub(super) selected_source: String,
    pub(super) decision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    signature: Option<PreparationSignature>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct PreparationSignature {
    schema_version: u8,
    parser_revision: String,
    image_path: String,
    image_size: u64,
    image_modified: String,
    payload_fingerprint: String,
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
        // An older/damaged optimization must not discard valid source history.
        signature: preparation
            .get("signature")
            .and_then(|value| value.clone().try_into().ok()),
    })
}

/// Stamp an already reconciled DP payload; the caller determines its actual
/// needs_fallback status and must not pass an incomplete payload as complete.
/// Invalid previous TOML is an error, not permission to forget source history.
pub(super) fn stamp_fallback_preparation(
    contents: &str,
    previous: Option<&str>,
) -> AppResult<String> {
    let mut root: toml::Value = toml::from_str(contents)?;
    let previous = previous.map(toml::from_str::<toml::Value>).transpose()?;
    let first_source = previous
        .as_ref()
        .and_then(read_preparation)
        .map(|preparation| preparation.first_source)
        .unwrap_or_else(|| {
            previous
                .as_ref()
                .filter(|root| coverage(root).usable())
                .map(selected_source)
                .unwrap_or("debug_parser")
                .into()
        });
    let provenance = provenance_mut(&mut root)?;
    provenance.insert("schema_version".into(), toml::Value::Integer(1));
    provenance.insert("parser".into(), toml::Value::String("debug_parser".into()));
    provenance
        .entry("needs_fallback")
        .or_insert(toml::Value::Boolean(true));
    provenance
        .entry("modules")
        .or_insert_with(|| toml::Value::Array(Vec::new()));
    provenance.insert(
        "preparation".into(),
        toml::Value::try_from(ImageMetadataPreparation {
            first_source,
            selected_source: "debug_parser".into(),
            decision: "fallback".into(),
            // DP changes the payload. Reconcile its coverage again on import.
            signature: None,
        })?,
    );
    Ok(toml::to_string(&root)?)
}

/// Apply already decoded DP data without another JPEG inspection. Every source
/// is additive: native/legacy scalars keep their values, repeated observations
/// keep their prefix, and existing statistics blocks keep their complete shape.
/// Provenance or an empty DP document alone cannot resolve a partial result.
pub(super) fn apply_debug_parser_fallback(
    image_path: &Path,
    toml_path: &Path,
    contents: &str,
) -> AppResult<bool> {
    if contents.len() as u64 > MAX_TEXT_BYTES {
        return Err(AppError::Invalid(
            "DebugParser metadata exceeds the 16 MiB limit".into(),
        ));
    }
    if !is_image(image_path)
        || !toml_path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| extension.eq_ignore_ascii_case("toml"))
    {
        return Err(AppError::Invalid(
            "fallback requires an image and a same-stem TOML".into(),
        ));
    }
    let parent = image_path
        .parent()
        .ok_or_else(|| AppError::Invalid("fallback image has no directory".into()))?;
    let scope = DirectoryScope::new(parent)?;
    let inventory = Inventory::read(&scope)?;
    let name = image_path
        .file_stem()
        .and_then(|name| name.to_str())
        .ok_or_else(|| AppError::Invalid("fallback image has no valid stem".into()))?;
    inventory.check(&ImageEntry {
        name: name.into(),
        jpg_path: image_path.to_string_lossy().into_owned(),
        toml_path: toml_path.to_string_lossy().into_owned(),
    })?;
    scope.check_parent(toml_path)?;
    if let Some((_, actual)) = inventory.tomls.get(&folded(name)) {
        if fs::canonicalize(actual)? != fs::canonicalize(toml_path)? {
            return Err(AppError::Invalid(
                "fallback target is not the unique existing TOML".into(),
            ));
        }
    }
    let image_guard = open_checked(&scope, image_path, false)?;
    let image_before = image_signature(image_path, &image_guard.metadata()?)?;
    let previous = ExistingToml::read(&scope, toml_path)?;
    let incoming: toml::Value = toml::from_str(contents)?;
    let dp_provenance = incoming
        .get(PROVENANCE)
        .and_then(toml::Value::as_table)
        .ok_or_else(|| AppError::Invalid("fallback is missing DebugParser provenance".into()))?;
    if dp_provenance.get("parser").and_then(toml::Value::as_str) != Some("debug_parser") {
        return Err(AppError::Invalid(
            "fallback payload must identify DebugParser".into(),
        ));
    }
    let mut merged = previous
        .as_ref()
        .map(|previous| previous.root.clone())
        .unwrap_or_else(empty_root);
    let before = coverage(&merged);
    merge_fallback_payload(&mut merged, &incoming);
    let after = coverage(&merged);
    let gained_fields = after.fields.iter().any(|(key, kinds)| {
        before
            .fields
            .get(key)
            .is_none_or(|old| kinds.len() > old.len())
    });
    let gained_tables = after
        .tables
        .keys()
        .any(|key| !before.tables.contains_key(key));
    if !gained_fields && !gained_tables {
        return Ok(false);
    }
    for key in ["AE_DISPLAY", "Detail"] {
        if let Some(value) = incoming.get(key) {
            if let Some(current) = merged.as_table_mut().and_then(|root| root.get_mut(key)) {
                fill_missing(current, value);
            } else if let Some(root) = merged.as_table_mut() {
                root.insert(key.into(), value.clone());
            }
        }
    }
    let provenance = provenance_mut(&mut merged)?;
    // Keep verified native diagnostics, including unsupported/version-only
    // rows. DP rows describe independent text decoding, not a matched header.
    let mut modules = provenance
        .get("modules")
        .and_then(toml::Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(additional) = dp_provenance.get("modules").and_then(toml::Value::as_array) {
        for module in additional {
            if !modules.contains(module) {
                if modules.len() >= 256 {
                    return Err(AppError::Invalid(
                        "merged EXIF module diagnostics exceed their budget".into(),
                    ));
                }
                modules.push(module.clone());
            }
        }
    }
    for (key, value) in dp_provenance {
        if !matches!(key.as_str(), "preparation" | "modules" | "needs_fallback") {
            provenance
                .entry(key.clone())
                .or_insert_with(|| value.clone());
        }
    }
    provenance.insert("modules".into(), toml::Value::Array(modules));
    provenance.insert(
        "needs_fallback".into(),
        toml::Value::Boolean(
            dp_provenance
                .get("needs_fallback")
                .and_then(toml::Value::as_bool)
                .unwrap_or(true),
        ),
    );
    let output = stamp_fallback_preparation(
        &toml::to_string(&merged)?,
        previous.as_ref().map(|previous| previous.text.as_str()),
    )?;
    if output.len() as u64 > MAX_TEXT_BYTES {
        return Err(AppError::Invalid(
            "merged metadata exceeds the 16 MiB limit".into(),
        ));
    }
    if image_signature(image_path, &fs::symlink_metadata(image_path)?)?.image_identity()
        != image_before.image_identity()
    {
        return Err(AppError::Invalid(
            "image changed during DebugParser reconciliation".into(),
        ));
    }
    write_prepared_atomic(&scope, toml_path, &output, previous.as_ref())?;
    super::clear_memory_caches();
    Ok(true)
}

fn merge_fallback_payload(current: &mut toml::Value, incoming: &toml::Value) {
    let (Some(current), Some(incoming)) = (current.as_table_mut(), incoming.as_table()) else {
        return;
    };
    for (name, value) in incoming {
        if matches!(name.as_str(), PROVENANCE | "AE_DISPLAY" | "Detail") {
            continue;
        }
        if name == "AE_Table" {
            let mut only_tables = empty_root();
            if let Some(blocks) = value.as_table() {
                for (block_name, block) in blocks {
                    let mut single = toml::map::Map::new();
                    single.insert(block_name.clone(), block.clone());
                    let mut valid = Coverage::default();
                    statistics_coverage(&toml::Value::Table(single), &mut valid);
                    if !valid.opaque && valid.tables.contains_key(block_name) {
                        only_tables
                            .as_table_mut()
                            .expect("empty table")
                            .insert(block_name.clone(), block.clone());
                    }
                }
            }
            if only_tables
                .as_table()
                .is_some_and(|table| !table.is_empty())
            {
                if let Some(existing) = current.get_mut(name) {
                    if let (Some(existing), Some(additional)) =
                        (existing.as_table_mut(), only_tables.as_table())
                    {
                        for (block_name, block) in additional {
                            existing
                                .entry(block_name.clone())
                                .or_insert_with(|| block.clone());
                        }
                    }
                } else {
                    current.insert(name.clone(), only_tables);
                }
            }
            continue;
        }
        // Avoid parallel bare/nested aliases that would disagree in the flat
        // reader's lowercase aliases. Known root tags stay with their owner.
        if let Some(module) = flat_tag_module(name) {
            let owners: Vec<_> = current
                .iter()
                .filter(|(key, value)| value.is_table() && canonical_module(key) == module)
                .map(|(key, _)| key.clone())
                .collect();
            if owners.len() > 1 {
                continue;
            }
            if !current.contains_key(name) {
                if let Some(owner) = owners.first() {
                    if let Some(table) = current.get_mut(owner).and_then(toml::Value::as_table_mut)
                    {
                        if let Some(existing) = table.get_mut(name) {
                            merge_missing_observations(existing, value);
                        } else {
                            table.insert(name.clone(), value.clone());
                        }
                        continue;
                    }
                }
            }
        }
        let mut incoming_value = value.clone();
        if let Some(fields) = incoming_value.as_table_mut() {
            for key in fields.keys().cloned().collect::<Vec<_>>() {
                if flat_tag_module(&key) == Some(canonical_module(name))
                    && current.contains_key(&key)
                {
                    if let Some(additional) = fields.remove(&key) {
                        merge_missing_observations(
                            current.get_mut(&key).expect("checked root tag"),
                            &additional,
                        );
                    }
                }
            }
        }
        let value = &incoming_value;
        let matching: Vec<_> = current
            .keys()
            .filter(|candidate| canonical_module(candidate) == canonical_module(name))
            .cloned()
            .collect();
        // Do not guess which legacy alias owns a tag when two old sections
        // already claim the same module identity.
        if matching.len() > 1 {
            continue;
        }
        let selected = matching.into_iter().next().unwrap_or_else(|| name.clone());
        if let Some(existing) = current.get_mut(&selected) {
            merge_missing_observations(existing, value);
        } else {
            let mut missing = empty_root();
            if value.is_table() {
                merge_missing_observations(&mut missing, value);
                if missing.as_table().is_some_and(|table| !table.is_empty()) {
                    current.insert(selected, missing);
                }
            } else if scalar_kind(value).is_some()
                || value.as_array().is_some_and(|values| {
                    !values.is_empty() && values.iter().all(|value| scalar_kind(value).is_some())
                })
            {
                current.insert(selected, value.clone());
            }
        }
    }
}

fn merge_missing_observations(current: &mut toml::Value, incoming: &toml::Value) {
    if let (Some(current), Some(incoming)) = (current.as_table_mut(), incoming.as_table()) {
        for (name, value) in incoming {
            if let Some(existing) = current.get_mut(name) {
                merge_missing_observations(existing, value);
            } else if value.is_table() {
                let mut missing = empty_root();
                merge_missing_observations(&mut missing, value);
                if missing.as_table().is_some_and(|table| !table.is_empty()) {
                    current.insert(name.clone(), missing);
                }
            } else if scalar_kind(value).is_some()
                || value.as_array().is_some_and(|values| {
                    !values.is_empty() && values.iter().all(|value| scalar_kind(value).is_some())
                })
            {
                current.insert(name.clone(), value.clone());
            }
        }
        return;
    }
    let Some(incoming) = incoming.as_array() else {
        return;
    };
    if incoming.is_empty() || incoming.iter().any(|value| scalar_kind(value).is_none()) {
        return;
    }
    if let Some(existing) = current.as_array_mut() {
        if incoming.len() > existing.len()
            && existing.iter().zip(incoming).all(|(old, new)| {
                scalar_kind(old).is_some() && scalar_kind(old) == scalar_kind(new)
            })
        {
            existing.extend_from_slice(&incoming[existing.len()..]);
        }
    } else if scalar_kind(current) == scalar_kind(&incoming[0]) && incoming.len() > 1 {
        let first = current.clone();
        *current = toml::Value::Array(
            std::iter::once(first)
                .chain(incoming[1..].iter().cloned())
                .collect(),
        );
    }
}

/// JPEG-first import. Errors are isolated to an image, except for an unsafe or
/// unreadable directory. Progress counts finished images, including failures.
pub fn prepare_image_metadata(
    image_dir: &Path,
    mut on_progress: impl FnMut(ExifParseProgress),
) -> AppResult<ImageMetadataPreparationResult> {
    let scope = DirectoryScope::new(image_dir)?;
    let inventory = Inventory::read(&scope)?;
    let mut entries = super::scan_directory(&scope.requested)?;
    let mut summary = ImageMetadataPreparationSummary {
        total: entries.len(),
        ..Default::default()
    };
    on_progress(ExifParseProgress {
        stage: "JPEG",
        completed: 0,
        total: entries.len(),
    });
    let mut changed = false;
    for (index, entry) in entries.iter_mut().enumerate() {
        if let Some((_, path)) = inventory.tomls.get(&folded(&entry.name)) {
            entry.toml_path = path.to_string_lossy().into_owned();
        }
        match prepare_one(&scope, &inventory, entry) {
            Ok(outcome) => {
                match outcome.decision {
                    OutcomeKind::Created => summary.created += 1,
                    OutcomeKind::Replaced => summary.replaced += 1,
                    OutcomeKind::Retained => summary.retained += 1,
                    OutcomeKind::Cached => summary.cached += 1,
                    OutcomeKind::Unavailable => summary.unavailable += 1,
                }
                summary.failed += usize::from(outcome.native_failed);
                summary.partial += usize::from(outcome.partial);
                changed |= outcome.changed;
            }
            Err(error) => {
                summary.failed += 1;
                tracing::warn!(path = %entry.jpg_path, %error, "image metadata preparation failed; original TOML retained");
            }
        }
        on_progress(ExifParseProgress {
            stage: "JPEG",
            completed: index + 1,
            total: summary.total,
        });
    }
    if changed {
        super::clear_memory_caches();
    }
    Ok(ImageMetadataPreparationResult { entries, summary })
}

#[derive(Clone, Copy)]
enum OutcomeKind {
    Created,
    Replaced,
    Retained,
    Cached,
    Unavailable,
}

struct Outcome {
    decision: OutcomeKind,
    changed: bool,
    native_failed: bool,
    partial: bool,
}

fn prepare_one(
    scope: &DirectoryScope,
    inventory: &Inventory,
    entry: &ImageEntry,
) -> AppResult<Outcome> {
    let image = Path::new(&entry.jpg_path);
    let target = Path::new(&entry.toml_path);
    inventory.check(entry)?;
    scope.regular_file(image)?.ok_or_else(|| {
        AppError::NotFound(format!(
            "image disappeared during import: {}",
            image.display()
        ))
    })?;
    let image_guard = open_checked(scope, image, false)?;
    let signature = image_signature(image, &image_guard.metadata()?)?;
    let previous = ExistingToml::read(scope, target)?;
    let previous_root = previous.as_ref().map(|previous| &previous.root);
    let previous_preparation = previous_root.and_then(read_preparation);
    if let Some(previous) = previous.as_ref() {
        let mut expected = signature.clone();
        expected.payload_fingerprint = payload_fingerprint(&previous.root);
        if previous_preparation
            .as_ref()
            .and_then(|preparation| preparation.signature.as_ref())
            == Some(&expected)
        {
            return Ok(Outcome {
                decision: OutcomeKind::Cached,
                changed: false,
                native_failed: false,
                partial: is_partial(&previous.root),
            });
        }
    }

    let mut native_failed = false;
    let native = if is_jpeg(image) {
        match super::read_jpeg_metadata(image) {
            Ok(metadata) => match mtk_exif::inspect_exif_with_progress(&metadata, |_, _| {}) {
                Ok(output) => Some(output),
                Err(error) => {
                    // A well-formed JPEG with no MTK APP data is unavailable,
                    // rather than an exceptional or repeatedly retried image.
                    native_failed = error != "not an MTK JPEG";
                    tracing::debug!(path = %image.display(), %error, "native import metadata unavailable");
                    None
                }
            },
            Err(error) => {
                native_failed = true;
                tracing::warn!(path = %image.display(), %error, "read native import metadata failed");
                None
            }
        }
    } else {
        None
    };
    if native_failed && previous.is_some() {
        // An actual I/O/decoder failure is not evidence for changing a user's
        // file, even just its provenance. Metadata-only failure caching is
        // allowed only when there is no existing TOML to protect.
        return Err(AppError::Invalid(
            "native metadata read/decode failed; existing TOML left unchanged".into(),
        ));
    }
    let native_root = native
        .as_ref()
        .map(|output| toml::from_str::<toml::Value>(&output.toml))
        .transpose()?;
    let native_coverage = native_root.as_ref().map(coverage);
    let native_usable = native_coverage.as_ref().is_some_and(Coverage::usable);
    let previous_coverage = previous_root.map(coverage);
    let previous_usable = previous_coverage.as_ref().is_some_and(Coverage::usable);
    let first_source = previous_preparation
        .map(|preparation| preparation.first_source)
        .unwrap_or_else(|| {
            if native_usable {
                "jpeg"
            } else if previous_usable {
                selected_source(previous_root.expect("usable previous root"))
            } else {
                "none"
            }
            .into()
        });
    let replace = native_usable
        && previous_coverage.as_ref().is_some_and(|previous| {
            strictly_covers(
                native_coverage.as_ref().expect("usable native root"),
                previous,
            )
        });
    let select_native = native_usable && (!previous_usable || replace);
    let (mut root, kind, decision, selected) = if select_native {
        let output = native.expect("usable native result");
        let text = exif_document::stamp_export(
            &output.toml,
            "native",
            output.modules,
            output.needs_fallback,
        )?;
        let mut root = toml::from_str(&text)?;
        if let Some(previous) = previous_root {
            preserve_auxiliary(&mut root, previous);
        }
        if previous_usable {
            (root, OutcomeKind::Replaced, "native_replaced", "jpeg")
        } else {
            (root, OutcomeKind::Created, "native_created", "jpeg")
        }
    } else if previous_usable {
        let previous = previous_root.expect("usable previous root");
        (
            previous.clone(),
            OutcomeKind::Retained,
            if native_usable {
                "existing_retained"
            } else {
                "native_unavailable"
            },
            selected_source(previous),
        )
    } else {
        // Keep diagnostic modules for unsupported MTK JPEGs, even with no
        // business fields. PNG/ordinary JPEGs get an explicit metadata-only
        // record, never a fabricated successful parse.
        let mut root = if let Some(output) = native {
            toml::from_str(&exif_document::stamp_export(
                &output.toml,
                "native",
                output.modules,
                true,
            )?)?
        } else {
            previous_root.cloned().unwrap_or_else(empty_root)
        };
        if let Some(previous) = previous_root {
            preserve_auxiliary(&mut root, previous);
        }
        (root, OutcomeKind::Unavailable, "unavailable", "none")
    };
    let partial = is_partial(&root);
    let mut signature = signature;
    let provenance = provenance_mut(&mut root)?;
    provenance.insert("schema_version".into(), toml::Value::Integer(1));
    if !provenance
        .get("parser")
        .and_then(toml::Value::as_str)
        .is_some_and(|parser| matches!(parser, "native" | "debug_parser" | "unknown"))
    {
        provenance.insert("parser".into(), toml::Value::String("unknown".into()));
    }
    provenance
        .entry("modules")
        .or_insert_with(|| toml::Value::Array(Vec::new()));
    if matches!(kind, OutcomeKind::Unavailable) {
        provenance.insert("needs_fallback".into(), toml::Value::Boolean(true));
    } else {
        provenance
            .entry("needs_fallback")
            .or_insert(toml::Value::Boolean(false));
    }
    signature.payload_fingerprint = payload_fingerprint(&root);
    provenance_mut(&mut root)?.insert(
        "preparation".into(),
        toml::Value::try_from(ImageMetadataPreparation {
            first_source,
            selected_source: selected.into(),
            decision: decision.into(),
            signature: Some(signature.clone()),
        })?,
    );
    let contents = toml::to_string(&root)?;
    if contents.len() as u64 > MAX_TEXT_BYTES {
        return Err(AppError::Invalid(
            "prepared metadata exceeds the 16 MiB limit".into(),
        ));
    }
    // Pin/validate the image until publication; changing its timestamp or size
    // must not attach a signature for different bytes to this output.
    if image_signature(image, &fs::symlink_metadata(image)?)?.image_identity()
        != signature.image_identity()
    {
        return Err(AppError::Invalid(
            "image changed during metadata preparation".into(),
        ));
    }
    write_prepared_atomic(scope, target, &contents, previous.as_ref())?;
    Ok(Outcome {
        decision: kind,
        changed: true,
        native_failed,
        partial,
    })
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

fn selected_source(root: &toml::Value) -> &'static str {
    match root
        .get(PROVENANCE)
        .and_then(|root| root.get("parser"))
        .and_then(toml::Value::as_str)
    {
        Some("native") => "jpeg",
        Some("debug_parser") => "debug_parser",
        _ => "toml",
    }
}

fn is_partial(root: &toml::Value) -> bool {
    selected_source(root) == "jpeg"
        && root
            .get(PROVENANCE)
            .and_then(|root| root.get("needs_fallback"))
            .and_then(toml::Value::as_bool)
            == Some(true)
        && coverage(root).usable()
}

fn preserve_auxiliary(native: &mut toml::Value, previous: &toml::Value) {
    let (Some(native), Some(previous)) = (native.as_table_mut(), previous.as_table()) else {
        return;
    };
    for key in ["AE_DISPLAY", "Detail", PROVENANCE] {
        if let Some(old) = previous.get(key) {
            if let Some(current) = native.get_mut(key) {
                fill_missing(current, old);
            } else {
                native.insert(key.into(), old.clone());
            }
        }
    }
}

fn fill_missing(current: &mut toml::Value, previous: &toml::Value) {
    if let (Some(current), Some(previous)) = (current.as_table_mut(), previous.as_table()) {
        for (key, value) in previous {
            if let Some(current) = current.get_mut(key) {
                fill_missing(current, value);
            } else {
                current.insert(key.clone(), value.clone());
            }
        }
    }
}

// Compare identities and cardinalities, not aggregate field counts. Values are
// supplied by the authoritative JPEG only after coverage is a strict superset;
// equal coverage intentionally retains a user's existing values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ScalarKind {
    Number,
    String,
    Boolean,
    Datetime,
}

#[derive(Default)]
struct Coverage {
    fields: BTreeMap<Vec<String>, Vec<ScalarKind>>,
    tables: BTreeMap<String, (usize, usize)>,
    opaque: bool,
}

impl Coverage {
    fn usable(&self) -> bool {
        self.opaque || !self.fields.is_empty() || !self.tables.is_empty()
    }
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
        // Unknown original sections are not guessed from a broad prefix.
        _ => name,
    }
}

// Bare legacy tags have an unambiguous module only for these established
// prefixes. Unknown roots are still preserved rather than guessed from counts.
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

fn coverage(root: &toml::Value) -> Coverage {
    let mut result = Coverage::default();
    let Some(root) = root.as_table() else {
        result.opaque = true;
        return result;
    };
    for (name, value) in root {
        if matches!(name.as_str(), PROVENANCE | "AE_DISPLAY" | "Detail") {
            continue;
        }
        if name == "AE_Table" {
            statistics_coverage(value, &mut result);
        } else {
            let mut path = if !value.is_table() {
                flat_tag_module(name)
                    .map(|module| vec![module.into(), name.clone()])
                    .unwrap_or_else(|| vec![canonical_module(name).into()])
            } else {
                vec![canonical_module(name).into()]
            };
            collect_fields(value, &mut path, &mut result);
        }
    }
    result
}

fn collect_fields(value: &toml::Value, path: &mut Vec<String>, result: &mut Coverage) {
    if let Some(table) = value.as_table() {
        for (key, value) in table {
            path.push(key.clone());
            collect_fields(value, path, result);
            path.pop();
        }
        return;
    }
    let kinds = if let Some(values) = value.as_array() {
        if values.is_empty() {
            result.opaque = true;
            return;
        }
        values.iter().map(scalar_kind).collect::<Option<Vec<_>>>()
    } else {
        scalar_kind(value).map(|kind| vec![kind])
    };
    if let Some(kinds) = kinds {
        // Two legacy sections normalizing to the same identity are ambiguous,
        // not two interchangeable observations that can be silently merged.
        if result.fields.insert(path.clone(), kinds).is_some() {
            result.opaque = true;
        }
    } else {
        result.opaque = true;
    }
}

fn statistics_coverage(value: &toml::Value, result: &mut Coverage) {
    let Some(blocks) = value.as_table() else {
        result.opaque = true;
        return;
    };
    let mut projection = empty_root();
    projection
        .as_table_mut()
        .expect("empty table")
        .insert("AE_Table".into(), value.clone());
    let tables = exif_document::take_ae_tables(&mut projection);
    for (name, block) in blocks {
        // Free-form/raw statistics can contain ignored/truncated blocks. Keep
        // them conservatively rather than proving coverage from a subset.
        let known = !block.is_str()
            && tables.iter().any(|table| &table.name == name)
            && block.as_table().is_none_or(|fields| {
                fields
                    .keys()
                    .all(|key| matches!(key.as_str(), "rows" | "columns" | "values" | "name"))
                    && fields
                        .get("name")
                        .is_none_or(|value| value.as_str() == Some(name))
            });
        if !known {
            result.opaque = true;
        }
    }
    for table in tables {
        result
            .tables
            .insert(table.name, (table.rows, table.columns));
    }
}

fn strictly_covers(native: &Coverage, previous: &Coverage) -> bool {
    if native.opaque || previous.opaque {
        return false;
    }
    let covers_fields = previous.fields.iter().all(|(key, kinds)| {
        native.fields.get(key).is_some_and(|new| {
            new.len() >= kinds.len() && new.iter().zip(kinds).all(|(new, old)| new == old)
        })
    });
    let covers_tables = previous
        .tables
        .iter()
        .all(|(name, shape)| native.tables.get(name) == Some(shape));
    covers_fields
        && covers_tables
        && (native.fields.len() > previous.fields.len()
            || native.tables.len() > previous.tables.len()
            || previous.fields.iter().any(|(key, kinds)| {
                native
                    .fields
                    .get(key)
                    .is_some_and(|new| new.len() > kinds.len())
            }))
}

// Stable, non-cryptographic content checksum. Type/length delimiters and sorted
// keys distinguish nested paths, arrays, strings, and user-created raw sections.
// Only __luxe_exif.preparation is excluded: edits to parser diagnostics or the
// needs_fallback flag also invalidate the signature, but our own stamp is stable.
fn payload_fingerprint(root: &toml::Value) -> String {
    struct Fingerprint(u64, u64);
    impl Fingerprint {
        fn bytes(&mut self, bytes: &[u8]) {
            for byte in (bytes.len() as u64).to_le_bytes().iter().chain(bytes) {
                self.0 = (self.0 ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
                self.1 = (self.1 ^ u64::from(*byte)).wrapping_mul(0x9e3779b185ebca87);
            }
        }
        fn table(&mut self, table: &toml::map::Map<String, toml::Value>, preparation: bool) {
            self.bytes(b"table");
            let mut entries: Vec<_> = table.iter().collect();
            entries.sort_by(|a, b| a.0.cmp(b.0));
            for (name, value) in entries {
                if preparation && name == "preparation" {
                    continue;
                }
                self.bytes(name.as_bytes());
                self.value(value);
            }
            self.bytes(b"end-table");
        }
        fn value(&mut self, value: &toml::Value) {
            match value {
                toml::Value::Table(table) => self.table(table, false),
                toml::Value::Array(values) => {
                    self.bytes(b"array");
                    self.bytes(&(values.len() as u64).to_le_bytes());
                    for value in values {
                        self.value(value);
                    }
                }
                toml::Value::String(value) => {
                    self.bytes(b"string");
                    self.bytes(value.as_bytes());
                }
                toml::Value::Integer(value) => {
                    self.bytes(b"int");
                    self.bytes(&value.to_le_bytes());
                }
                toml::Value::Float(value) => {
                    self.bytes(b"float");
                    self.bytes(&value.to_bits().to_le_bytes());
                }
                toml::Value::Boolean(value) => {
                    self.bytes(b"bool");
                    self.bytes(&[u8::from(*value)]);
                }
                toml::Value::Datetime(value) => {
                    self.bytes(b"date");
                    self.bytes(value.to_string().as_bytes());
                }
            }
        }
    }
    let mut hash = Fingerprint(0xcbf29ce484222325, 0x84222325cbf29ce4);
    if let Some(table) = root.as_table() {
        let mut entries: Vec<_> = table.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        for (name, value) in entries {
            hash.bytes(name.as_bytes());
            if name == PROVENANCE {
                if let Some(table) = value.as_table() {
                    hash.table(table, true);
                    continue;
                }
            }
            hash.value(value);
        }
    }
    format!("{:016x}{:016x}", hash.0, hash.1)
}

impl PreparationSignature {
    fn image_identity(&self) -> (&str, u64, &str) {
        (&self.image_path, self.image_size, &self.image_modified)
    }
}

fn image_signature(path: &Path, metadata: &fs::Metadata) -> AppResult<PreparationSignature> {
    if !metadata.is_file() || is_link(metadata) {
        return Err(AppError::Invalid(
            "image is not a regular non-reparse file".into(),
        ));
    }
    let modified = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| AppError::Invalid(format!("invalid image timestamp: {error}")))?;
    let canonical = fs::canonicalize(path)?;
    let identity = canonical
        .to_str()
        .ok_or_else(|| AppError::Invalid("image path is not UTF-8".into()))?;
    #[cfg(windows)]
    let identity = identity.to_lowercase();
    #[cfg(not(windows))]
    let identity = identity.to_string();
    Ok(PreparationSignature {
        schema_version: 1,
        parser_revision: PARSER_REVISION.into(),
        image_path: identity,
        image_size: metadata.len(),
        image_modified: modified.as_nanos().to_string(),
        payload_fingerprint: String::new(),
    })
}

fn folded(name: &str) -> String {
    name.to_lowercase()
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
        if !path.is_absolute() || path.to_str().is_none_or(|path| path.len() > 32_768) {
            return Err(AppError::Invalid(
                "metadata preparation requires a bounded absolute directory".into(),
            ));
        }
        for component in path.components() {
            match component {
                Component::CurDir | Component::ParentDir => {
                    return Err(AppError::Invalid(
                        "metadata preparation cannot traverse relative components".into(),
                    ))
                }
                Component::Normal(name) if !name.to_str().is_some_and(valid_name) => {
                    return Err(AppError::Invalid(
                        "unsafe metadata directory component".into(),
                    ))
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
                        "metadata preparation rejects device namespaces".into(),
                    ))
                }
                _ => {}
            }
        }
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
        let canonical = fs::canonicalize(path)?;
        Ok(Self {
            requested: path.to_path_buf(),
            canonical,
            _handles: handles,
        })
    }

    fn check_parent(&self, path: &Path) -> io::Result<()> {
        for directory in directory_chain(&self.requested) {
            check_directory(&directory)?;
        }
        if fs::canonicalize(&self.requested)? != self.canonical
            || path.parent() != Some(self.requested.as_path())
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
                // Include directories and links with image-like names: they
                // cannot become an alternative owner of the same TOML.
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
        // Deny new writers while reconciling. Images also deny rename/delete;
        // old TOMLs must permit delete-sharing for atomic rename replacement.
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

struct ExistingToml {
    text: String,
    root: toml::Value,
    metadata: fs::Metadata,
    _guard: File,
}

impl ExistingToml {
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
        // Read the checked, pinned handle rather than reopening its pathname:
        // delete-sharing is needed for atomic replacement, so an editor could
        // rename that pathname while this handle still protects the old file.
        // Keep the same 16 MiB/UTF-8 boundary as MetadataSource::read_text.
        let mut bytes = Vec::new();
        (&guard).take(MAX_TEXT_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_TEXT_BYTES {
            return Err(AppError::Invalid(
                "existing image metadata exceeds the 16 MiB limit".into(),
            ));
        }
        let text = String::from_utf8(bytes).map_err(|error| {
            AppError::Invalid(format!("existing image metadata is not UTF-8: {error}"))
        })?;
        let root: toml::Value = toml::from_str(&text)?;
        if root.get(PROVENANCE).is_some_and(|value| !value.is_table()) {
            return Err(AppError::Invalid(
                "reserved EXIF provenance is not a table".into(),
            ));
        }
        Ok(Some(Self {
            text,
            root,
            metadata,
            _guard: guard,
        }))
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
    previous: Option<&ExistingToml>,
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
            let mut current_text = String::new();
            open_checked(scope, path, true)?
                .take(MAX_TEXT_BYTES + 1)
                .read_to_string(&mut current_text)?;
            if current_text != previous.text {
                return Err(AppError::Invalid(
                    "existing metadata was edited during import; original retained".into(),
                ));
            }
            fs::rename(&temporary, path)?;
        }
        (None, None) => {
            // Atomic no-clobber publication. Unlike rename on Unix (and some
            // Windows wrappers), hard_link fails if a new user file appeared.
            fs::hard_link(&temporary, path)?;
        }
        _ => {
            return Err(AppError::Invalid(
                "metadata target appeared/disappeared during import; original retained".into(),
            ))
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(text: &str) -> Coverage {
        coverage(&toml::from_str::<toml::Value>(text).unwrap())
    }

    #[test]
    fn legacy_bare_tags_and_nested_modules_do_not_create_conflicting_aliases() {
        let mut bare: toml::Value = toml::from_str("AE_TAG_CWV = 7\n").unwrap();
        let dp = toml::from_str("[AE]\nAE_TAG_CWV=999\nAE_TAG_NEW=8\n").unwrap();
        merge_fallback_payload(&mut bare, &dp);
        assert_eq!(bare["AE_TAG_CWV"].as_integer(), Some(7));
        assert!(bare["AE"].get("AE_TAG_CWV").is_none());
        assert_eq!(bare["AE"]["AE_TAG_NEW"].as_integer(), Some(8));
        assert!(!coverage(&bare).opaque);

        let mut nested = toml::from_str("[AE]\nAE_TAG_CWV=7\n").unwrap();
        let dp = toml::from_str("AE_TAG_CWV=999\nAE_TAG_NEW=8\n").unwrap();
        merge_fallback_payload(&mut nested, &dp);
        assert!(nested.get("AE_TAG_CWV").is_none());
        assert_eq!(nested["AE"]["AE_TAG_CWV"].as_integer(), Some(7));
        assert_eq!(nested["AE"]["AE_TAG_NEW"].as_integer(), Some(8));
        assert!(!coverage(&nested).opaque);
    }

    struct FallbackFixture(PathBuf);
    impl FallbackFixture {
        fn new(previous: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let dir = std::env::temp_dir().join(format!(
                "luxe-dp-import-{}-{nonce}-{}",
                std::process::id(),
                TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&dir).unwrap();
            fs::write(
                dir.join("image.jpg"),
                b"fallback never parses these image bytes",
            )
            .unwrap();
            fs::write(dir.join("image.toml"), previous).unwrap();
            Self(dir)
        }
        fn apply(&self, payload: &str, needs_fallback: bool) -> AppResult<bool> {
            let contents =
                exif_document::stamp_export(payload, "debug_parser", Vec::new(), needs_fallback)?;
            apply_debug_parser_fallback(
                &self.0.join("image.jpg"),
                &self.0.join("image.toml"),
                &contents,
            )
        }
        fn root(&self) -> toml::Value {
            toml::from_str(&fs::read_to_string(self.0.join("image.toml")).unwrap()).unwrap()
        }
        fn bytes(&self) -> Vec<u8> {
            fs::read(self.0.join("image.toml")).unwrap()
        }
    }
    impl Drop for FallbackFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn dp_merge_preserves_native_scalars_nested_fields_and_repeat_prefixes() {
        let previous = "[AE]\nA=7\n[AE.nested]\nKEEP=8\n[AF]\nPOS=[10,20]\n[MFNR]\nMF_TAG_A=4\n[__luxe_exif]\nparser='native'\nneeds_fallback=true\nmodules=[]\n[__luxe_exif.preparation]\nfirst_source='jpeg'\nselected_source='jpeg'\ndecision='native_created'\nsignature={parser_revision='old'}\n";
        let fixture = FallbackFixture::new(previous);
        assert!(fixture.apply("[AE]\nA=999\n[AE.nested]\nKEEP=999\nNEW=1\n[AF]\nPOS=[90,80,30,40]\n[MF]\nMF_TAG_A=999\nMF_TAG_B=5\n", true).unwrap());
        let root = fixture.root();
        assert_eq!(root["AE"]["A"].as_integer(), Some(7));
        assert_eq!(root["AE"]["nested"]["KEEP"].as_integer(), Some(8));
        assert_eq!(root["AE"]["nested"]["NEW"].as_integer(), Some(1));
        assert_eq!(
            root["AF"]["POS"]
                .as_array()
                .unwrap()
                .iter()
                .map(toml::Value::as_integer)
                .collect::<Option<Vec<_>>>()
                .unwrap(),
            vec![10, 20, 30, 40]
        );
        assert_eq!(root["MFNR"]["MF_TAG_A"].as_integer(), Some(4));
        assert_eq!(root["MFNR"]["MF_TAG_B"].as_integer(), Some(5));
        assert!(root.get("MF").is_none());
        assert_eq!(root[PROVENANCE]["needs_fallback"].as_bool(), Some(true));
        let preparation = read_preparation(&root).unwrap();
        assert_eq!(preparation.first_source, "jpeg");
        assert_eq!(preparation.selected_source, "debug_parser");
        assert_eq!(preparation.decision, "fallback");
        assert!(root[PROVENANCE]["preparation"].get("signature").is_none());
    }

    #[test]
    fn dp_statistics_keep_old_complete_blocks_and_add_only_valid_new_blocks() {
        let fixture = FallbackFixture::new("[AE_Table.shared]\nrows=1\ncolumns=2\nvalues=[1,2]\n[__luxe_exif]\nparser='native'\nneeds_fallback=true\nmodules=[]\n");
        assert!(fixture.apply("[AE_Table.shared]\nrows=2\ncolumns=2\nvalues=[9,9,9,9]\n[AE_Table.new]\nrows=1\ncolumns=1\nvalues=[3]\n[AE_Table.invalid]\nrows=5\ncolumns=5\nvalues=[1,2]\n", false).unwrap());
        let root = fixture.root();
        assert_eq!(root["AE_Table"]["shared"]["rows"].as_integer(), Some(1));
        assert_eq!(
            root["AE_Table"]["shared"]["values"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert_eq!(
            root["AE_Table"]["new"]["values"].as_array().unwrap()[0].as_integer(),
            Some(3)
        );
        assert!(root["AE_Table"].get("invalid").is_none());
    }

    #[test]
    fn dp_no_gain_cannot_clear_partial_and_metadata_only_can_later_be_filled() {
        let previous = "[__luxe_exif]\nparser='native'\nneeds_fallback=true\nmodules=[]\n[__luxe_exif.preparation]\nfirst_source='none'\nselected_source='none'\ndecision='unavailable'\n";
        let fixture = FallbackFixture::new(previous);
        let original = fixture.bytes();
        assert!(!fixture.apply("", false).unwrap());
        assert!(!fixture
            .apply("[AE_Table.bad]\nrows=5\ncolumns=5\nvalues=[1,2]\n", false)
            .unwrap());
        assert_eq!(fixture.bytes(), original);
        assert_eq!(
            fixture.root()[PROVENANCE]["needs_fallback"].as_bool(),
            Some(true)
        );
        assert!(fixture.apply("[AF]\nPOS=7\n", false).unwrap());
        let root = fixture.root();
        assert_eq!(root[PROVENANCE]["needs_fallback"].as_bool(), Some(false));
        assert_eq!(
            root[PROVENANCE]["preparation"]["first_source"].as_str(),
            Some("none")
        );
        assert_eq!(
            root[PROVENANCE]["preparation"]["selected_source"].as_str(),
            Some("debug_parser")
        );
    }

    #[test]
    fn dp_legacy_merge_never_shortens_repeats_or_drops_unknown_raw_sections() {
        let fixture =
            FallbackFixture::new("[AF]\nPOS=[1,2,3]\n[Vendor_Raw]\nDATA='preserve raw'\n");
        assert!(fixture
            .apply("[AF]\nPOS=[999]\n[AE]\nNEW=4\n", false)
            .unwrap());
        let root = fixture.root();
        assert_eq!(root["AF"]["POS"].as_array().unwrap().len(), 3);
        assert_eq!(
            root["AF"]["POS"].as_array().unwrap()[0].as_integer(),
            Some(1)
        );
        assert_eq!(root["Vendor_Raw"]["DATA"].as_str(), Some("preserve raw"));
        assert_eq!(
            root[PROVENANCE]["preparation"]["first_source"].as_str(),
            Some("toml")
        );
    }

    #[test]
    fn dp_apply_reuses_existing_file_and_unique_owner_protection() {
        let fixture = FallbackFixture::new("# byte-identical on failure\n[AE]\nA=1\n");
        let original = fixture.bytes();
        let target = fixture.0.join("image.toml");
        let permissions = fs::metadata(&target).unwrap().permissions();
        let mut read_only = permissions.clone();
        read_only.set_readonly(true);
        fs::set_permissions(&target, read_only).unwrap();
        assert!(fixture.apply("[AF]\nNEW=7\n", false).is_err());
        assert_eq!(fixture.bytes(), original);
        fs::set_permissions(&target, permissions).unwrap();
        fs::write(fixture.0.join("image.png"), b"another owner").unwrap();
        assert!(fixture.apply("[AF]\nNEW=7\n", false).is_err());
        assert_eq!(fixture.bytes(), original);
    }

    #[test]
    fn coverage_checks_identity_multiplicity_and_shape_not_aggregate_counts() {
        assert!(!strictly_covers(
            &profile("[AE]\nA=1\nB=2\nC=3\n"),
            &profile("[AF]\nA=1\n")
        ));
        assert!(!strictly_covers(
            &profile("[AE]\nA=1\nB=2\n"),
            &profile("[AE]\nA=[1,2]\n")
        ));
        assert!(strictly_covers(
            &profile("[AE]\nA=[5,6,7]\n"),
            &profile("[AE]\nA=[1,2]\n")
        ));
        assert!(!strictly_covers(
            &profile("[AE]\nA=9\n"),
            &profile("[AE]\nA=1\n")
        ));
        assert!(!strictly_covers(
            &profile("[AE]\nA=1\n[AE_DISPLAY]\nextra=4\n[Detail]\nextra=9\n"),
            &profile("[AE]\nA=1\n")
        ));
        assert!(strictly_covers(
            &profile("[MFNR]\nMF_TAG_A=1\nMF_TAG_B=2\n"),
            &profile("[MF]\nMF_TAG_A=3\n")
        ));
        assert!(!strictly_covers(
            &profile("[ISP]\nA=1\nB=2\n"),
            &profile("[ISP_HW]\nA=1\n[ISP_SW]\nA=1\n")
        ));
        assert!(!strictly_covers(
            &profile("[AE]\nA=1\nB=2\n"),
            &profile("[Unknown_Raw]\nA=1\n")
        ));
    }

    #[test]
    fn statistics_require_each_identity_and_exact_shape_without_invalid_raw_loss() {
        let values = (0..25)
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let old = format!("[AE_Table.grid]\nrows=5\ncolumns=5\nvalues=[{values}]\n");
        let new = format!("{old}\n[AE]\nEXTRA=1\n");
        assert!(strictly_covers(&profile(&new), &profile(&old)));
        let wrong_shape = new.replace("rows=5\ncolumns=5", "rows=1\ncolumns=25");
        assert!(!strictly_covers(&profile(&wrong_shape), &profile(&old)));
        assert!(!strictly_covers(
            &profile(&new),
            &profile(&old.replace("grid", "other"))
        ));
        assert!(!strictly_covers(
            &profile(&new),
            &profile("[AE_Table.raw]\nrows=5\ncolumns=5\nvalues=[1,2]\n")
        ));
        assert!(!strictly_covers(
            &profile(&new),
            &profile("[AE_Table]\nraw='unknown raw statistics'\n")
        ));
    }

    #[test]
    fn checksum_excludes_only_preparation_and_tracks_business_and_diagnostic_edits() {
        let mut root: toml::Value = toml::from_str("[AE]\nA=1\n[__luxe_exif]\nneeds_fallback=true\n[__luxe_exif.preparation]\nfirst_source='jpeg'\n").unwrap();
        let before = payload_fingerprint(&root);
        root[PROVENANCE]["preparation"]["first_source"] = toml::Value::String("toml".into());
        assert_eq!(payload_fingerprint(&root), before);
        root[PROVENANCE]["needs_fallback"] = toml::Value::Boolean(false);
        assert_ne!(payload_fingerprint(&root), before);
        root[PROVENANCE]["needs_fallback"] = toml::Value::Boolean(true);
        root["AE"]["A"] = toml::Value::Integer(2);
        assert_ne!(payload_fingerprint(&root), before);
    }

    #[test]
    fn atomic_publication_rejects_a_changed_or_newly_created_user_file() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir =
            std::env::temp_dir().join(format!("luxe-import-atomic-{}-{nonce}", std::process::id()));
        fs::create_dir(&dir).unwrap();
        {
            let scope = DirectoryScope::new(&dir).unwrap();
            let path = dir.join("image.toml");
            fs::write(&path, "[AE]\nA=1\n").unwrap();
            let previous = ExistingToml::read(&scope, &path).unwrap().unwrap();
            let edited = dir.join("editor.tmp");
            fs::write(&edited, "[AE]\nA=2\n").unwrap();
            fs::rename(&edited, &path).unwrap();
            assert!(write_prepared_atomic(&scope, &path, "[AE]\nA=3\n", Some(&previous)).is_err());
            assert_eq!(fs::read_to_string(&path).unwrap(), "[AE]\nA=2\n");
            drop(previous);
            let appeared = dir.join("appeared.toml");
            fs::write(&appeared, "[AE]\nUSER=1\n").unwrap();
            assert!(write_prepared_atomic(&scope, &appeared, "[AE]\nA=3\n", None).is_err());
            assert_eq!(fs::read_to_string(&appeared).unwrap(), "[AE]\nUSER=1\n");
            assert!(fs::read_dir(&dir).unwrap().all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")));
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn fallback_stamp_preserves_first_source_and_payload_fallback_flag() {
        let previous = "[AE]\nA=1\n[__luxe_exif]\nparser='native'\nneeds_fallback=true\n[__luxe_exif.preparation]\nfirst_source='jpeg'\nselected_source='jpeg'\ndecision='native_created'\n";
        let text = stamp_fallback_preparation(
            "[AF]\nB=[1,2]\n[__luxe_exif]\nneeds_fallback=true\n",
            Some(previous),
        )
        .unwrap();
        let root: toml::Value = toml::from_str(&text).unwrap();
        let preparation = read_preparation(&root).unwrap();
        assert_eq!(preparation.first_source, "jpeg");
        assert_eq!(preparation.selected_source, "debug_parser");
        assert_eq!(preparation.decision, "fallback");
        assert!(preparation.signature.is_none());
        assert_eq!(root[PROVENANCE]["needs_fallback"].as_bool(), Some(true));
        assert_eq!(root["AF"]["B"].as_array().unwrap().len(), 2);
        assert!(stamp_fallback_preparation("[AE]\nA=1\n", Some("broken=[")).is_err());
    }
}
