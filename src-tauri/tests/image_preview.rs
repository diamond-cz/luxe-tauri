use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use image::{Rgb, RgbImage};
use luxe_tauri_lib::image_scan::load_image_preview;

#[test]
fn preview_is_bounded_and_reused() {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("luxe-preview-test-{}-{stamp}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let source = dir.join("capture.png");
    RgbImage::from_pixel(2000, 1200, Rgb([90, 120, 150])).save(&source).unwrap();

    let preview = load_image_preview(&source).unwrap();
    assert_eq!(preview, load_image_preview(&source).unwrap());
    let (width, height) = image::image_dimensions(Path::new(&preview)).unwrap();
    assert!(width <= 1600 && height <= 1600, "preview dimensions: {width}x{height}");

    RgbImage::from_pixel(2100, 1200, Rgb([100, 130, 160])).save(&source).unwrap();
    let updated = load_image_preview(&source).unwrap();
    assert_ne!(preview, updated);

    fs::remove_dir_all(dir).unwrap();
}
