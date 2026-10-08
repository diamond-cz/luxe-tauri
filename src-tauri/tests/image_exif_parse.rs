use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use luxe_tauri_lib::image_scan::parse_exif_directory;

#[test]
fn existing_exif_generates_toml_and_existing_toml_is_preserved() {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("luxe-exif-test-{}-{nonce}", std::process::id()));
    fs::create_dir(&dir).unwrap();
    let parser = dir.join("DebugParser.exe");
    fs::write(&parser, []).unwrap();
    fs::write(dir.join("new.jpg"), []).unwrap();
    fs::write(dir.join("new.jpg.exif"), "[AE]\nAE_TAG_REALBVX1000: 123 | AE_TAG_CWV: 456\n").unwrap();
    fs::write(dir.join("existing.png"), []).unwrap();
    fs::write(dir.join("existing.toml"), "AE_TAG_CWV = 789\n").unwrap();

    let mut progress = Vec::new();
    let result = parse_exif_directory(&parser, &dir, |event| {
        progress.push((event.stage, event.completed, event.total));
    }).unwrap();

    assert_eq!((result.processed, result.skipped, result.failed, result.total), (1, 1, 0, 2));
    let generated = fs::read_to_string(dir.join("new.toml")).unwrap();
    let parsed: toml::Value = toml::from_str(&generated).unwrap();
    assert_eq!(parsed["AE"]["AE_TAG_REALBVX1000"].as_integer(), Some(123));
    assert_eq!(parsed["AE"]["AE_TAG_CWV"].as_integer(), Some(456));
    assert_eq!(fs::read_to_string(dir.join("existing.toml")).unwrap(), "AE_TAG_CWV = 789\n");
    assert_eq!(progress, vec![("EXIF", 0, 1), ("EXIF", 1, 1), ("TOML", 0, 1), ("TOML", 1, 1)]);

    fs::remove_dir_all(dir).unwrap();
}
