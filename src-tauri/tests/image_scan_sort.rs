use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use luxe_tauri_lib::image_scan::scan_directory;

struct ScanDir(PathBuf);

impl ScanDir {
    fn new() -> Self {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("luxe-sort-{}-{nonce}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for ScanDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn scan_orders_filename_numbers_naturally_and_preserves_sidecars() {
    let dir = ScanDir::new();
    let names = ["10_scene", "2_scene", "1_scene", "001_scene", "20_scene",
        "2_take10", "2_take2", "IMG_10", "img_2", "场景10", "场景2",
        "999999999999999999999999999999", "1000000000000000000000000000000"];
    for name in names {
        fs::write(dir.0.join(format!("{name}.jpg")), []).unwrap();
    }
    fs::write(dir.0.join("2_scene.toml"), "AE_TAG_CWV = 1\n").unwrap();
    let entries = scan_directory(&dir.0).unwrap();
    let sorted: Vec<_> = entries.iter().map(|entry| entry.name.as_str()).collect();
    assert_eq!(sorted, ["001_scene", "1_scene", "2_scene", "2_take2", "2_take10",
        "10_scene", "20_scene", "999999999999999999999999999999",
        "1000000000000000000000000000000", "img_2", "IMG_10", "场景2", "场景10"]);
    for entry in entries {
        assert_eq!(entry.jpg_path, dir.0.join(format!("{}.jpg", entry.name)).to_string_lossy());
        assert_eq!(entry.toml_path, dir.0.join(format!("{}.toml", entry.name)).to_string_lossy());
    }
}

#[test]
fn scan_uses_stable_order_for_zero_padded_numbers_and_duplicate_stems() {
    let dir = ScanDir::new();
    for name in ["2.jpg", "02.png", "002.jpeg", "000.PNG", "0.jpg", "2.png"] {
        fs::write(dir.0.join(name), []).unwrap();
    }
    let entries = scan_directory(&dir.0).unwrap();
    let filenames: Vec<_> = entries.iter().map(|entry| {
        std::path::Path::new(&entry.jpg_path).file_name().unwrap().to_str().unwrap()
    }).collect();
    assert_eq!(filenames, ["0.jpg", "000.PNG", "002.jpeg", "02.png", "2.jpg", "2.png"]);
    assert_eq!(scan_directory(&dir.0).unwrap().iter().map(|entry| &entry.jpg_path).collect::<Vec<_>>(),
        entries.iter().map(|entry| &entry.jpg_path).collect::<Vec<_>>());
}
