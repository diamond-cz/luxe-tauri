//! Public projections used by the IPC layer must never restart native JPEG work.
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use luxe_tauri_lib::image_scan::{
    load_prepared_image_exif, load_prepared_image_toml, load_prepared_image_toml_batch,
    load_prepared_image_toml_fields_batch, load_prepared_image_toml_sections,
    prepare_image_metadata,
};

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("luxe-prepared-{}-{nonce}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn jpeg() -> Vec<u8> {
    let mut payload = vec![0x06, 0xf2, 0xf1, 0xf0];
    payload.extend_from_slice(&0u16.to_le_bytes());
    payload.extend_from_slice(&1u16.to_le_bytes());
    payload.extend_from_slice(&36u32.to_le_bytes());
    payload.extend_from_slice(&36u32.to_le_bytes());
    payload.extend_from_slice(&0xe28f_a520u32.to_le_bytes());
    payload.extend_from_slice(&11u32.to_le_bytes());
    payload.extend_from_slice(&[0; 24]);
    for word in [0x0100_0000u32, 11, 0x0100_0001, 123] {
        payload.extend_from_slice(&word.to_le_bytes());
    }
    let mut result = vec![0xff, 0xd8, 0xff, 0xe6];
    result.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
    result.extend(payload);
    result.extend([0xff, 0xd9]);
    result
}

#[test]
fn missing_toml_never_falls_back_to_a_readable_jpeg_in_any_prepared_projection() {
    let dir = TempDir::new();
    let image = dir.0.join("capture.jpg");
    let path = dir.0.join("capture.toml");
    let bytes = jpeg();
    fs::write(&image, &bytes).unwrap();
    assert!(load_prepared_image_toml(&path).is_err());
    assert!(load_prepared_image_exif(&path).is_err());
    assert!(load_prepared_image_toml_sections(&path).is_err());
    let key = path.to_string_lossy().into_owned();
    assert!(load_prepared_image_toml_batch(vec![key.clone()]).unwrap()[&key].is_empty());
    assert!(load_prepared_image_toml_fields_batch(
        vec![key.clone()],
        vec!["AE_TAG_ALGO_VER".into()]
    )
    .unwrap()[&key]
        .is_empty());
    assert!(!path.exists());
    assert_eq!(fs::read(image).unwrap(), bytes);
}

#[test]
fn after_import_all_projections_use_toml_even_when_jpeg_is_no_longer_readable() {
    let dir = TempDir::new();
    let image = dir.0.join("capture.jpg");
    let path = dir.0.join("capture.toml");
    fs::write(&image, jpeg()).unwrap();
    let prepared = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(prepared.summary.created, 1);
    let toml_before = fs::read(&path).unwrap();
    fs::write(&image, b"cannot be parsed as JPEG").unwrap();
    let fields = load_prepared_image_toml(&path).unwrap();
    assert_eq!(fields["AE_TAG_ALGO_VER"], "123");
    let document = load_prepared_image_exif(&path).unwrap();
    assert_eq!(document.source.kind, "toml");
    assert_eq!(document.source.parser, "native");
    let provenance = document.preparation.unwrap();
    assert_eq!(provenance.first_source, "jpeg");
    assert_eq!(provenance.selected_source, "jpeg");
    assert_eq!(provenance.decision, "native_created");
    assert!(load_prepared_image_toml_sections(&path)
        .unwrap()
        .iter()
        .any(|section| section.name == "AE"));
    let key = path.to_string_lossy().into_owned();
    assert_eq!(
        load_prepared_image_toml_batch(vec![key.clone()]).unwrap()[&key]["AE_TAG_ALGO_VER"],
        "123"
    );
    assert_eq!(
        load_prepared_image_toml_fields_batch(vec![key.clone()], vec!["AE_TAG_ALGO_VER".into()])
            .unwrap()[&key]["AE_TAG_ALGO_VER"],
        "123"
    );
    assert_eq!(
        fs::read(&path).unwrap(),
        toml_before,
        "clicking must never prepare or rewrite"
    );
    fs::remove_file(&path).unwrap();
    assert!(
        load_prepared_image_toml(&path).is_err(),
        "a cached map cannot conceal a removed sidecar"
    );
}

#[test]
fn bare_legacy_ae_tags_can_be_upgraded_without_treating_unknown_roots_as_aliases() {
    let dir = TempDir::new();
    fs::write(dir.0.join("bare.jpg"), jpeg()).unwrap();
    let path = dir.0.join("bare.toml");
    fs::write(&path, "AE_TAG_ALGO_VER = 99\n").unwrap();
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(result.summary.replaced, 1);
    let fields = load_prepared_image_toml(&path).unwrap();
    assert_eq!(fields["AE_TAG_ALGO_VER"], "123");
    assert_eq!(fields["AE_TAG_DEBUG_VER"], "11");
    fs::write(&path, "[my_custom_section]\nAE_TAG_ALGO_VER = 99\n").unwrap();
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(result.summary.retained, 1);
    assert_eq!(
        load_prepared_image_toml(&path).unwrap()["AE_TAG_ALGO_VER"],
        "99"
    );
}

#[test]
fn metadata_only_toml_preserves_unavailable_and_fallback_status_for_detail() {
    let dir = TempDir::new();
    fs::write(dir.0.join("plain.jpg"), [0xff, 0xd8, 0xff, 0xd9]).unwrap();
    let result = prepare_image_metadata(&dir.0, |_| {}).unwrap();
    assert_eq!(result.summary.unavailable, 1);
    let path = dir.0.join("plain.toml");
    let detail = load_prepared_image_exif(&path).unwrap();
    assert!(detail.needs_fallback);
    assert!(detail.sections.is_empty());
    assert!(detail.ae_tables.is_empty());
    let info = detail.preparation.unwrap();
    assert_eq!(info.selected_source, "none");
    assert_eq!(info.decision, "unavailable");
    assert!(load_prepared_image_toml(&path).unwrap().is_empty());
}
