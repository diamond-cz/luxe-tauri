use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use luxe_tauri_lib::image_scan::{
    load_image_exif, load_image_exif_with_progress, load_image_toml, load_image_toml_fields_batch,
    load_image_toml_with_progress, parse_exif_directory,
};

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("luxe-exif-details-{}-{nonce}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn ae_jpeg(version: u32, include_fields: bool) -> Vec<u8> {
    let mut payload = vec![0x06, 0xf2, 0xf1, 0xf0];
    payload.extend_from_slice(&0u16.to_le_bytes());
    payload.extend_from_slice(&1u16.to_le_bytes());
    payload.extend_from_slice(&36u32.to_le_bytes());
    payload.extend_from_slice(&36u32.to_le_bytes());
    payload.extend_from_slice(&0xe28f_a520u32.to_le_bytes());
    payload.extend_from_slice(&version.to_le_bytes());
    payload.extend_from_slice(&[0u8; 24]);
    if include_fields {
        for word in [0x0100_0000, version, 0x0100_0001, 123] {
            payload.extend_from_slice(&word.to_le_bytes());
        }
    }
    let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe6];
    jpeg.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
    jpeg.extend(payload);
    jpeg.extend([0xff, 0xd9]);
    jpeg
}

#[test]
fn jpeg_progress_reports_file_read_modules_statistics_and_final_projection_without_export() {
    let dir = TempDir::new();
    let logical = dir.0.join("progress.toml");
    fs::write(dir.0.join("progress.jpg"), ae_jpeg(11, true)).unwrap();
    let mut progress = Vec::new();
    let document = load_image_exif_with_progress(&logical, |event| {
        assert_eq!(event.stage, "JPEG");
        progress.push((event.completed, event.total));
    })
    .unwrap();
    assert_eq!(document.source.kind, "jpeg");
    assert_eq!(progress.first(), Some(&(0, 17)));
    assert_eq!(progress.last(), Some(&(17, 17)));
    assert!(progress.windows(2).all(|pair| pair[0].0 <= pair[1].0));
    assert!(progress
        .iter()
        .any(|(completed, _)| *completed > 1 && *completed < 16));
    assert!(!logical.exists());

    let mut flat_progress = Vec::new();
    let fields = load_image_toml_with_progress(&logical, |event| {
        flat_progress.push((event.stage, event.completed, event.total))
    })
    .unwrap();
    assert_eq!(fields["AE_TAG_ALGO_VER"], "123");
    assert_eq!(flat_progress.last(), Some(&("JPEG", 17, 17)));
    assert!(!logical.exists());

    fs::write(&logical, "[AE]\nAE_TAG_ALGO_VER = 5\n").unwrap();
    let mut toml_progress = Vec::new();
    let fields = load_image_toml_with_progress(&logical, |event| {
        toml_progress.push((event.stage, event.completed, event.total))
    })
    .unwrap();
    assert_eq!(fields["AE_TAG_ALGO_VER"], "5");
    assert_eq!(
        toml_progress,
        vec![("TOML", 0, 2), ("TOML", 1, 2), ("TOML", 2, 2)]
    );
}

#[test]
fn failed_metadata_reads_never_report_a_successful_completion() {
    let dir = TempDir::new();
    let logical = dir.0.join("broken.toml");
    fs::write(
        dir.0.join("broken.jpg"),
        [0xff, 0xd8, 0xff, 0xe6, 0, 2, 0xff, 0xd9],
    )
    .unwrap();
    let mut progress = Vec::new();
    assert!(load_image_exif_with_progress(&logical, |event| progress
        .push((event.completed, event.total)))
    .is_err());
    assert!(progress.iter().all(|(done, total)| done < total));
    assert!(!logical.exists());
}

#[test]
fn presentation_metadata_cannot_shadow_camera_keywords_in_full_or_selected_maps() {
    let dir = TempDir::new();
    let path = dir.0.join("reserved.toml");
    fs::write(&path, "AE_Table.grid.rows = 5\n__luxe_exif.schema_version = 1\n__luxe_exif.parser = 'native'\n[AE]\nrows = 7\nAE_TAG_CWV = 123\n[[__luxe_exif.modules]]\nmodule = 'AE'\nstatus = 'matched'\n").unwrap();
    // Request selected fields first, before the full-map cache can hide a fast-parser regression.
    let path_key = path.to_string_lossy().into_owned();
    let selected = load_image_toml_fields_batch(
        vec![path_key.clone()],
        vec![
            "rows".into(),
            "parser".into(),
            "schema_version".into(),
            "AE_Table.grid.rows".into(),
            "AE_TAG_CWV".into(),
        ],
    )
    .unwrap();
    assert_eq!(selected[&path_key]["rows"], "7");
    assert_eq!(selected[&path_key]["AE_TAG_CWV"], "123");
    assert!(!selected[&path_key].contains_key("parser"));
    assert!(!selected[&path_key].contains_key("schema_version"));
    assert!(!selected[&path_key].contains_key("AE_Table.grid.rows"));
    let full = load_image_toml(&path).unwrap();
    assert_eq!(full["rows"], "7");
    assert!(!full.contains_key("parser"));
}

#[test]
fn direct_details_and_export_distinguish_the_read_method_from_the_generator() {
    let dir = TempDir::new();
    let image = dir.0.join("native.jpg");
    let path = dir.0.join("native.toml");
    fs::write(&image, ae_jpeg(11, true)).unwrap();
    let before = load_image_exif(&path).unwrap();
    assert_eq!(
        (before.source.kind, before.source.parser.as_str()),
        ("jpeg", "native")
    );
    assert_eq!(before.source.path, image.to_string_lossy().into_owned());
    let ae = before
        .modules
        .iter()
        .find(|item| item.module == "AE")
        .unwrap();
    assert_eq!(ae.status, "matched");
    assert_eq!(ae.header.as_deref(), Some("AE/AE_6_11_0.h"));
    assert_eq!(ae.version.as_deref(), Some("0x0000000B"));
    assert_eq!(ae.signature.as_deref(), Some("0xE28FA520"));
    assert!(
        !path.exists(),
        "reading Detail must not generate a TOML override"
    );

    let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!(result.direct, 1);
    let after = load_image_exif(&path).unwrap();
    assert_eq!(
        (after.source.kind, after.source.parser.as_str()),
        ("toml", "native")
    );
    assert_eq!(after.modules.len(), before.modules.len());
    let fields = load_image_toml(&path).unwrap();
    assert_eq!(fields["AE_TAG_ALGO_VER"], "123");
    assert!(!fields.keys().any(|key| key.starts_with("__luxe_exif")));
    assert!(!fields.contains_key("parser"));
}

#[test]
fn legacy_toml_is_an_explicit_override_not_an_assumed_debug_parser_result() {
    let dir = TempDir::new();
    fs::write(dir.0.join("legacy.jpg"), ae_jpeg(11, true)).unwrap();
    let path = dir.0.join("legacy.toml");
    fs::write(&path, "[AE]\nAE_TAG_ALGO_VER = 999\n").unwrap();
    let document = load_image_exif(&path).unwrap();
    assert_eq!(
        (document.source.kind, document.source.parser.as_str()),
        ("toml", "unknown")
    );
    assert_eq!(document.modules.len(), 1);
    assert_eq!(document.modules[0].status, "unrecorded");
    assert!(document.modules[0].header.is_none());
    assert!(
        document.ae_tables.is_empty(),
        "must not silently mix JPEG statistics into a TOML override"
    );
    assert_eq!(load_image_toml(&path).unwrap()["AE_TAG_ALGO_VER"], "999");
}

#[test]
fn debug_parser_text_preserves_statistics_and_origin_without_running_a_process() {
    let dir = TempDir::new();
    let path = dir.0.join("fallback.toml");
    fs::write(dir.0.join("fallback.jpg"), []).unwrap();
    let grid = (0..25)
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(" ");
    fs::write(
        dir.0.join("fallback.jpg.exif"),
        format!(
            "[AE]\nAE_TAG_CWV: 7 |\n[AE_Table]\n<<5x5_LE>>\n{grid}\n[AF]\nPOS: 1 |\nPOS: 2 |\n"
        ),
    )
    .unwrap();
    let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!((result.direct, result.fallback), (0, 1));
    let document = load_image_exif(&path).unwrap();
    assert_eq!(
        (document.source.kind, document.source.parser.as_str()),
        ("toml", "debug_parser")
    );
    assert!(document.modules.iter().all(|item| item.header.is_none()));
    assert_eq!(document.ae_tables.len(), 1);
    assert_eq!(
        (document.ae_tables[0].rows, document.ae_tables[0].columns),
        (5, 5)
    );
    assert_eq!(document.ae_tables[0].values, (0..25).collect::<Vec<_>>());
    assert_eq!(load_image_toml(&path).unwrap()["POS"], "1, 2");
    assert!(!load_image_toml(&path).unwrap().contains_key("rows"));
}

#[test]
fn an_unknown_version_can_be_diagnosed_without_becoming_a_successful_export() {
    let dir = TempDir::new();
    let path = dir.0.join("unknown.toml");
    fs::write(dir.0.join("unknown.jpg"), ae_jpeg(999, false)).unwrap();
    let document = load_image_exif(&path).unwrap();
    assert!(document.needs_fallback);
    let ae = document
        .modules
        .iter()
        .find(|item| item.module == "AE")
        .unwrap();
    assert_eq!(ae.status, "missing_header");
    assert_eq!(ae.version.as_deref(), Some("0x000003E7"));
    assert!(!path.exists());
    let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!(result.failed, 1);
    assert!(!path.exists());
}

#[test]
fn structured_toml_statistics_keep_their_shape_and_reject_truncated_arrays() {
    let dir = TempDir::new();
    let path = dir.0.join("tables.toml");
    let values = (0..48)
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",");
    fs::write(&path, format!("[AE_Table.8_6_LE_Y]\nrows = 6\ncolumns = 8\nvalues = [{values}]\n[AE_Table.bad]\nrows = 5\ncolumns = 5\nvalues = [1,2]\n")).unwrap();
    let document = load_image_exif(&path).unwrap();
    assert_eq!(document.ae_tables.len(), 1);
    assert_eq!(document.ae_tables[0].name, "8_6_LE_Y");
    assert_eq!(document.ae_tables[0].values[47], 47);
    assert_eq!(document.source.parser, "unknown");
}
