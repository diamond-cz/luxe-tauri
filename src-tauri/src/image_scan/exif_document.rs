//! On-demand EXIF presentation, statistics and explicit export provenance.
//! No document cache: only the currently mounted EXIF view owns this payload.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::metadata_source::MetadataSource;
use super::{collect_toml_sections, mtk_exif, read_jpeg_metadata, ImageTomlSection};
use crate::error::{AppError, AppResult};

const PROVENANCE_KEY: &str = "__luxe_exif";
const MAX_TABLE_VALUES: usize = 65_536;
const MAX_TABLES: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageExifTable {
    pub name: String,
    pub rows: usize,
    pub columns: usize,
    pub values: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageExifModule {
    pub module: String,
    pub header: Option<String>,
    pub status: String,
    pub version: Option<String>,
    pub signature: Option<String>,
    pub identity_source: String,
    pub decoded_fields: usize,
    pub parse_status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageExifSource {
    pub kind: &'static str,
    pub parser: String,
    pub path: String,
    pub content_mode: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageMetadataImportInfo {
    pub first_source: String,
    pub selected_source: String,
    pub decision: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImageExifDocument {
    pub sections: Vec<ImageTomlSection>,
    pub ae_tables: Vec<ImageExifTable>,
    pub modules: Vec<ImageExifModule>,
    pub source: ImageExifSource,
    pub needs_fallback: bool,
    pub preparation: Option<ImageMetadataImportInfo>,
}

#[derive(Serialize, Deserialize)]
struct ExportProvenance {
    schema_version: u8,
    parser: String,
    needs_fallback: bool,
    modules: Vec<ImageExifModule>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    content_mode: Option<String>,
}

pub fn load_image_exif(path: &Path) -> AppResult<ImageExifDocument> {
    load_image_exif_with_progress(path, |_| {})
}

pub fn load_image_exif_with_progress(
    path: &Path,
    on_progress: impl FnMut(super::ExifParseProgress),
) -> AppResult<ImageExifDocument> {
    project_image_exif(MetadataSource::resolve(path)?, on_progress)
}

pub fn load_prepared_image_exif(path: &Path) -> AppResult<ImageExifDocument> {
    project_image_exif(MetadataSource::prepared(path)?, |_| {})
}

fn project_image_exif(
    source: MetadataSource,
    mut on_progress: impl FnMut(super::ExifParseProgress),
) -> AppResult<ImageExifDocument> {
    let source_path = source.path().to_string_lossy().into_owned();
    if source.is_direct() {
        on_progress(source.progress(0));
        let metadata = read_jpeg_metadata(source.path())?;
        on_progress(source.progress(1));
        let output = mtk_exif::inspect_exif_with_progress(&metadata, |completed, _| {
            on_progress(source.progress(1 + completed));
        })
        .map_err(AppError::Other)?;
        let mut root: toml::Value = toml::from_str(&output.toml)?;
        let sections = presentation_sections(&mut root);
        on_progress(source.progress(source.progress_total()));
        return Ok(ImageExifDocument {
            sections,
            ae_tables: output.ae_tables,
            modules: output.modules,
            source: ImageExifSource {
                kind: "jpeg",
                parser: "native".into(),
                path: source_path,
                content_mode: Some("native".into()),
            },
            needs_fallback: output.needs_fallback,
            preparation: None,
        });
    }
    let text = source.read_text_with_progress(&mut on_progress)?;
    let mut root: toml::Value = toml::from_str(&text)?;
    let preparation =
        super::metadata_import::read_preparation(&root).map(|info| ImageMetadataImportInfo {
            first_source: info.first_source,
            selected_source: info.selected_source,
            decision: info.decision,
        });
    let mut provenance = root
        .as_table_mut()
        .and_then(|table| table.remove(PROVENANCE_KEY))
        .and_then(|value| value.try_into::<ExportProvenance>().ok())
        .filter(|value| {
            value.schema_version == 1
                && matches!(value.parser.as_str(), "native" | "debug_parser" | "unknown")
        });
    let ae_tables = take_ae_tables(&mut root);
    let sections = presentation_sections(&mut root);
    let stored_modules = provenance
        .as_mut()
        .map(|value| std::mem::take(&mut value.modules))
        .filter(|modules| valid_modules(modules));
    let modules = if provenance
        .as_ref()
        .and_then(|value| value.content_mode.as_deref())
        == Some("native_merge")
    {
        // Older merged TOMLs may already contain accumulated parse history.
        // Normalize the view too, without rewriting the automatically reused file.
        merged_content_modules(&root, stored_modules.unwrap_or_default())?
    } else {
        stored_modules
            .filter(|modules| !modules.is_empty())
            .unwrap_or_else(|| unrecorded_modules(&sections))
    };
    let needs_fallback = provenance
        .as_ref()
        .is_some_and(|value| value.needs_fallback)
        || (sections.iter().all(|section| section.fields.is_empty()) && ae_tables.is_empty());
    on_progress(source.progress(source.progress_total()));
    Ok(ImageExifDocument {
        sections,
        ae_tables,
        modules,
        source: ImageExifSource {
            kind: "toml",
            parser: provenance
                .as_ref()
                .map(|value| value.parser.clone())
                .unwrap_or_else(|| "unknown".into()),
            path: source_path,
            content_mode: provenance
                .as_ref()
                .and_then(|value| value.content_mode.clone())
                .filter(|mode| {
                    matches!(
                        mode.as_str(),
                        "native" | "native_merge" | "metadata_only" | "replace"
                    )
                }),
        },
        needs_fallback,
        preparation,
    })
}

fn valid_modules(modules: &[ImageExifModule]) -> bool {
    modules.len() <= 256
        && modules.iter().all(|item| {
            !item.module.is_empty()
                && item.module.len() <= 128
                && item.header.as_ref().is_none_or(|name| name.len() <= 1024)
                && item.decoded_fields <= 100_000
                && matches!(
                    item.status.as_str(),
                    "matched"
                        | "missing_header"
                        | "invalid_header"
                        | "ambiguous"
                        | "unknown"
                        | "unrecorded"
                )
                && matches!(
                    item.identity_source.as_str(),
                    "directory" | "directory_layout" | "payload" | "toml" | "unrecorded"
                )
                && matches!(
                    item.parse_status.as_str(),
                    "decoded" | "empty" | "version_only" | "unsupported" | "unavailable"
                )
                && [&item.version, &item.signature].into_iter().all(|value| {
                    value.as_ref().is_none_or(|word| {
                        word.len() == 10
                            && word.starts_with("0x")
                            && u32::from_str_radix(&word[2..], 16).is_ok()
                    })
                })
        })
}

fn presentation_sections(root: &mut toml::Value) -> Vec<ImageTomlSection> {
    let mut sections = Vec::new();
    if let Some(table) = root.as_table_mut() {
        table.remove(PROVENANCE_KEY);
        table.remove("AE_Table");
        collect_toml_sections("", table, &mut sections);
    }
    sections
}

fn unrecorded_modules(sections: &[ImageTomlSection]) -> Vec<ImageExifModule> {
    let mut result: Vec<ImageExifModule> = Vec::new();
    for section in sections {
        let root = section
            .name
            .split(['.', '['])
            .next()
            .unwrap_or(&section.name);
        if root == "AE_DISPLAY" || root == "Detail" || section.fields.is_empty() {
            continue;
        }
        let upper = root.to_ascii_uppercase();
        let name = match upper.as_str() {
            "SENSOR" => "Sensor",
            "SHADING" => "Shading",
            "STROBE" => "Strobe",
            "MF" => "MFNR",
            "CMN" | "COMMON" => "Common",
            "RESVA" => "SWNR",
            "RESVB" => "BMDN",
            "STRING" => "String",
            _ if upper.starts_with("ISP_") => "ISP",
            _ => root,
        };
        if let Some(module) = result.iter_mut().find(|module| module.module == name) {
            module.decoded_fields += section.fields.len();
        } else if result.len() < 256 {
            result.push(ImageExifModule {
                module: name.into(),
                header: None,
                status: "unrecorded".into(),
                version: None,
                signature: None,
                identity_source: "toml".into(),
                decoded_fields: section.fields.len(),
                parse_status: "decoded".into(),
            });
        }
    }
    result
}

/// A merged module's content no longer belongs to one binary enum alone.
/// Count its actual saved observations, do not accumulate historical parse rows
/// or claim a native header describes the retained legacy/DP-only fields.
pub(super) fn merged_content_modules(
    root: &toml::Value,
    diagnostics: Vec<ImageExifModule>,
) -> AppResult<Vec<ImageExifModule>> {
    fn count(value: &toml::Value) -> usize {
        match value {
            toml::Value::Table(table) => table
                .values()
                .fold(0usize, |total, value| total.saturating_add(count(value))),
            toml::Value::Array(values) => values
                .iter()
                .fold(0usize, |total, value| total.saturating_add(count(value))),
            _ => 1,
        }
    }
    fn module_name(name: &str, is_table: bool) -> String {
        if !is_table {
            for (prefix, module) in [
                ("AE_TAG_", "AE"),
                ("AF_TAG_", "AF"),
                ("AWB_TAG_", "AWB"),
                ("MF_TAG_", "MFNR"),
                ("CMN_TAG_", "Common"),
                ("SHAD_", "Shading"),
                ("FL_T_", "Strobe"),
            ] {
                if name.starts_with(prefix) {
                    return module.into();
                }
            }
            return "Root".into();
        }
        match name.to_ascii_uppercase().as_str() {
            "AE" => "AE".into(),
            "AF" => "AF".into(),
            "AWB" => "AWB".into(),
            "ISP" => "ISP".into(),
            "N3D" => "N3D".into(),
            "SWNR" => "SWNR".into(),
            "BMDN" => "BMDN".into(),
            "SENSOR" => "Sensor".into(),
            "SHADING" => "Shading".into(),
            "STROBE" => "Strobe".into(),
            "MF" | "MFNR" => "MFNR".into(),
            "CMN" | "COMMON" => "Common".into(),
            "RESVA" => "SWNR".into(),
            "RESVB" => "BMDN".into(),
            "STRING" => "String".into(),
            value if value.starts_with("ISP_") => "ISP".into(),
            _ => name.into(),
        }
    }
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    if let Some(table) = root.as_table() {
        for (name, value) in table {
            if matches!(
                name.as_str(),
                PROVENANCE_KEY | "AE_DISPLAY" | "Detail" | "AE_Table"
            ) {
                continue;
            }
            let observations = count(value);
            if observations == 0 {
                continue;
            }
            let module = module_name(name, value.is_table());
            let total = counts.entry(module.clone()).or_default();
            *total = total.saturating_add(observations);
            if module.len() > 128 || *total > 100_000 || counts.len() > 256 {
                return Err(AppError::Invalid(
                    "merged EXIF module/count exceeds the diagnostic budget".into(),
                ));
            }
        }
    }
    let mut result: Vec<_> = counts
        .iter()
        .map(|(module, count)| ImageExifModule {
            module: module.clone(),
            header: None,
            status: "unrecorded".into(),
            version: None,
            signature: None,
            identity_source: "toml".into(),
            decoded_fields: *count,
            parse_status: "decoded".into(),
        })
        .collect();
    // Only the latest native inspection supplies diagnostic-only modules. Old
    // mixed files are also normalized on read; newer rows win for named modules.
    let mut seen_names = BTreeSet::new();
    let mut seen_raw = BTreeSet::new();
    let mut additional = Vec::new();
    for mut diagnostic in diagnostics.into_iter().rev() {
        diagnostic.module = module_name(&diagnostic.module, true);
        if counts.contains_key(&diagnostic.module) {
            if diagnostic.status == "ambiguous" {
                if let Some(content) = result
                    .iter_mut()
                    .find(|row| row.module == diagnostic.module)
                {
                    content.status = "ambiguous".into();
                }
            }
            continue;
        }
        diagnostic.decoded_fields = 0;
        if diagnostic.parse_status == "decoded" {
            diagnostic.parse_status = "empty".into();
        }
        let raw = diagnostic.module == "Unknown"
            || diagnostic.module.starts_with("Unknown ")
            || diagnostic.status == "ambiguous";
        if raw {
            if !seen_raw.insert((
                diagnostic.module.clone(),
                diagnostic.version.clone(),
                diagnostic.signature.clone(),
                diagnostic.status.clone(),
            )) {
                continue;
            }
        } else if !seen_names.insert(diagnostic.module.clone()) {
            continue;
        }
        additional.push(diagnostic);
    }
    additional.reverse();
    if result.len() + additional.len() > 256 {
        return Err(AppError::Invalid(
            "merged EXIF module diagnostics exceed their budget".into(),
        ));
    }
    result.extend(additional);
    Ok(result)
}

pub(super) fn stamp_export(
    text: &str,
    parser: &str,
    modules: Vec<ImageExifModule>,
    needs_fallback: bool,
) -> AppResult<String> {
    let mut root: toml::Value = toml::from_str(text)?;
    stamp_export_root(&mut root, parser, modules, needs_fallback)?;
    Ok(toml::to_string(&root)?)
}

fn stamp_export_root(
    root: &mut toml::Value,
    parser: &str,
    modules: Vec<ImageExifModule>,
    needs_fallback: bool,
) -> AppResult<()> {
    let table = root
        .as_table_mut()
        .ok_or_else(|| AppError::Invalid("EXIF export is not a table".into()))?;
    let provenance = ExportProvenance {
        schema_version: 1,
        parser: parser.into(),
        needs_fallback,
        modules,
        content_mode: Some(
            if parser == "debug_parser" {
                "replace"
            } else {
                "native"
            }
            .into(),
        ),
    };
    table.insert(PROVENANCE_KEY.into(), toml::Value::try_from(provenance)?);
    Ok(())
}

fn valid_table(table: &ImageExifTable) -> bool {
    !table.name.is_empty()
        && table.name.len() <= 128
        && table.rows > 0
        && table.columns > 0
        && table.rows <= 512
        && table.columns <= 512
        && table
            .rows
            .checked_mul(table.columns)
            .is_some_and(|count| count <= MAX_TABLE_VALUES && count == table.values.len())
}

pub(super) fn take_ae_tables(root: &mut toml::Value) -> Vec<ImageExifTable> {
    let Some(toml::Value::Table(table)) =
        root.as_table_mut().and_then(|root| root.remove("AE_Table"))
    else {
        return Vec::new();
    };
    let mut result = Vec::new();
    for (name, value) in table {
        if result.len() >= MAX_TABLES {
            break;
        }
        let parsed = if let Some(block) = value.as_table() {
            (|| {
                Some(ImageExifTable {
                    name: name.clone(),
                    rows: usize::try_from(block.get("rows")?.as_integer()?).ok()?,
                    columns: usize::try_from(block.get("columns")?.as_integer()?).ok()?,
                    values: block
                        .get("values")?
                        .as_array()?
                        .iter()
                        .map(toml::Value::as_integer)
                        .collect::<Option<Vec<_>>>()?,
                })
            })()
        } else if let Some(values) = value.as_array() {
            values
                .iter()
                .map(toml::Value::as_integer)
                .collect::<Option<Vec<_>>>()
                .and_then(|values| table_from_values(&name, values))
        } else if let Some(text) = value.as_str() {
            if name.eq_ignore_ascii_case("raw") || text.contains("<<") {
                for table in parse_statistics_text(text) {
                    if result.len() >= MAX_TABLES {
                        break;
                    }
                    if !result
                        .iter()
                        .any(|previous: &ImageExifTable| previous.name == table.name)
                    {
                        result.push(table);
                    }
                }
                None
            } else {
                parse_numeric_lines(text).and_then(|values| table_from_values(&name, values))
            }
        } else {
            None
        };
        if let Some(parsed) = parsed.filter(valid_table) {
            if !result.iter().any(|previous| previous.name == parsed.name) {
                result.push(parsed);
            }
        }
    }
    result
}

fn parse_numeric_lines(text: &str) -> Option<Vec<i64>> {
    let mut values = Vec::new();
    for token in text.split_whitespace() {
        if values.len() >= MAX_TABLE_VALUES {
            return None;
        }
        values.push(token.trim_end_matches(',').parse().ok()?);
    }
    (!values.is_empty()).then_some(values)
}

fn table_from_values(name: &str, values: Vec<i64>) -> Option<ImageExifTable> {
    // Older DP text may prefix histogram labels. Keep the original display name.
    let layout_name = name.strip_prefix("Histogram_").unwrap_or(name);
    let dimensions = match layout_name {
        "5x5" | "5x5_LE" | "5x5_SE" | "5x5_Y" | "5x5_R" | "5x5_G" | "5x5_B" | "5x5_OverCnt" => {
            (5, 5)
        }
        "15x15_LE" | "15x15_SE" | "15x15_Y" | "15x15_R" | "15x15_G" | "15x15_B"
        | "15x15_OverCnt" | "15x15 Y" | "15x15 R" | "15x15 G" | "15x15 B" | "15x15 OverCnt" => {
            (15, 15)
        }
        "8_6_LE_Y" | "8_6_LE_R" | "8_6_LE_G" | "8_6_LE_B" => (6, 8),
        "Central_Y" | "Full_Y" | "Full_RGB" if values.len() == 1024 => (64, 16),
        "LE_RGB_MAX" | "LE_Y" | "SE_Y" if values.len() == 256 => (16, 16),
        _ if name.starts_with("HIST") && values.len() == 128 => (8, 16),
        _ => return None,
    };
    let table = ImageExifTable {
        name: name.into(),
        rows: dimensions.0,
        columns: dimensions.1,
        values,
    };
    valid_table(&table).then_some(table)
}

fn parse_statistics_text(text: &str) -> Vec<ImageExifTable> {
    let mut result = Vec::new();
    let mut name: Option<&str> = None;
    let mut lines = String::new();
    let finish = |name: Option<&str>, lines: &str, result: &mut Vec<ImageExifTable>| {
        if result.len() >= MAX_TABLES {
            return;
        }
        if let Some(table) = name.and_then(|name| {
            parse_numeric_lines(lines).and_then(|values| table_from_values(name, values))
        }) {
            result.push(table);
        }
    };
    for line in text.lines().map(str::trim) {
        if let Some(next) = line
            .strip_prefix("<<")
            .and_then(|line| line.strip_suffix(">>"))
        {
            finish(name, &lines, &mut result);
            name = Some(next.trim());
            lines.clear();
        } else if name.is_some() {
            lines.push_str(line);
            lines.push('\n');
        }
    }
    finish(name, &lines, &mut result);
    result
}

/// Convert DebugParser text without dropping its free-form AE_Table rows.
/// Existing scalar sections and repeated AF values remain compatible.
pub(super) fn debug_parser_to_toml(text: &str) -> AppResult<Option<String>> {
    let mut root = toml::map::Map::new();
    let mut section: Option<String> = None;
    let mut statistics = String::new();
    for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if line.starts_with('[') && line.ends_with(']') {
            let name = line[1..line.len() - 1].trim();
            section = (!name.is_empty()).then(|| name.to_string());
            continue;
        }
        if section.as_deref() == Some("AE_Table") {
            statistics.push_str(line);
            statistics.push('\n');
            continue;
        }
        for pair in line.split('|') {
            let Some((key, value)) = pair.split_once(':') else {
                continue;
            };
            let key = key.trim();
            let value = value.trim();
            if key.is_empty() || value.is_empty() {
                continue;
            }
            let parsed = if let Ok(number) = value.parse::<i64>() {
                toml::Value::Integer(number)
            } else if let Ok(number) = value.parse::<f64>() {
                if number.is_finite() {
                    toml::Value::Float(number)
                } else {
                    toml::Value::String(value.into())
                }
            } else {
                toml::Value::String(value.into())
            };
            let fields = if let Some(name) = section.as_ref() {
                root.entry(name.clone())
                    .or_insert_with(|| toml::Value::Table(toml::map::Map::new()))
                    .as_table_mut()
            } else {
                Some(&mut root)
            };
            if let Some(fields) = fields {
                match fields.get_mut(key) {
                    Some(toml::Value::Array(values)) => values.push(parsed),
                    Some(previous) => {
                        let first = previous.clone();
                        *previous = toml::Value::Array(vec![first, parsed]);
                    }
                    None => {
                        fields.insert(key.into(), parsed);
                    }
                }
            }
        }
    }
    let tables = parse_statistics_text(&statistics);
    if !tables.is_empty() {
        let mut fields = toml::map::Map::new();
        for table in tables {
            fields.insert(table.name.clone(), toml::Value::try_from(table)?);
        }
        root.insert("AE_Table".into(), toml::Value::Table(fields));
    }
    if root.is_empty() {
        return Ok(None);
    }
    // Keep the parsed value until the final serialization. Avoid constructing
    // section strings or serializing and parsing this same DP document twice.
    let mut root = toml::Value::Table(root);
    let modules = merged_content_modules(&root, Vec::new())?;
    stamp_export_root(&mut root, "debug_parser", modules, false)?;
    Ok(Some(toml::to_string(&root)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn diagnostic(module: &str, count: usize) -> ImageExifModule {
        ImageExifModule {
            module: module.into(),
            header: Some(format!("{module}/native.h")),
            status: "matched".into(),
            version: Some("0x0000000B".into()),
            signature: Some("0xE28FA520".into()),
            identity_source: "directory".into(),
            decoded_fields: count,
            parse_status: "decoded".into(),
        }
    }

    #[test]
    fn merged_diagnostics_count_saved_content_once_and_do_not_claim_binary_header_ownership() {
        let root: toml::Value = toml::from_str("AE_TAG_EXTRA=9\n[AE]\nA=7\n[AF]\nPOS=[1,2,3]\n[ISP_HW_P1]\nX=1\n[ISP_HW_P2]\nY=2\n[Vendor_Raw]\nKEEP='v'\n[AE_DISPLAY]\niso=50\n[Detail]\nextra='auxiliary'\n[AE_Table.grid]\nrows=1\ncolumns=1\nvalues=[99]\n").unwrap();
        let mut sensor = diagnostic("Sensor", 0);
        sensor.parse_status = "version_only".into();
        let modules = merged_content_modules(
            &root,
            vec![
                diagnostic("AE", 99),
                diagnostic("AE", 400),
                diagnostic("AF", 999),
                sensor.clone(),
                sensor,
            ],
        )
        .unwrap();
        for (name, count) in [("AE", 2), ("AF", 3), ("ISP", 2), ("Vendor_Raw", 1)] {
            let rows: Vec<_> = modules.iter().filter(|row| row.module == name).collect();
            assert_eq!(rows.len(), 1, "one current-content row for {name}");
            assert_eq!(rows[0].decoded_fields, count);
            assert_eq!(rows[0].status, "unrecorded");
            assert_eq!(rows[0].identity_source, "toml");
            assert!(
                rows[0].header.is_none()
                    && rows[0].version.is_none()
                    && rows[0].signature.is_none()
            );
        }
        let sensor: Vec<_> = modules
            .iter()
            .filter(|row| row.module == "Sensor")
            .collect();
        assert_eq!(sensor.len(), 1);
        assert_eq!(sensor[0].parse_status, "version_only");
        assert_eq!(sensor[0].decoded_fields, 0);
        assert_eq!(
            modules.len(),
            5,
            "statistics/summary/auxiliary metadata are not tag counts"
        );
    }

    #[test]
    fn merged_diagnostics_preserve_current_ambiguity_and_unique_unknown_directory_records() {
        let root: toml::Value = toml::from_str("[AE]\nKEEP=1\n").unwrap();
        let mut ambiguous = diagnostic("AE", 0);
        ambiguous.status = "ambiguous".into();
        ambiguous.parse_status = "unavailable".into();
        let mut unknown = diagnostic("Unknown", 0);
        unknown.status = "unknown".into();
        unknown.parse_status = "unsupported".into();
        let mut another = unknown.clone();
        another.signature = Some("0x00000001".into());
        let modules = merged_content_modules(
            &root,
            vec![
                ambiguous.clone(),
                ambiguous,
                unknown.clone(),
                unknown,
                another,
            ],
        )
        .unwrap();
        assert_eq!(modules.iter().filter(|row| row.module == "AE").count(), 1);
        assert_eq!(modules[0].status, "ambiguous");
        assert_eq!(modules[0].decoded_fields, 1);
        assert_eq!(
            modules.iter().filter(|row| row.module == "Unknown").count(),
            2
        );
        let oversized: toml::Value =
            toml::from_str(&format!("[AF]\nPOS=[{}]\n", vec!["1"; 100_001].join(","))).unwrap();
        assert!(merged_content_modules(&oversized, Vec::new()).is_err());
    }

    #[test]
    fn dp_statistics_survive_export_with_explicit_origin_and_repeated_af_values() {
        let values = (0..25)
            .map(|value| value.to_string())
            .collect::<Vec<_>>()
            .join(" ");
        let text = format!(
            "[AE]\nAE_TAG_CWV: 7 |\n[AE_Table]\n<<5x5_LE>>\n{values}\n[AF]\nPOS: 1\nPOS: 2\n"
        );
        let output = debug_parser_to_toml(&text).unwrap().unwrap();
        let mut root: toml::Value = toml::from_str(&output).unwrap();
        assert_eq!(
            root[PROVENANCE_KEY]["parser"].as_str(),
            Some("debug_parser")
        );
        assert_eq!(root["AF"]["POS"].as_array().unwrap().len(), 2);
        let modules = root[PROVENANCE_KEY]["modules"].as_array().unwrap();
        let af = modules
            .iter()
            .find(|row| row["module"].as_str() == Some("AF"))
            .unwrap();
        assert_eq!(
            af["decoded_fields"].as_integer(),
            Some(2),
            "DP diagnostics count repeated observations, not just one array key"
        );
        assert!(af.get("header").is_none());
        assert!(!modules
            .iter()
            .any(|row| row["module"].as_str() == Some("AE_Table")));
        let tables = take_ae_tables(&mut root);
        assert_eq!(tables.len(), 1);
        assert_eq!(
            (tables[0].rows, tables[0].columns, tables[0].values[24]),
            (5, 5, 24)
        );
        assert!(presentation_sections(&mut root)
            .iter()
            .all(|section| !section.name.starts_with(PROVENANCE_KEY)));
    }

    #[test]
    fn invalid_shapes_and_truncated_text_do_not_become_statistics() {
        assert!(parse_statistics_text("<<5x5_LE>>\n1 2 3\n").is_empty());
        assert!(parse_statistics_text("<<5x5_LE>>\n1 wrong 3\n").is_empty());
        let mut root: toml::Value =
            toml::from_str("[AE_Table.bad]\nrows = 999999\ncolumns = 2\nvalues = [1,2]\n").unwrap();
        assert!(take_ae_tables(&mut root).is_empty());
    }
}
