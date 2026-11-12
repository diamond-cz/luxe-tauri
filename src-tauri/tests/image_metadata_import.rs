//! Synthetic import fixtures only. Rust compilation and execution run in CI.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use luxe_tauri_lib::image_scan::{
    load_image_exif, load_image_toml, parse_exif_directory, prepare_image_metadata,
};

const META: &str = "__luxe_exif";

struct TempDir(PathBuf);
impl TempDir {
    fn new(name: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "luxe-metadata-import-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn image(&self, name: &str, bytes: &[u8]) {
        fs::write(self.0.join(name), bytes).unwrap();
    }

    fn root(&self, name: &str) -> toml::Value {
        toml::from_str(&fs::read_to_string(self.0.join(name)).unwrap()).unwrap()
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn segment(
    mut jpeg: Vec<u8>,
    magic: [u8; 4],
    declarations: &[(u32, u32)],
    blocks: &[Vec<u8>],
) -> Vec<u8> {
    let directory_size = 4 + declarations.len() * 32;
    let count = blocks.len() + 1;
    let mut payload = magic.to_vec();
    payload.extend_from_slice(&(declarations.len() as u16).to_le_bytes());
    payload.extend_from_slice(&(count as u16).to_le_bytes());
    let mut offset = 8 + count * 4 + directory_size;
    payload.extend_from_slice(&(offset as u32).to_le_bytes());
    for block in blocks {
        offset += block.len();
        payload.extend_from_slice(&(offset as u32).to_le_bytes());
    }
    payload.extend_from_slice(&(directory_size as u32).to_le_bytes());
    for (signature, version) in declarations {
        payload.extend_from_slice(&signature.to_le_bytes());
        payload.extend_from_slice(&version.to_le_bytes());
        payload.extend_from_slice(&[0; 24]);
    }
    for block in blocks {
        payload.extend_from_slice(block);
    }
    let marker = if magic == [0xfb, 0xfa, 0xf9, 0xf8] {
        0xe5
    } else {
        0xe6
    };
    jpeg.truncate(jpeg.len() - 2);
    jpeg.extend_from_slice(&[0xff, marker]);
    jpeg.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
    jpeg.extend_from_slice(&payload);
    jpeg.extend_from_slice(&[0xff, 0xd9]);
    jpeg
}

fn ae_jpeg(version: u32, values: &[(u32, u32)]) -> Vec<u8> {
    let mut words = Vec::new();
    for (index, value) in values {
        words.extend_from_slice(&(0x0100_0000 | index).to_le_bytes());
        words.extend_from_slice(&value.to_le_bytes());
    }
    segment(
        vec![0xff, 0xd8, 0xff, 0xd9],
        [0x06, 0xf2, 0xf1, 0xf0],
        &[(0xe28f_a520, version)],
        &[words],
    )
}

fn native_jpeg(value: u32) -> Vec<u8> {
    ae_jpeg(11, &[(0, 11), (1, value)])
}

fn partial_jpeg(value: u32) -> Vec<u8> {
    segment(
        native_jpeg(value),
        [0xfb, 0xfa, 0xf9, 0xf8],
        &[(0xbe62_9b07, 0)],
        &[],
    )
}

fn stat_jpeg() -> Vec<u8> {
    let len = 16 + 4 * 256 * 2 + 3 * 256 * 4;
    let mut block = Vec::new();
    block.extend_from_slice(&0x0001_000au32.to_le_bytes());
    block.extend_from_slice(&(len as u32).to_le_bytes());
    for dimension in [64u16, 48, 8, 6] {
        block.extend_from_slice(&dimension.to_le_bytes());
    }
    block.resize(len, 0);
    segment(
        vec![0xff, 0xd8, 0xff, 0xd9],
        [0x06, 0xf2, 0xf1, 0xf0],
        &[],
        &[block],
    )
}

fn business(mut root: toml::Value) -> toml::Value {
    root.as_table_mut().unwrap().remove(META);
    root
}

fn fixed_mtime(path: &Path) -> SystemTime {
    let time = UNIX_EPOCH + Duration::from_secs(1_700_000_000);
    fs::OpenOptions::new()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(time)
        .unwrap();
    fs::metadata(path).unwrap().modified().unwrap()
}

#[test]
fn first_import_saves_native_and_partial_with_truthful_modules_and_image_progress() {
    let dir = TempDir::new("partial");
    dir.image("one.jpg", &native_jpeg(123));
    dir.image("two.JPG", &partial_jpeg(456));
    let mut progress = Vec::new();
    let result = prepare_image_metadata(&dir.0, |event| {
        progress.push((event.stage, event.completed, event.total))
    })
    .unwrap();
    assert_eq!(
        (
            result.summary.total,
            result.summary.created,
            result.summary.failed,
            result.summary.partial
        ),
        (2, 2, 0, 1)
    );
    assert_eq!(
        progress,
        vec![("JPEG", 0, 2), ("JPEG", 1, 2), ("JPEG", 2, 2)]
    );
    let root = dir.root("two.toml");
    assert_eq!(root["AE"]["AE_TAG_ALGO_VER"].as_integer(), Some(456));
    assert_eq!(root[META]["parser"].as_str(), Some("native"));
    assert_eq!(root[META]["needs_fallback"].as_bool(), Some(true));
    assert!(root[META]["modules"]
        .as_array()
        .unwrap()
        .iter()
        .any(|module| module["module"].as_str() == Some("Sensor")
            && module["parse_status"].as_str() != Some("decoded")));
    assert_eq!(
        root[META]["preparation"]["first_source"].as_str(),
        Some("jpeg")
    );
    assert_eq!(
        root[META]["preparation"]["selected_source"].as_str(),
        Some("jpeg")
    );
    assert_eq!(
        root[META]["preparation"]["decision"].as_str(),
        Some("native_created")
    );
    let document = load_image_exif(&dir.0.join("two.toml")).unwrap();
    assert_eq!(
        (
            document.source.kind,
            document.source.parser.as_str(),
            document.needs_fallback
        ),
        ("toml", "native", true)
    );
    assert_eq!(
        load_image_toml(&dir.0.join("one.toml")).unwrap()["AE_TAG_ALGO_VER"],
        "123"
    );
}

#[test]
fn statistics_without_enum_fields_are_still_saved_as_partial_content() {
    let dir = TempDir::new("statistics-only");
    dir.image("table.jpg", &stat_jpeg());
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.created,
            result.summary.partial,
            result.summary.unavailable,
            result.summary.failed
        ),
        (1, 1, 0, 0)
    );
    let document = load_image_exif(&dir.0.join("table.toml")).unwrap();
    assert_eq!(document.ae_tables.len(), 7);
    assert!(document.needs_fallback);
    assert_eq!(
        (
            document.ae_tables[0].values.len(),
            document.ae_tables[0].rows * document.ae_tables[0].columns
        ),
        (48, 48)
    );
}

#[test]
fn legacy_extra_fields_unknown_sections_and_repeated_values_are_never_lost() {
    let dir = TempDir::new("legacy-retained");
    let previous = "[AE]\nAE_TAG_ALGO_VER=999\nAE_TAG_DEBUG_VER=11\nAE_TAG_NOT_NATIVE=44\n[AF]\nPOS=[1,2,3]\n[Vendor_Raw]\nbytes='keep exactly as data'\n";
    fs::write(dir.0.join("legacy.toml"), previous).unwrap();
    dir.image("legacy.jpg", &native_jpeg(123));
    let original: toml::Value = toml::from_str(previous).unwrap();
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.retained,
            result.summary.replaced,
            result.summary.failed
        ),
        (1, 0, 0)
    );
    let root = dir.root("legacy.toml");
    assert_eq!(business(root.clone()), original);
    assert_eq!(root[META]["parser"].as_str(), Some("unknown"));
    assert_eq!(
        root[META]["preparation"]["decision"].as_str(),
        Some("existing_retained")
    );
    assert_eq!(
        root[META]["preparation"]["first_source"].as_str(),
        Some("jpeg")
    );
    assert_eq!(
        root[META]["preparation"]["selected_source"].as_str(),
        Some("toml")
    );
}

#[test]
fn more_native_fields_do_not_cover_a_missing_old_identity_or_array_element() {
    let dir = TempDir::new("identity");
    let first = "[AE]\nAE_TAG_ALGO_SUBVER=999\n";
    let second = "[AE]\nAE_TAG_DEBUG_VER=[11,11]\n";
    for (name, text) in [("missing", first), ("repeated", second)] {
        dir.image(&format!("{name}.jpg"), &native_jpeg(123));
        fs::write(dir.0.join(format!("{name}.toml")), text).unwrap();
    }
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.retained,
            result.summary.replaced,
            result.summary.failed
        ),
        (2, 0, 0)
    );
    assert_eq!(
        business(dir.root("missing.toml")),
        toml::from_str::<toml::Value>(first).unwrap()
    );
    assert_eq!(
        business(dir.root("repeated.toml")),
        toml::from_str::<toml::Value>(second).unwrap()
    );
}

#[test]
fn strict_native_superset_replaces_but_equal_coverage_preserves_user_values() {
    let dir = TempDir::new("strict");
    dir.image("superset.jpg", &native_jpeg(123));
    fs::write(
        dir.0.join("superset.toml"),
        "[AE]\nAE_TAG_ALGO_VER=999\n[Detail]\nunknown='preserve auxiliary'\n",
    )
    .unwrap();
    dir.image("equal.jpg", &native_jpeg(123));
    fs::write(
        dir.0.join("equal.toml"),
        "[AE]\nAE_TAG_ALGO_VER=999\nAE_TAG_DEBUG_VER=11\n",
    )
    .unwrap();
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.replaced,
            result.summary.retained,
            result.summary.failed
        ),
        (1, 1, 0)
    );
    let root = dir.root("superset.toml");
    assert_eq!(root["AE"]["AE_TAG_ALGO_VER"].as_integer(), Some(123));
    assert_eq!(root["AE"]["AE_TAG_DEBUG_VER"].as_integer(), Some(11));
    assert_eq!(
        root["Detail"]["unknown"].as_str(),
        Some("preserve auxiliary")
    );
    assert_eq!(
        root[META]["preparation"]["decision"].as_str(),
        Some("native_replaced")
    );
    assert_eq!(
        dir.root("equal.toml")["AE"]["AE_TAG_ALGO_VER"].as_integer(),
        Some(999)
    );
}

#[test]
fn old_statistics_must_be_covered_with_identical_complete_shapes() {
    let dir = TempDir::new("statistics-retained");
    let values = (0..25)
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let previous = format!(
        "[AE]\nAE_TAG_ALGO_VER=999\n[AE_Table.old_only]\nrows=5\ncolumns=5\nvalues=[{values}]\n"
    );
    fs::write(dir.0.join("stat.toml"), &previous).unwrap();
    dir.image("stat.jpg", &native_jpeg(123));
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!((result.summary.retained, result.summary.replaced), (1, 0));
    assert_eq!(
        business(dir.root("stat.toml")),
        toml::from_str::<toml::Value>(&previous).unwrap()
    );
}

#[test]
fn invalid_utf8_invalid_toml_and_oversized_existing_files_are_failed_not_overwritten() {
    let dir = TempDir::new("invalid-existing");
    for (name, bytes) in [
        ("utf8", vec![0xff, 0xfe]),
        ("syntax", b"[AE]\nA=[".to_vec()),
    ] {
        dir.image(&format!("{name}.jpg"), &native_jpeg(123));
        fs::write(dir.0.join(format!("{name}.toml")), &bytes).unwrap();
    }
    dir.image("large.jpg", &native_jpeg(123));
    let large = dir.0.join("large.toml");
    fs::write(&large, "[AE]\nA=1\n").unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&large)
        .unwrap()
        .set_len(16 * 1024 * 1024 + 1)
        .unwrap();
    dir.image("broken-existing.jpg", b"not a JPEG");
    let protected = b"# even provenance must not be rewritten after a read error\n[AE]\nA=7\n";
    fs::write(dir.0.join("broken-existing.toml"), protected).unwrap();
    dir.image("valid.jpg", &native_jpeg(456));
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.total,
            result.summary.failed,
            result.summary.created
        ),
        (5, 4, 1)
    );
    assert_eq!(
        fs::read(dir.0.join("broken-existing.toml")).unwrap(),
        protected
    );
    assert_eq!(fs::read(dir.0.join("utf8.toml")).unwrap(), vec![0xff, 0xfe]);
    assert_eq!(fs::read(dir.0.join("syntax.toml")).unwrap(), b"[AE]\nA=[");
    assert_eq!(fs::metadata(&large).unwrap().len(), 16 * 1024 * 1024 + 1);
    assert_eq!(
        dir.root("valid.toml")["AE"]["AE_TAG_ALGO_VER"].as_integer(),
        Some(456)
    );
}

#[test]
fn metadata_only_results_cache_unavailability_without_fabricating_completeness() {
    let dir = TempDir::new("metadata-only");
    dir.image("ordinary.jpg", &[0xff, 0xd8, 0xff, 0xd9]);
    dir.image("unknown.jpg", &ae_jpeg(999, &[]));
    dir.image(
        "png.png",
        b"synthetic PNG: pixels are never decoded on import",
    );
    let first = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            first.summary.unavailable,
            first.summary.failed,
            first.summary.partial
        ),
        (3, 0, 0)
    );
    for name in ["ordinary.toml", "unknown.toml", "png.toml"] {
        let root = dir.root(name);
        assert_eq!(root[META]["needs_fallback"].as_bool(), Some(true));
        assert_eq!(
            root[META]["preparation"]["first_source"].as_str(),
            Some("none")
        );
        assert_eq!(
            root[META]["preparation"]["selected_source"].as_str(),
            Some("none")
        );
        assert_eq!(
            root[META]["preparation"]["decision"].as_str(),
            Some("unavailable")
        );
        assert!(business(root).as_table().unwrap().is_empty());
    }
    let before = fs::read(dir.0.join("unknown.toml")).unwrap();
    let time = fixed_mtime(&dir.0.join("unknown.toml"));
    let second = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            second.summary.cached,
            second.summary.failed,
            second.summary.created
        ),
        (3, 0, 0)
    );
    assert_eq!(fs::read(dir.0.join("unknown.toml")).unwrap(), before);
    assert_eq!(
        fs::metadata(dir.0.join("unknown.toml"))
            .unwrap()
            .modified()
            .unwrap(),
        time
    );
}

#[test]
fn failed_native_reads_can_be_cached_and_png_preserves_existing_business_fields() {
    let dir = TempDir::new("read-failure");
    dir.image("broken.jpg", b"truncated JPEG");
    dir.image("png.png", b"pixels are irrelevant");
    let legacy = "[AE]\nAE_TAG_CWV=99\n";
    fs::write(dir.0.join("png.toml"), legacy).unwrap();
    let first = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            first.summary.failed,
            first.summary.unavailable,
            first.summary.retained
        ),
        (1, 1, 1)
    );
    let png = dir.root("png.toml");
    assert_eq!(
        business(png.clone()),
        toml::from_str::<toml::Value>(legacy).unwrap()
    );
    assert_eq!(
        png[META]["preparation"]["first_source"].as_str(),
        Some("toml")
    );
    assert_eq!(
        png[META]["preparation"]["decision"].as_str(),
        Some("native_unavailable")
    );
    assert_eq!(
        dir.root("broken.toml")[META]["needs_fallback"].as_bool(),
        Some(true)
    );
    let second = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!((second.summary.cached, second.summary.failed), (2, 0));
}

#[test]
fn unchanged_native_import_does_not_reparse_or_rewrite_and_image_edits_reconcile_again() {
    let dir = TempDir::new("cache-image-change");
    dir.image("cache.jpg", &partial_jpeg(123));
    prepare_image_metadata(&dir.0, |_| {}).unwrap();
    let path = dir.0.join("cache.toml");
    let text = fs::read(&path).unwrap();
    let time = fixed_mtime(&path);
    let cached = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            cached.summary.cached,
            cached.summary.partial,
            cached.summary.failed
        ),
        (1, 1, 0)
    );
    assert_eq!(fs::read(&path).unwrap(), text);
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), time);
    fixed_mtime(&dir.0.join("cache.jpg"));
    let touched = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            touched.summary.retained,
            touched.summary.cached,
            touched.summary.partial
        ),
        (1, 0, 1)
    );
    dir.image("cache.jpg", &ae_jpeg(11, &[(0, 11), (1, 456), (2, 7)]));
    let changed = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            changed.summary.replaced,
            changed.summary.cached,
            changed.summary.partial
        ),
        (1, 0, 0)
    );
    let root = dir.root("cache.toml");
    assert_eq!(root["AE"]["AE_TAG_ALGO_VER"].as_integer(), Some(456));
    assert_eq!(root["AE"]["AE_TAG_ALGO_SUBVER"].as_integer(), Some(7));
    assert_eq!(root[META]["needs_fallback"].as_bool(), Some(false));
    assert_eq!(
        root[META]["preparation"]["first_source"].as_str(),
        Some("jpeg")
    );
}

#[test]
fn user_business_edits_and_parser_revision_changes_invalidate_only_the_disk_signature() {
    let dir = TempDir::new("user-change");
    dir.image("user.jpg", &native_jpeg(123));
    prepare_image_metadata(&dir.0, |_| {}).unwrap();
    let mut root = dir.root("user.toml");
    root["AE"]
        .as_table_mut()
        .unwrap()
        .insert("USER_EXTRA".into(), toml::Value::Integer(77));
    fs::write(dir.0.join("user.toml"), toml::to_string(&root).unwrap()).unwrap();
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.retained,
            result.summary.cached,
            result.summary.replaced
        ),
        (1, 0, 0)
    );
    let mut after = dir.root("user.toml");
    assert_eq!(after["AE"]["USER_EXTRA"].as_integer(), Some(77));
    assert_eq!(
        after[META]["preparation"]["first_source"].as_str(),
        Some("jpeg")
    );
    // A revision-only edit must also re-run the native reconciliation, without
    // relying on the business edit above to invalidate the payload checksum.
    after[META]["preparation"]["signature"]["parser_revision"] =
        toml::Value::String("old-parser".into());
    fs::write(dir.0.join("user.toml"), toml::to_string(&after).unwrap()).unwrap();
    let revised = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!((revised.summary.retained, revised.summary.cached), (1, 0));
    let after = dir.root("user.toml");
    assert_ne!(
        after[META]["preparation"]["signature"]["parser_revision"].as_str(),
        Some("old-parser")
    );
    assert_eq!(
        prepare_image_metadata(&dir.0, |_| {})
            .unwrap()
            .summary
            .cached,
        1
    );
}

#[test]
fn first_source_survives_selection_between_debug_parser_and_native_content() {
    let dir = TempDir::new("source-history");
    dir.image("history.jpg", &native_jpeg(123));
    let previous = "[AE]\nAE_TAG_ALGO_VER=999\n[__luxe_exif]\nschema_version=1\nparser='debug_parser'\nmodules=[]\nneeds_fallback=true\n[__luxe_exif.preparation]\nfirst_source='toml'\nselected_source='debug_parser'\ndecision='fallback'\n";
    fs::write(dir.0.join("history.toml"), previous).unwrap();
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.replaced,
            result.summary.partial,
            result.summary.failed
        ),
        (1, 0, 0)
    );
    let root = dir.root("history.toml");
    assert_eq!(
        root[META]["preparation"]["first_source"].as_str(),
        Some("toml")
    );
    assert_eq!(
        root[META]["preparation"]["selected_source"].as_str(),
        Some("jpeg")
    );
    assert_eq!(root[META]["parser"].as_str(), Some("native"));
    assert_eq!(root[META]["needs_fallback"].as_bool(), Some(false));

    dir.image("retained.jpg", &native_jpeg(123));
    let fuller = previous.replace(
        "AE_TAG_ALGO_VER=999",
        "AE_TAG_ALGO_VER=999\nAE_TAG_DEBUG_VER=11\nDP_EXTRA=[1,2]",
    );
    fs::write(dir.0.join("retained.toml"), fuller).unwrap();
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!((result.summary.retained, result.summary.cached), (1, 1));
    let root = dir.root("retained.toml");
    assert_eq!(
        root[META]["preparation"]["first_source"].as_str(),
        Some("toml")
    );
    assert_eq!(
        root[META]["preparation"]["selected_source"].as_str(),
        Some("debug_parser")
    );
    assert_eq!(root[META]["needs_fallback"].as_bool(), Some(true));
}

#[test]
fn first_none_source_survives_a_later_successful_native_parse() {
    let dir = TempDir::new("first-none");
    dir.image("retry.jpg", &ae_jpeg(999, &[]));
    prepare_image_metadata(&dir.0, |_| {}).unwrap();
    dir.image("retry.jpg", &native_jpeg(123));
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(result.summary.created, 1);
    let root = dir.root("retry.toml");
    assert_eq!(
        root[META]["preparation"]["first_source"].as_str(),
        Some("none")
    );
    assert_eq!(
        root[META]["preparation"]["selected_source"].as_str(),
        Some("jpeg")
    );
    assert_eq!(root[META]["needs_fallback"].as_bool(), Some(false));
}

#[test]
fn manual_fallback_keeps_native_values_and_adds_dp_modules_without_reading_jpeg_again() {
    let dir = TempDir::new("manual-fallback");
    dir.image("mixed.jpg", &partial_jpeg(123));
    prepare_image_metadata(&dir.0, |_| {}).unwrap();
    // Existing prepared TOML, not a repeated native read, supplies AE fields.
    dir.image(
        "mixed.jpg",
        b"JPEG is unavailable during this manual fallback",
    );
    fs::write(
        dir.0.join("mixed.jpg.exif"),
        "[AE]\nAE_TAG_ALGO_VER: 999 |\n[AF]\nAF_NEW_FIELD: 7 |\n",
    )
    .unwrap();
    let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!((result.fallback, result.failed), (1, 0));
    let root = dir.root("mixed.toml");
    assert_eq!(root["AE"]["AE_TAG_ALGO_VER"].as_integer(), Some(123));
    assert_eq!(root["AE"]["AE_TAG_DEBUG_VER"].as_integer(), Some(11));
    assert_eq!(root["AF"]["AF_NEW_FIELD"].as_integer(), Some(7));
    assert_eq!(root[META]["needs_fallback"].as_bool(), Some(false));
    assert_eq!(
        root[META]["preparation"]["first_source"].as_str(),
        Some("jpeg")
    );
    assert_eq!(
        root[META]["preparation"]["selected_source"].as_str(),
        Some("debug_parser")
    );
    assert_eq!(
        root[META]["preparation"]["decision"].as_str(),
        Some("fallback")
    );
    assert!(root[META]["preparation"].get("signature").is_none());
    assert!(root[META]["modules"]
        .as_array()
        .unwrap()
        .iter()
        .any(|module| module["module"].as_str() == Some("AE")
            && module["status"].as_str() == Some("matched")));
    assert!(root[META]["modules"]
        .as_array()
        .unwrap()
        .iter()
        .any(|module| module["module"].as_str() == Some("AF")
            && module["parse_status"].as_str() == Some("decoded")));
}

#[test]
fn a_no_gain_manual_fallback_leaves_partial_retryable_until_new_payload_arrives() {
    let dir = TempDir::new("retryable-fallback");
    dir.image("partial.jpg", &partial_jpeg(123));
    prepare_image_metadata(&dir.0, |_| {}).unwrap();
    let before = fs::read(dir.0.join("partial.toml")).unwrap();
    fs::write(
        dir.0.join("partial.jpg.exif"),
        "[AE]\nAE_TAG_ALGO_VER: 999 |\n",
    )
    .unwrap();
    let first = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!((first.fallback, first.partial), (0, 1));
    assert_eq!(fs::read(dir.0.join("partial.toml")).unwrap(), before);
    assert_eq!(
        dir.root("partial.toml")[META]["needs_fallback"].as_bool(),
        Some(true)
    );
    fs::write(
        dir.0.join("partial.jpg.exif"),
        "[AE]\nAE_TAG_ALGO_VER: 999 |\n[AF]\nPOS: 7 |\n",
    )
    .unwrap();
    let second = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!((second.fallback, second.failed), (1, 0));
    let after = dir.root("partial.toml");
    assert_eq!(after["AE"]["AE_TAG_ALGO_VER"].as_integer(), Some(123));
    assert_eq!(after["AF"]["POS"].as_integer(), Some(7));
    assert_eq!(after[META]["needs_fallback"].as_bool(), Some(false));
}

#[test]
fn same_stem_images_directories_and_state_targets_are_not_written() {
    let dir = TempDir::new("protected");
    dir.image("same.jpg", &native_jpeg(1));
    dir.image("same.jpeg", &native_jpeg(2));
    dir.image("directory.jpg", &native_jpeg(3));
    fs::create_dir(dir.0.join("directory.png")).unwrap();
    dir.image("state.jpg", &native_jpeg(4));
    let state = b"[settings]\nlanguage=0\n";
    fs::write(dir.0.join("state.toml"), state).unwrap();
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.total,
            result.summary.failed,
            result.summary.created
        ),
        (4, 4, 0)
    );
    assert!(!dir.0.join("same.toml").exists());
    assert!(!dir.0.join("directory.toml").exists());
    assert_eq!(fs::read(dir.0.join("state.toml")).unwrap(), state);
}

#[test]
fn read_only_existing_file_stays_byte_identical_and_temporaries_are_cleaned() {
    let dir = TempDir::new("read-only");
    dir.image("locked.jpg", &native_jpeg(123));
    let path = dir.0.join("locked.toml");
    let original = b"# preserve comment and byte layout\n[AE]\nAE_TAG_ALGO_VER=999\n";
    fs::write(&path, original).unwrap();
    let original_permissions = fs::metadata(&path).unwrap().permissions();
    let mut permissions = original_permissions.clone();
    permissions.set_readonly(true);
    fs::set_permissions(&path, permissions).unwrap();
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!((result.summary.failed, result.summary.replaced), (1, 0));
    assert_eq!(fs::read(&path).unwrap(), original);
    assert!(fs::read_dir(&dir.0).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .ends_with(".tmp")));
    fs::set_permissions(&path, original_permissions).unwrap();
}

#[cfg(windows)]
#[test]
fn a_windows_target_open_without_delete_sharing_cannot_be_replaced() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = TempDir::new("occupied");
    dir.image("occupied.jpg", &native_jpeg(123));
    let path = dir.0.join("occupied.toml");
    let original = b"[AE]\nAE_TAG_ALGO_VER=999\n";
    fs::write(&path, original).unwrap();
    let _occupied = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&path)
        .unwrap();
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!((result.summary.failed, result.summary.replaced), (1, 0));
    assert_eq!(fs::read(&path).unwrap(), original);
    assert!(fs::read_dir(&dir.0).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .ends_with(".tmp")));
}

#[cfg(any(unix, windows))]
#[test]
fn linked_sidecars_and_linked_parent_directories_never_follow_external_targets() {
    let dir = TempDir::new("links");
    let external = TempDir::new("outside");
    let original = b"[AE]\nAE_TAG_ALGO_VER=999\n";
    let external_file = external.0.join("outside.toml");
    fs::write(&external_file, original).unwrap();
    dir.image("linked.jpg", &native_jpeg(123));
    #[cfg(unix)]
    let link_result = std::os::unix::fs::symlink(&external_file, dir.0.join("linked.toml"));
    #[cfg(windows)]
    let link_result = std::os::windows::fs::symlink_file(&external_file, dir.0.join("linked.toml"));
    if let Err(error) = link_result {
        eprintln!("symlink fixture unavailable on this Windows runner: {error}");
        return;
    }
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!((result.summary.failed, result.summary.replaced), (1, 0));
    assert_eq!(fs::read(&external_file).unwrap(), original);
    let linked_dir = dir.0.join("linked-directory");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&external.0, &linked_dir).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&external.0, &linked_dir).unwrap();
    assert!(prepare_image_metadata(&linked_dir, |_| {}).is_err());
    // Remove only fixtures created above, before TempDir traverses its tree.
    fs::remove_file(dir.0.join("linked.toml")).unwrap();
    #[cfg(unix)]
    fs::remove_file(&linked_dir).unwrap();
    #[cfg(windows)]
    fs::remove_dir(&linked_dir).unwrap();
}
