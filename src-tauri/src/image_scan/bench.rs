use std::fs;
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use image::{Rgb, RgbImage};

use super::{clear_memory_caches, load_image_hover_preview, load_image_thumbnail_batch};

fn make_jpeg(path: &Path) {
    let image = RgbImage::from_fn(4000, 3000, |x, y| {
        Rgb([
            ((x * 13 + y * 7) % 256) as u8,
            ((x * 3 + y * 11) % 256) as u8,
            ((x * 5 + y * 17) % 256) as u8,
        ])
    });
    image.save(path).unwrap();
}

#[test]
#[ignore = "run explicitly to compare image decode throughput"]
fn jpeg_preview_and_batch_throughput() {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("luxe-jpeg-bench-{}-{stamp}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    let first = dir.join("capture-0.jpg");
    make_jpeg(&first);

    let preview_start = Instant::now();
    for _ in 0..4 {
        clear_memory_caches();
        load_image_hover_preview(&first).unwrap();
    }
    println!(
        "JPEG hover preview: {:?} / 4 images",
        preview_start.elapsed()
    );

    let paths: Vec<_> = (0..8)
        .map(|index| {
            let path = dir.join(format!("capture-{index}.jpg"));
            if index != 0 {
                fs::copy(&first, &path).unwrap();
            }
            path.to_string_lossy().into_owned()
        })
        .collect();
    clear_memory_caches();
    let batch_start = Instant::now();
    let output = load_image_thumbnail_batch(paths, 128, false).unwrap();
    assert_eq!(output.len(), 8);
    println!(
        "JPEG thumbnail batch: {:?} / 8 images",
        batch_start.elapsed()
    );
    fs::remove_dir_all(dir).unwrap();
}
