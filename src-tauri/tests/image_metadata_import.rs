//! Synthetic pipeline fixtures only. Rust compilation/execution belongs to CI.

use std::cell::RefCell;
use std::fs;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use luxe_tauri_lib::image_scan::{
    load_image_exif, load_image_toml, merge_image_metadata, prepare_image_metadata,
    replace_image_metadata,
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
    fn bytes(&self, name: &str) -> Vec<u8> {
        fs::read(self.0.join(name)).unwrap()
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
    stat_jpeg_with_dimensions([64, 48, 8, 6])
}
fn stat_jpeg_with_dimensions(dimensions: [u16; 4]) -> Vec<u8> {
    let len = 16 + 4 * 256 * 2 + 3 * 256 * 4;
    let mut block = Vec::new();
    block.extend_from_slice(&0x0001_000au32.to_le_bytes());
    block.extend_from_slice(&(len as u32).to_le_bytes());
    for dimension in dimensions {
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
fn fixed_mtime(path: &Path) -> SystemTime {
    fs::OpenOptions::new()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(UNIX_EPOCH + Duration::from_secs(1_700_000_000))
        .unwrap();
    fs::metadata(path).unwrap().modified().unwrap()
}
fn no_temporaries(dir: &TempDir) {
    assert!(fs::read_dir(&dir.0).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .ends_with(".tmp")));
}

#[test]
fn missing_tomls_generate_native_and_truthful_partial_without_preparation_fingerprints() {
    let dir = TempDir::new("missing");
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
    assert_eq!(root[META]["content_mode"].as_str(), Some("native"));
    assert_eq!(root[META]["needs_fallback"].as_bool(), Some(true));
    assert!(root[META].get("preparation").is_none());
    assert!(root[META]["modules"]
        .as_array()
        .unwrap()
        .iter()
        .any(|module| module["module"].as_str() == Some("Sensor")
            && module["parse_status"].as_str() != Some("decoded")));
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
fn automatic_import_reuses_every_valid_toml_marked_unmarked_empty_or_metadata_only() {
    let dir = TempDir::new("reuse-all");
    let fixtures = [
        ("legacy", "# preserve exact byte layout\n[AE]\nAE_TAG_ALGO_VER = 999\n"),
        ("marked", "[AF]\nPOS=[1,2,3]\n[__luxe_exif]\nschema_version=1\nparser='debug_parser'\nneeds_fallback=false\nmodules=[]\n"),
        ("empty", "# valid TOML without payload\n"),
        ("metadata", "[__luxe_exif]\nschema_version=1\nparser='unknown'\nneeds_fallback=true\nmodules=[]\n"),
        ("reserved-user", "__luxe_exif = 'existing unknown user data'\n"),
    ];
    for (name, text) in fixtures {
        dir.image(
            &format!("{name}.jpg"),
            b"not a JPEG: existing TOML must prevent native parsing",
        );
        fs::write(dir.0.join(format!("{name}.toml")), text).unwrap();
    }
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.cached,
            result.summary.created,
            result.summary.replaced,
            result.summary.failed
        ),
        (5, 0, 0, 0)
    );
    for (name, text) in fixtures {
        assert_eq!(dir.bytes(&format!("{name}.toml")), text.as_bytes());
    }
    no_temporaries(&dir);
}

#[test]
fn automatic_import_ignores_changed_jpeg_timestamps_and_obsolete_or_user_edited_signatures() {
    let dir = TempDir::new("no-reconcile");
    dir.image("capture.jpg", &partial_jpeg(123));
    prepare_image_metadata(&dir.0, |_| {}).unwrap();
    let mut root = dir.root("capture.toml");
    root["AE"]
        .as_table_mut()
        .unwrap()
        .insert("USER_EXTRA".into(), toml::Value::Integer(77));
    root[META].as_table_mut().unwrap().insert("preparation".into(), toml::from_str::<toml::Value>("first_source='jpeg'\nselected_source='toml'\ndecision='existing_retained'\nsignature={parser_revision='obsolete',payload_fingerprint='user-edit'}\n").unwrap());
    let text = toml::to_string(&root).unwrap();
    fs::write(dir.0.join("capture.toml"), &text).unwrap();
    let time = fixed_mtime(&dir.0.join("capture.toml"));
    dir.image("capture.jpg", &ae_jpeg(11, &[(0, 11), (1, 456), (2, 7)]));
    fixed_mtime(&dir.0.join("capture.jpg"));
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!((result.summary.cached, result.summary.failed), (1, 0));
    assert_eq!(dir.bytes("capture.toml"), text.as_bytes());
    assert_eq!(
        fs::metadata(dir.0.join("capture.toml"))
            .unwrap()
            .modified()
            .unwrap(),
        time
    );
}

#[test]
fn native_manual_merge_adds_missing_fields_but_preserves_old_values_unknown_sections_and_repeat_prefixes(
) {
    let dir = TempDir::new("manual-additive");
    dir.image("merge.jpg", &ae_jpeg(11, &[(0, 11), (1, 123), (2, 7)]));
    fs::write(dir.0.join("merge.toml"), "[AE]\nAE_TAG_ALGO_VER=999\nAE_TAG_DEBUG_VER=[42,43]\n[Vendor_Raw]\nDATA='preserve unknown'\n[Detail]\nextra='preserve auxiliary'\n[__luxe_exif]\nschema_version=1\nparser='debug_parser'\nneeds_fallback=false\n[[__luxe_exif.modules]]\nmodule='AE'\nheader='old.h'\nstatus='unrecorded'\nidentity_source='toml'\ndecoded_fields=900\nparse_status='decoded'\n").unwrap();
    let result = merge_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.replaced,
            result.summary.retained,
            result.summary.failed
        ),
        (1, 0, 0)
    );
    let root = dir.root("merge.toml");
    assert_eq!(root["AE"]["AE_TAG_ALGO_VER"].as_integer(), Some(999));
    assert_eq!(root["AE"]["AE_TAG_ALGO_SUBVER"].as_integer(), Some(7));
    assert_eq!(root["AE"]["AE_TAG_DEBUG_VER"].as_array().unwrap().len(), 2);
    assert_eq!(
        root["AE"]["AE_TAG_DEBUG_VER"].as_array().unwrap()[0].as_integer(),
        Some(42)
    );
    assert_eq!(
        root["Vendor_Raw"]["DATA"].as_str(),
        Some("preserve unknown")
    );
    assert_eq!(root["Detail"]["extra"].as_str(), Some("preserve auxiliary"));
    assert_eq!(root[META]["parser"].as_str(), Some("native"));
    assert_eq!(root[META]["content_mode"].as_str(), Some("native_merge"));
    let modules = root[META]["modules"].as_array().unwrap();
    let ae: Vec<_> = modules
        .iter()
        .filter(|row| row["module"].as_str() == Some("AE"))
        .collect();
    assert_eq!(
        ae.len(),
        1,
        "new diagnostics replace parse history instead of accumulating it"
    );
    assert_eq!(ae[0]["decoded_fields"].as_integer(), Some(4));
    assert_eq!(ae[0]["identity_source"].as_str(), Some("toml"));
    assert!(ae[0].get("header").is_none());
    assert!(modules
        .iter()
        .any(|row| row["module"].as_str() == Some("Vendor_Raw")
            && row["decoded_fields"].as_integer() == Some(1)));
    dir.image(
        "merge.jpg",
        &ae_jpeg(11, &[(0, 11), (1, 123), (2, 7), (3, 55)]),
    );
    assert_eq!(
        merge_image_metadata(&dir.0, Vec::new(), |_| {})
            .unwrap()
            .summary
            .replaced,
        1
    );
    let document = load_image_exif(&dir.0.join("merge.toml")).unwrap();
    let ae: Vec<_> = document
        .modules
        .iter()
        .filter(|row| row.module == "AE")
        .collect();
    assert_eq!(
        ae.len(),
        1,
        "repeated merges cannot duplicate the current module row"
    );
    assert_eq!(ae[0].decoded_fields, 5);
    assert!(ae[0].header.is_none());
}

#[test]
fn native_replacement_discards_all_old_business_auxiliary_and_source_content() {
    let dir = TempDir::new("native-replace");
    dir.image("capture.jpg", &ae_jpeg(11, &[(0, 11), (1, 123), (2, 7)]));
    fs::write(dir.0.join("capture.toml"), "# old layout is intentionally discarded\n[AE]\nAE_TAG_ALGO_VER=999\nUSER_EXTRA=77\n[AF]\nPOS=[4,5]\n[Vendor_Raw]\nDATA='old unknown section'\n[Detail]\nextra='old auxiliary section'\n[AE_DISPLAY]\nextra='old display content'\n[AE_Table.old_only]\nrows=1\ncolumns=1\nvalues=[999]\n[__luxe_exif]\nschema_version=1\nparser='debug_parser'\ncontent_mode='replace'\nneeds_fallback=true\nmodules=[]\n[__luxe_exif.preparation]\nfirst_source='toml'\nselected_source='debug_parser'\ndecision='fallback'\n").unwrap();
    let result = replace_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.replaced,
            result.summary.created,
            result.summary.retained,
            result.summary.cached,
            result.summary.failed,
            result.summary.partial
        ),
        (1, 0, 0, 0, 0, 0)
    );
    let root = dir.root("capture.toml");
    assert_eq!(root["AE"]["AE_TAG_ALGO_VER"].as_integer(), Some(123));
    assert_eq!(root["AE"]["AE_TAG_ALGO_SUBVER"].as_integer(), Some(7));
    assert!(root["AE"].get("USER_EXTRA").is_none());
    for name in ["AF", "Vendor_Raw", "Detail", "AE_DISPLAY", "AE_Table"] {
        assert!(root.get(name).is_none(), "old section {name} survived");
    }
    assert_eq!(root[META]["parser"].as_str(), Some("native"));
    assert_eq!(root[META]["content_mode"].as_str(), Some("native"));
    assert_eq!(root[META]["needs_fallback"].as_bool(), Some(false));
    assert!(root[META].get("preparation").is_none());
    let document = load_image_exif(&dir.0.join("capture.toml")).unwrap();
    assert_eq!(document.source.parser, "native");
    assert_eq!(document.source.content_mode.as_deref(), Some("native"));
    assert!(!document.needs_fallback);
    no_temporaries(&dir);
}

#[test]
fn native_replacement_overwrites_invalid_old_utf8_toml_and_reserved_user_metadata() {
    let dir = TempDir::new("native-replace-invalid-old");
    for (name, bytes) in [
        ("utf8", vec![0xff, 0xfe]),
        ("syntax", b"[AE]\nA=[".to_vec()),
        ("reserved", b"__luxe_exif='old user data'\n".to_vec()),
    ] {
        dir.image(&format!("{name}.jpg"), &native_jpeg(123));
        fs::write(dir.0.join(format!("{name}.toml")), bytes).unwrap();
    }
    let result = replace_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.total,
            result.summary.replaced,
            result.summary.created,
            result.summary.failed
        ),
        (3, 3, 0, 0)
    );
    for name in ["utf8.toml", "syntax.toml", "reserved.toml"] {
        let root = dir.root(name);
        assert_eq!(root["AE"]["AE_TAG_ALGO_VER"].as_integer(), Some(123));
        assert_eq!(root[META]["parser"].as_str(), Some("native"));
        assert_eq!(root[META]["content_mode"].as_str(), Some("native"));
    }
    no_temporaries(&dir);
}

#[test]
fn unavailable_native_replacement_preserves_old_bytes_and_reports_needs_debug_parser() {
    let dir = TempDir::new("native-replace-unavailable");
    let fixtures = [
        (
            "ordinary.jpg",
            vec![0xff, 0xd8, 0xff, 0xd9],
            b"# retain layout\n[AE]\nA=7\n[__luxe_exif]\nparser='debug_parser'\nneeds_fallback=false\n".to_vec(),
        ),
        ("unknown.jpg", ae_jpeg(999, &[]), vec![0xff, 0xfe]),
        ("broken.jpg", b"not JPEG".to_vec(), b"broken=[".to_vec()),
        (
            "statistics.jpg",
            stat_jpeg_with_dimensions([64, 48, 8, 5]),
            b"[AE_Table.old]\nrows=1\ncolumns=1\nvalues=[9]\n".to_vec(),
        ),
        ("unsupported.png", b"not PNG".to_vec(), b"KEEP=1\n".to_vec()),
    ];
    let mut originals = Vec::new();
    for (name, jpeg, bytes) in fixtures {
        dir.image(name, &jpeg);
        let target = dir.0.join(name).with_extension("toml");
        fs::write(&target, &bytes).unwrap();
        let time = fixed_mtime(&target);
        originals.push((target, bytes, time));
    }
    let result = replace_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    // Unavailable, not retained/cached: the old file cannot make this explicit
    // JPEG attempt appear complete, even if its old needs_fallback was false.
    assert_eq!(
        (
            result.summary.total,
            result.summary.unavailable,
            result.summary.failed,
            result.summary.replaced,
            result.summary.retained,
            result.summary.cached,
            result.summary.partial
        ),
        (5, 5, 1, 0, 0, 0, 0)
    );
    for (path, bytes, time) in originals {
        assert_eq!(fs::read(&path).unwrap(), bytes);
        assert_eq!(fs::metadata(path).unwrap().modified().unwrap(), time);
    }
    no_temporaries(&dir);
}

#[test]
fn partial_native_replacement_overwrites_complete_old_payload_without_clearing_fallback() {
    let dir = TempDir::new("native-replace-partial");
    dir.image("partial.jpg", &partial_jpeg(456));
    fs::write(dir.0.join("partial.toml"), "[AF]\nPOS=999\n[__luxe_exif]\nschema_version=1\nparser='debug_parser'\nneeds_fallback=false\nmodules=[]\n").unwrap();
    let result = replace_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.replaced,
            result.summary.partial,
            result.summary.unavailable,
            result.summary.failed
        ),
        (1, 1, 0, 0)
    );
    let root = dir.root("partial.toml");
    assert!(root.get("AF").is_none());
    assert_eq!(root["AE"]["AE_TAG_ALGO_VER"].as_integer(), Some(456));
    assert_eq!(root[META]["parser"].as_str(), Some("native"));
    assert_eq!(root[META]["content_mode"].as_str(), Some("native"));
    assert_eq!(root[META]["needs_fallback"].as_bool(), Some(true));
    let document = load_image_exif(&dir.0.join("partial.toml")).unwrap();
    assert!(document.needs_fallback);
    assert_eq!(document.source.parser, "native");
    assert_eq!(document.source.content_mode.as_deref(), Some("native"));
}

#[test]
fn statistics_only_native_replacement_replaces_old_table_shapes_and_unknown_sections() {
    let dir = TempDir::new("native-replace-tables");
    dir.image("statistics.jpg", &stat_jpeg());
    fs::write(dir.0.join("statistics.toml"), "[Vendor_Raw]\nDATA='drop'\n[AE_Table.old_only]\nrows=1\ncolumns=2\nvalues=[7,8]\n[AE_Table.8_6_LE_Y]\nrows=1\ncolumns=1\nvalues=[999]\n").unwrap();
    let result = replace_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.replaced,
            result.summary.partial,
            result.summary.unavailable,
            result.summary.failed
        ),
        (1, 1, 0, 0)
    );
    let root = dir.root("statistics.toml");
    assert!(root.get("Vendor_Raw").is_none());
    assert!(root["AE_Table"].get("old_only").is_none());
    assert_eq!(root["AE_Table"]["8_6_LE_Y"]["rows"].as_integer(), Some(6));
    assert_eq!(
        root["AE_Table"]["8_6_LE_Y"]["columns"].as_integer(),
        Some(8)
    );
    assert_eq!(
        root["AE_Table"]["8_6_LE_Y"]["values"]
            .as_array()
            .unwrap()
            .len(),
        48
    );
    assert_eq!(root[META]["content_mode"].as_str(), Some("native"));
    assert_eq!(root[META]["needs_fallback"].as_bool(), Some(true));
    assert_eq!(
        load_image_exif(&dir.0.join("statistics.toml"))
            .unwrap()
            .ae_tables
            .len(),
        7
    );
}

#[test]
fn missing_old_sidecar_can_receive_truthful_metadata_only_during_native_replacement() {
    let dir = TempDir::new("native-replace-missing");
    dir.image("native.jpg", &native_jpeg(123));
    dir.image("unknown.jpg", &ae_jpeg(999, &[]));
    dir.image("broken.jpg", b"not JPEG");
    let result = replace_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.unavailable,
            result.summary.created,
            result.summary.replaced,
            result.summary.failed
        ),
        (2, 1, 0, 1)
    );
    assert_eq!(
        dir.root("native.toml")["AE"]["AE_TAG_ALGO_VER"].as_integer(),
        Some(123)
    );
    for name in ["unknown.toml", "broken.toml"] {
        let root = dir.root(name);
        assert_eq!(root[META]["content_mode"].as_str(), Some("metadata_only"));
        assert_eq!(root[META]["needs_fallback"].as_bool(), Some(true));
        assert!(root.get("AE").is_none());
    }
    no_temporaries(&dir);
}

#[test]
fn native_replacement_selected_and_all_scopes_report_real_monotonic_progress_and_writes() {
    let dir = TempDir::new("native-replace-selection");
    let previous = b"[AE]\nAE_TAG_ALGO_VER=999\n";
    for name in ["one", "two", "three", "large"] {
        dir.image(&format!("{name}.jpg"), &native_jpeg(123));
        fs::write(dir.0.join(format!("{name}.toml")), previous).unwrap();
    }
    let selected = dir.0.join("two.jpg").to_string_lossy().into_owned();
    let mut selected_progress = Vec::new();
    let result = replace_image_metadata(&dir.0, vec![selected.clone(), selected], |event| {
        selected_progress.push((event.stage, event.completed, event.total));
    })
    .unwrap();
    assert_eq!(
        (
            result.summary.total,
            result.summary.replaced,
            result.entries.len()
        ),
        (1, 1, 4)
    );
    assert_eq!(selected_progress, vec![("JPEG", 0, 1), ("JPEG", 1, 1)]);
    assert_eq!(
        dir.root("two.toml")["AE"]["AE_TAG_ALGO_VER"].as_integer(),
        Some(123)
    );
    for name in ["one.toml", "three.toml", "large.toml"] {
        assert_eq!(dir.bytes(name), previous);
    }
    let large = dir.0.join("large.toml");
    fs::OpenOptions::new()
        .write(true)
        .open(&large)
        .unwrap()
        .set_len(16 * 1024 * 1024 + 1)
        .unwrap();
    // Rc<RefCell<_>> stays !Send: even explicit replacement dispatches all
    // progress on the calling coordinator, including failed image outcomes.
    let events = Rc::new(RefCell::new(Vec::new()));
    let captured = Rc::clone(&events);
    let caller = std::thread::current().id();
    let result = replace_image_metadata(&dir.0, Vec::new(), move |event| {
        assert_eq!(std::thread::current().id(), caller);
        captured
            .borrow_mut()
            .push((event.stage, event.completed, event.total));
    })
    .unwrap();
    assert_eq!(
        (
            result.summary.total,
            result.summary.replaced,
            result.summary.failed,
            result.summary.retained,
            result.summary.cached
        ),
        (4, 3, 1, 0, 0)
    );
    assert_eq!(
        *events.borrow(),
        vec![
            ("JPEG", 0, 4),
            ("JPEG", 1, 4),
            ("JPEG", 2, 4),
            ("JPEG", 3, 4),
            ("JPEG", 4, 4)
        ]
    );
    for name in ["one.toml", "two.toml", "three.toml"] {
        assert_eq!(
            dir.root(name)["AE"]["AE_TAG_ALGO_VER"].as_integer(),
            Some(123)
        );
    }
    assert_eq!(fs::metadata(large).unwrap().len(), 16 * 1024 * 1024 + 1);
    no_temporaries(&dir);
}

#[test]
fn manual_merge_equal_fields_keeps_bytes_source_and_partial_flags_without_fake_success() {
    let dir = TempDir::new("no-gain");
    dir.image("equal.jpg", &native_jpeg(123));
    let previous = "# no new fields means no rewrite\n[AE]\nAE_TAG_ALGO_VER=999\nAE_TAG_DEBUG_VER=11\n[__luxe_exif]\nschema_version=1\nparser='debug_parser'\nneeds_fallback=true\nmodules=[]\n";
    fs::write(dir.0.join("equal.toml"), previous).unwrap();
    let time = fixed_mtime(&dir.0.join("equal.toml"));
    let result = merge_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.retained,
            result.summary.replaced,
            result.summary.partial
        ),
        (1, 0, 1)
    );
    assert_eq!(dir.bytes("equal.toml"), previous.as_bytes());
    assert_eq!(
        fs::metadata(dir.0.join("equal.toml"))
            .unwrap()
            .modified()
            .unwrap(),
        time
    );
}

#[test]
fn only_explicit_manual_merge_retries_partial_after_image_changes() {
    let dir = TempDir::new("manual-retry");
    dir.image("retry.jpg", &partial_jpeg(123));
    prepare_image_metadata(&dir.0, |_| {}).unwrap();
    let original = dir.bytes("retry.toml");
    dir.image("retry.jpg", &ae_jpeg(11, &[(0, 11), (1, 456), (2, 7)]));
    assert_eq!(
        prepare_image_metadata(&dir.0, |_| {})
            .unwrap()
            .summary
            .cached,
        1
    );
    assert_eq!(dir.bytes("retry.toml"), original);
    let result = merge_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.replaced,
            result.summary.partial,
            result.summary.failed
        ),
        (1, 0, 0)
    );
    let root = dir.root("retry.toml");
    assert_eq!(root["AE"]["AE_TAG_ALGO_VER"].as_integer(), Some(123));
    assert_eq!(root["AE"]["AE_TAG_ALGO_SUBVER"].as_integer(), Some(7));
    assert_eq!(root[META]["needs_fallback"].as_bool(), Some(false));
}

#[test]
fn metadata_only_is_reused_until_manual_native_merge_adds_real_content() {
    let dir = TempDir::new("metadata-retry");
    dir.image("retry.jpg", &ae_jpeg(999, &[]));
    prepare_image_metadata(&dir.0, |_| {}).unwrap();
    let before = dir.bytes("retry.toml");
    dir.image("retry.jpg", &native_jpeg(123));
    assert_eq!(
        prepare_image_metadata(&dir.0, |_| {})
            .unwrap()
            .summary
            .cached,
        1
    );
    assert_eq!(dir.bytes("retry.toml"), before);
    let result = merge_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!((result.summary.replaced, result.summary.failed), (1, 0));
    assert_eq!(
        dir.root("retry.toml")["AE"]["AE_TAG_ALGO_VER"].as_integer(),
        Some(123)
    );
}

#[test]
fn statistics_only_native_payload_is_saved_and_manual_merge_preserves_existing_table_shapes() {
    let dir = TempDir::new("tables");
    dir.image("fresh.jpg", &stat_jpeg());
    let auto = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            auto.summary.created,
            auto.summary.partial,
            auto.summary.failed
        ),
        (1, 1, 0)
    );
    assert_eq!(
        load_image_exif(&dir.0.join("fresh.toml"))
            .unwrap()
            .ae_tables
            .len(),
        7
    );
    dir.image("merge.jpg", &stat_jpeg());
    fs::write(dir.0.join("merge.toml"), "[AE_Table.old_only]\nrows=1\ncolumns=2\nvalues=[7,8]\n[AE_Table.8_6_LE_Y]\nrows=1\ncolumns=1\nvalues=[999]\n").unwrap();
    let result = merge_image_metadata(
        &dir.0,
        vec![dir.0.join("merge.jpg").to_string_lossy().into_owned()],
        |_| {},
    )
    .unwrap();
    assert_eq!((result.summary.replaced, result.summary.total), (1, 1));
    let root = dir.root("merge.toml");
    assert_eq!(
        root["AE_Table"]["old_only"]["values"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(root["AE_Table"]["8_6_LE_Y"]["rows"].as_integer(), Some(1));
    assert_eq!(
        root["AE_Table"]["8_6_LE_Y"]["values"].as_array().unwrap()[0].as_integer(),
        Some(999)
    );
    assert_eq!(
        root["AE_Table"]["8_6_LE_R"]["values"]
            .as_array()
            .unwrap()
            .len(),
        48
    );
}

#[test]
fn unsupported_png_and_bad_jpeg_create_honest_metadata_only_and_are_then_reused() {
    let dir = TempDir::new("unavailable");
    dir.image("ordinary.jpg", &[0xff, 0xd8, 0xff, 0xd9]);
    dir.image("unknown.jpg", &ae_jpeg(999, &[]));
    dir.image("png.png", b"no pixel decoding");
    dir.image("broken.jpg", b"not JPEG");
    let first = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            first.summary.unavailable,
            first.summary.failed,
            first.summary.partial
        ),
        (4, 1, 0)
    );
    for name in ["ordinary.toml", "unknown.toml", "png.toml", "broken.toml"] {
        let root = dir.root(name);
        assert_eq!(root[META]["needs_fallback"].as_bool(), Some(true));
        assert_eq!(root[META]["content_mode"].as_str(), Some("metadata_only"));
        assert!(root[META].get("preparation").is_none());
    }
    let second = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!((second.summary.cached, second.summary.failed), (4, 0));
}

#[test]
fn invalid_existing_tomls_fail_automatically_and_manually_without_overwrite() {
    let dir = TempDir::new("invalid");
    for (name, bytes) in [
        ("utf8", vec![0xff, 0xfe]),
        ("syntax", b"[AE]\nA=[".to_vec()),
    ] {
        dir.image(&format!("{name}.jpg"), &native_jpeg(123));
        fs::write(dir.0.join(format!("{name}.toml")), bytes).unwrap();
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
    dir.image("valid.jpg", &native_jpeg(456));
    let auto = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            auto.summary.total,
            auto.summary.failed,
            auto.summary.created
        ),
        (4, 3, 1)
    );
    let manual = merge_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!((manual.summary.failed, manual.summary.retained), (3, 1));
    assert_eq!(dir.bytes("utf8.toml"), vec![0xff, 0xfe]);
    assert_eq!(dir.bytes("syntax.toml"), b"[AE]\nA=[");
    assert_eq!(fs::metadata(large).unwrap().len(), 16 * 1024 * 1024 + 1);
}

#[test]
fn manual_native_read_errors_do_not_modify_existing_tomls() {
    let dir = TempDir::new("read-error");
    dir.image("bad.jpg", b"broken image");
    let original = b"# keep exact bytes\n[AE]\nA=7\n";
    fs::write(dir.0.join("bad.toml"), original).unwrap();
    assert_eq!(
        prepare_image_metadata(&dir.0, |_| {})
            .unwrap()
            .summary
            .cached,
        1
    );
    let result = merge_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!((result.summary.failed, result.summary.replaced), (1, 0));
    assert_eq!(dir.bytes("bad.toml"), original);
}

#[test]
fn manual_selection_deduplicates_and_only_touches_selected_current_directory_images() {
    let dir = TempDir::new("selection");
    for name in ["one", "two", "three"] {
        dir.image(&format!("{name}.jpg"), &native_jpeg(123));
        fs::write(
            dir.0.join(format!("{name}.toml")),
            "[AE]\nAE_TAG_ALGO_VER=999\n",
        )
        .unwrap();
    }
    let selected = dir.0.join("two.jpg").to_string_lossy().into_owned();
    let result = merge_image_metadata(&dir.0, vec![selected.clone(), selected], |_| {}).unwrap();
    assert_eq!(
        (
            result.summary.total,
            result.summary.replaced,
            result.entries.len()
        ),
        (1, 1, 3)
    );
    assert!(dir.root("two.toml")["AE"].get("AE_TAG_DEBUG_VER").is_some());
    assert!(dir.root("one.toml")["AE"].get("AE_TAG_DEBUG_VER").is_none());
    assert!(dir.root("three.toml")["AE"]
        .get("AE_TAG_DEBUG_VER")
        .is_none());
}

#[test]
fn invalid_selection_rejects_the_whole_manual_request_before_any_file_write() {
    let dir = TempDir::new("invalid-selection");
    let other = TempDir::new("other-selection");
    dir.image("good.jpg", &native_jpeg(123));
    other.image("outside.jpg", &native_jpeg(1));
    let original = b"[AE]\nAE_TAG_ALGO_VER=999\n";
    fs::write(dir.0.join("good.toml"), original).unwrap();
    for bad in [
        other.0.join("outside.jpg"),
        dir.0.join("missing.jpg"),
        dir.0.join("good.toml"),
        PathBuf::from("relative.jpg"),
        dir.0.join("nested/../good.jpg"),
    ] {
        let selection = vec![
            dir.0.join("good.jpg").to_string_lossy().into_owned(),
            bad.to_string_lossy().into_owned(),
        ];
        assert!(merge_image_metadata(&dir.0, selection.clone(), |_| {}).is_err());
        assert!(replace_image_metadata(&dir.0, selection, |_| {}).is_err());
        assert_eq!(dir.bytes("good.toml"), original);
    }
}

#[test]
fn progress_callbacks_remain_on_the_calling_thread_and_count_failures_monotonically() {
    let dir = TempDir::new("progress");
    for index in 0..12 {
        dir.image(&format!("{index}.jpg"), &native_jpeg(index));
    }
    fs::write(dir.0.join("5.toml"), "broken=[").unwrap();
    // Rc<RefCell<_>> is intentionally !Send: IPC progress need not cross workers.
    let events = Rc::new(RefCell::new(Vec::new()));
    let captured = Rc::clone(&events);
    let caller = std::thread::current().id();
    let result = prepare_image_metadata(&dir.0, move |event| {
        assert_eq!(std::thread::current().id(), caller);
        captured.borrow_mut().push((event.completed, event.total));
    })
    .unwrap();
    assert_eq!((result.summary.created, result.summary.failed), (11, 1));
    let events = events.borrow();
    assert_eq!(events.len(), 13);
    assert_eq!(events[0], (0, 12));
    assert_eq!(events[12], (12, 12));
    assert!(events.windows(2).all(|pair| pair[1].0 == pair[0].0 + 1));
}

#[test]
fn old_preparation_history_is_compatible_but_not_regenerated_as_a_cache() {
    let dir = TempDir::new("old-history");
    dir.image("old.jpg", &native_jpeg(123));
    let original = "[AE]\nAE_TAG_ALGO_VER=999\n[__luxe_exif]\nschema_version=1\nparser='debug_parser'\nneeds_fallback=true\nmodules=[]\n[__luxe_exif.preparation]\nfirst_source='toml'\nselected_source='debug_parser'\ndecision='fallback'\nsignature={parser_revision='obsolete'}\n";
    fs::write(dir.0.join("old.toml"), original).unwrap();
    assert_eq!(
        prepare_image_metadata(&dir.0, |_| {})
            .unwrap()
            .summary
            .cached,
        1
    );
    assert_eq!(dir.bytes("old.toml"), original.as_bytes());
    assert_eq!(
        merge_image_metadata(&dir.0, Vec::new(), |_| {})
            .unwrap()
            .summary
            .replaced,
        1
    );
    let root = dir.root("old.toml");
    assert_eq!(
        root[META]["preparation"]["first_source"].as_str(),
        Some("toml")
    );
    assert!(root[META]["preparation"].get("signature").is_none());
    assert_eq!(root["AE"]["AE_TAG_ALGO_VER"].as_integer(), Some(999));
}

#[test]
fn same_stem_directory_and_state_protection_apply_to_automatic_and_manual_paths() {
    let dir = TempDir::new("protected");
    dir.image("same.jpg", &native_jpeg(1));
    dir.image("same.jpeg", &native_jpeg(2));
    dir.image("directory.jpg", &native_jpeg(3));
    fs::create_dir(dir.0.join("directory.png")).unwrap();
    dir.image("state.jpg", &native_jpeg(4));
    let state = b"[settings]\nlanguage=0\n";
    fs::write(dir.0.join("state.toml"), state).unwrap();
    for result in [
        prepare_image_metadata(&dir.0, |_| {}).unwrap(),
        merge_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap(),
        replace_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap(),
    ] {
        assert_eq!(
            (
                result.summary.total,
                result.summary.failed,
                result.summary.created
            ),
            (4, 4, 0)
        );
    }
    assert!(!dir.0.join("same.toml").exists());
    assert!(!dir.0.join("directory.toml").exists());
    assert_eq!(dir.bytes("state.toml"), state);
}

#[test]
fn readonly_valid_toml_is_reused_automatically_but_manual_changes_fail_without_temporary_leaks() {
    let dir = TempDir::new("readonly");
    dir.image("locked.jpg", &native_jpeg(123));
    let original = b"# byte layout\n[AE]\nAE_TAG_ALGO_VER=999\n";
    let path = dir.0.join("locked.toml");
    fs::write(&path, original).unwrap();
    let permissions = fs::metadata(&path).unwrap().permissions();
    let mut locked = permissions.clone();
    locked.set_readonly(true);
    fs::set_permissions(&path, locked).unwrap();
    assert_eq!(
        prepare_image_metadata(&dir.0, |_| {})
            .unwrap()
            .summary
            .cached,
        1
    );
    let manual = merge_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!((manual.summary.failed, manual.summary.replaced), (1, 0));
    let replaced = replace_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap();
    assert_eq!((replaced.summary.failed, replaced.summary.replaced), (1, 0));
    assert_eq!(dir.bytes("locked.toml"), original);
    no_temporaries(&dir);
    fs::set_permissions(path, permissions).unwrap();
}

#[cfg(windows)]
#[test]
fn windows_target_without_delete_sharing_stays_unmodified_during_explicit_native_operations() {
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
    for result in [
        merge_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap(),
        replace_image_metadata(&dir.0, Vec::new(), |_| {}).unwrap(),
    ] {
        assert_eq!((result.summary.failed, result.summary.replaced), (1, 0));
    }
    assert_eq!(dir.bytes("occupied.toml"), original);
    no_temporaries(&dir);
}

#[cfg(any(unix, windows))]
#[test]
fn linked_targets_and_parent_directories_never_follow_external_metadata() {
    let dir = TempDir::new("links");
    let external = TempDir::new("outside");
    let original = b"[AE]\nAE_TAG_ALGO_VER=999\n";
    let outside = external.0.join("outside.toml");
    fs::write(&outside, original).unwrap();
    dir.image("linked.jpg", &native_jpeg(123));
    #[cfg(unix)]
    let result = std::os::unix::fs::symlink(&outside, dir.0.join("linked.toml"));
    #[cfg(windows)]
    let result = std::os::windows::fs::symlink_file(&outside, dir.0.join("linked.toml"));
    if let Err(error) = result {
        eprintln!("symlink fixture unavailable: {error}");
        return;
    }
    assert_eq!(
        prepare_image_metadata(&dir.0, |_| {})
            .unwrap()
            .summary
            .failed,
        1
    );
    assert_eq!(
        merge_image_metadata(&dir.0, Vec::new(), |_| {})
            .unwrap()
            .summary
            .failed,
        1
    );
    assert_eq!(
        replace_image_metadata(&dir.0, Vec::new(), |_| {})
            .unwrap()
            .summary
            .failed,
        1
    );
    assert_eq!(fs::read(&outside).unwrap(), original);
    let linked_dir = dir.0.join("linked-directory");
    #[cfg(unix)]
    std::os::unix::fs::symlink(&external.0, &linked_dir).unwrap();
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&external.0, &linked_dir).unwrap();
    assert!(prepare_image_metadata(&linked_dir, |_| {}).is_err());
    assert!(merge_image_metadata(&linked_dir, Vec::new(), |_| {}).is_err());
    assert!(replace_image_metadata(&linked_dir, Vec::new(), |_| {}).is_err());
    fs::remove_file(dir.0.join("linked.toml")).unwrap();
    #[cfg(unix)]
    fs::remove_file(linked_dir).unwrap();
    #[cfg(windows)]
    fs::remove_dir(linked_dir).unwrap();
}

#[test]
fn empty_directory_has_a_single_zero_completion_event() {
    let dir = TempDir::new("empty-directory");
    let mut events = Vec::new();
    let result =
        prepare_image_metadata(&dir.0, |event| events.push((event.completed, event.total)))
            .unwrap();
    assert_eq!(result.summary.total, 0);
    assert_eq!(events, vec![(0, 0)]);
}

#[test]
#[ignore = "fixture throughput observation for CI/manual runs; no performance claim until executed"]
fn benchmark_automatic_reuse_versus_missing_tomls() {
    let dir = TempDir::new("benchmark");
    const COUNT: usize = 128;
    for index in 0..COUNT {
        dir.image(&format!("frame-{index:04}.jpg"), &native_jpeg(index as u32));
    }
    let fresh_started = Instant::now();
    let fresh = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    let fresh_elapsed = fresh_started.elapsed();
    assert_eq!(fresh.summary.created, COUNT);
    let reused_started = Instant::now();
    let reused = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    let reused_elapsed = reused_started.elapsed();
    assert_eq!(reused.summary.cached, COUNT);
    eprintln!("metadata fixture throughput count={COUNT} native_missing_ms={} existing_toml_ms={} native_missing_images_per_second={:.2} existing_toml_images_per_second={:.2}",fresh_elapsed.as_millis(),reused_elapsed.as_millis(),COUNT as f64/fresh_elapsed.as_secs_f64(),COUNT as f64/reused_elapsed.as_secs_f64());
}
