use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use luxe_tauri_lib::image_scan::scan_directory;

#[test]
fn scan_keeps_images_without_sidecar_toml() {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("luxe-image-scan-{}-{nonce}", std::process::id()));
    fs::create_dir(&dir).unwrap();

    fs::write(dir.join("with.jpg"), []).unwrap();
    fs::write(dir.join("with.toml"), "AE_TAG_CWV = 1\n").unwrap();
    fs::write(dir.join("without.PNG"), []).unwrap();

    let entries = scan_directory(&dir).unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0].name, "with");
    assert_eq!(entries[0].toml_path, dir.join("with.toml").to_string_lossy());
    assert_eq!(entries[1].name, "without");
    assert_eq!(entries[1].toml_path, dir.join("without.toml").to_string_lossy());

    fs::remove_file(dir.join("with.toml")).unwrap();
    let without_any_toml = scan_directory(&dir).unwrap();
    assert_eq!(without_any_toml.len(), 2);

    fs::remove_dir_all(&dir).unwrap();
}
