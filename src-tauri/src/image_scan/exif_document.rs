//! On-demand EXIF presentation, statistics and explicit export provenance.
//! No document cache: only the currently mounted EXIF view owns this payload.

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
    let provenance = root
        .as_table_mut()
        .and_then(|table| table.remove(PROVENANCE_KEY))
        .and_then(|value| value.try_into::<ExportProvenance>().ok())
        .filter(|value| {
            value.schema_version == 1
                && matches!(value.parser.as_str(), "native" | "debug_parser" | "unknown")
        });
    let ae_tables = take_ae_tables(&mut root);
    let sections = presentation_sections(&mut root);
    let modules = provenance
        .as_ref()
        .map(|value| value.modules.clone())
        .filter(|modules| valid_modules(modules))
        .filter(|modules| !modules.is_empty())
        .unwrap_or_else(|| unrecorded_modules(&sections));
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
        },
        needs_fallback: provenance.is_some_and(|value| value.needs_fallback),
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

pub(super) fn stamp_export(
    text: &str,
    parser: &str,
    modules: Vec<ImageExifModule>,
    needs_fallback: bool,
) -> AppResult<String> {
    let mut root: toml::Value = toml::from_str(text)?;
    let table = root
        .as_table_mut()
        .ok_or_else(|| AppError::Invalid("EXIF export is not a table".into()))?;
    let provenance = ExportProvenance {
        schema_version: 1,
        parser: parser.into(),
        needs_fallback,
        modules,
    };
    table.insert(PROVENANCE_KEY.into(), toml::Value::try_from(provenance)?);
    Ok(toml::to_string(&root)?)
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
    let mut sections = Vec::new();
    collect_toml_sections("", &root, &mut sections);
    let modules = unrecorded_modules(&sections);
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
    // DebugParser does not report a verified .h match. Never fabricate one.
    Ok(Some(stamp_export(
        &toml::to_string(&toml::Value::Table(root))?,
        "debug_parser",
        modules,
        false,
    )?))
}

#[cfg(test)]
mod tests {
    use super::*;

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
