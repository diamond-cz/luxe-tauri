//! Observable IO contracts; test fixtures never launch an external process.
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::{parse_debug_parser_directory_with, read_jpeg_metadata};
use crate::error::AppError;

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("luxe-pipeline-{}-{nonce}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
    fn parser(&self) -> PathBuf {
        let path = self.0.join("DebugParser.exe");
        fs::write(&path, []).unwrap();
        path
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn private_metadata_reader_skips_standard_exif_thumbnails_and_stops_before_pixels() {
    let dir = TempDir::new();
    let path = dir.0.join("capture.jpg");
    let mut bytes = vec![0xff, 0xd8];
    bytes.extend([0xff, 0xe1]);
    bytes.extend(60_002u16.to_be_bytes());
    bytes.resize(bytes.len() + 60_000, 7);
    bytes.extend([0xff, 0xdb, 0, 4, 8, 9]);
    let private = [0xff, 0xe6, 0, 6, 0x06, 0xf2, 0xf1, 0xf0];
    bytes.extend(private);
    bytes.extend([0xff, 0xda]);
    bytes.resize(bytes.len() + 64 * 1024, 3);
    fs::write(&path, bytes).unwrap();
    let extracted = read_jpeg_metadata(&path).unwrap();
    assert_eq!(
        extracted,
        [&[0xff, 0xd8][..], &private, &[0xff, 0xda]].concat()
    );
    assert!(
        extracted.len() < 32,
        "standard EXIF/thumbnail/table bytes must not enter private decoder scans"
    );
    fs::write(&path, [0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0]).unwrap();
    assert!(
        read_jpeg_metadata(&path).is_err(),
        "seek-skipping cannot accept a truncated segment"
    );
}

#[test]
fn explicit_dp_overwrites_complete_tomls_with_fresh_output_and_never_uses_old_sidecars() {
    let dir = TempDir::new();
    let parser = dir.parser();
    for name in ["one", "two"] {
        fs::write(
            dir.0.join(format!("{name}.jpg")),
            b"DP input is not a native JPEG fixture",
        )
        .unwrap();
        fs::write(
            dir.0.join(format!("{name}.toml")),
            "[AE]\nOLD_ONLY=1\nSHARED=2\n",
        )
        .unwrap();
        fs::write(
            dir.0.join(format!("{name}.jpg.exif")),
            "[AE]\nSTALE: 999 |\n",
        )
        .unwrap();
    }
    let mut temporary = None;
    let mut called = 0;
    let progress = std::cell::RefCell::new(Vec::new());
    let summary = parse_debug_parser_directory_with(
        Some(&parser),
        &dir.0,
        |event| {
            progress
                .borrow_mut()
                .push((event.stage, event.completed, event.total))
        },
        |executable, root| {
            assert_eq!(
                progress.borrow().last(),
                Some(&("DP", 0, 0)),
                "running is reported before the blocking tool call"
            );
            called += 1;
            temporary = Some(root.to_path_buf());
            assert_eq!(executable, parser);
            assert_eq!(
                fs::read_dir(root).unwrap().count(),
                2,
                "tool input directory contains only newly copied images"
            );
            for name in ["one", "two"] {
                fs::write(
                    root.join(format!("{name}.jpg.exif")),
                    "[AE]\nSHARED: 7 | DP_ONLY: 8 |\n",
                )?;
            }
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(called, 1);
    assert_eq!(
        (
            summary.total,
            summary.processed,
            summary.fallback,
            summary.direct,
            summary.skipped,
            summary.failed
        ),
        (2, 2, 2, 0, 0, 0)
    );
    for name in ["one", "two"] {
        let root: toml::Value =
            toml::from_str(&fs::read_to_string(dir.0.join(format!("{name}.toml"))).unwrap())
                .unwrap();
        assert_eq!(root["AE"]["SHARED"].as_integer(), Some(7));
        assert!(root["AE"].get("OLD_ONLY").is_none());
        assert!(root["AE"].get("STALE").is_none());
        assert_eq!(root["__luxe_exif"]["parser"].as_str(), Some("debug_parser"));
        assert_eq!(
            root["__luxe_exif"]["content_mode"].as_str(),
            Some("replace")
        );
        assert_eq!(
            fs::read(dir.0.join(format!("{name}.jpg"))).unwrap(),
            b"DP input is not a native JPEG fixture"
        );
        assert!(fs::read_to_string(dir.0.join(format!("{name}.jpg.exif")))
            .unwrap()
            .contains("STALE"));
    }
    assert!(!temporary.unwrap().exists());
    assert_eq!(progress.into_inner(), vec![
        ("PREPARE", 0, 0), ("PREPARE", 0, 2), ("PREPARE", 1, 2), ("PREPARE", 2, 2),
        ("DP", 0, 0), ("TOML", 0, 2), ("TOML", 1, 2), ("TOML", 2, 2),
    ], "preparation and writes report real image counts; the tool itself never claims a percentage");
}

#[test]
fn explicit_dp_requires_a_tool_and_failure_or_empty_output_leaves_original_toml() {
    let dir = TempDir::new();
    let parser = dir.parser();
    let image = dir.0.join("capture.jpg");
    let toml = dir.0.join("capture.toml");
    fs::write(&image, b"image bytes unchanged").unwrap();
    let original = "[AE]\nKEEP=42\n";
    fs::write(&toml, original).unwrap();
    assert!(parse_debug_parser_directory_with(
        None,
        &dir.0,
        |_| {},
        |_, _| panic!("missing tool cannot run")
    )
    .is_err());
    let mut failed_progress = Vec::new();
    let failed = parse_debug_parser_directory_with(
        Some(&parser),
        &dir.0,
        |event| failed_progress.push((event.stage, event.completed, event.total)),
        |_, _| Err(AppError::Other("tool failed".into())),
    )
    .unwrap();
    assert_eq!(failed.failed, 1);
    assert_eq!(
        failed_progress.last(),
        Some(&("DP", 0, 0)),
        "failure must not emit a fake DP completion count"
    );
    assert_eq!(fs::read_to_string(&toml).unwrap(), original);
    let empty = parse_debug_parser_directory_with(
        Some(&parser),
        &dir.0,
        |_| {},
        |_, root| {
            fs::write(root.join("capture.jpg.exif"), "[AE]\n")?;
            Ok(())
        },
    )
    .unwrap();
    assert_eq!(empty.failed, 1);
    assert_eq!(fs::read_to_string(&toml).unwrap(), original);
    assert_eq!(fs::read(&image).unwrap(), b"image bytes unchanged");
}

#[test]
fn changed_source_during_external_parsing_cannot_attach_results_to_a_different_image() {
    let dir = TempDir::new();
    let parser = dir.parser();
    let image = dir.0.join("capture.jpg");
    let toml = dir.0.join("capture.toml");
    fs::write(&image, b"original image").unwrap();
    fs::write(&toml, "KEEP=42\n").unwrap();
    let result = parse_debug_parser_directory_with(
        Some(&parser),
        &dir.0,
        |_| {},
        |_, root| {
            fs::write(&image, b"a replaced and different image").unwrap();
            fs::write(root.join("capture.jpg.exif"), "[AE]\nVALUE: 7 |\n")?;
            Ok(())
        },
    )
    .unwrap();
    assert_eq!((result.processed, result.failed), (0, 1));
    assert_eq!(fs::read_to_string(toml).unwrap(), "KEEP=42\n");
}

#[test]
fn dp_preflight_failures_advance_real_preparation_and_write_counts() {
    let dir = TempDir::new();
    let parser = dir.parser();
    for name in ["good", "bad"] {
        fs::write(dir.0.join(format!("{name}.jpg")), b"image").unwrap();
    }
    // A directory masquerading as TOML must fail before being sent to DP.
    fs::create_dir(dir.0.join("bad.toml")).unwrap();
    let mut progress = Vec::new();
    let result = parse_debug_parser_directory_with(
        Some(&parser),
        &dir.0,
        |event| progress.push((event.stage, event.completed, event.total)),
        |_, root| {
            assert_eq!(fs::read_dir(root)?.count(), 1);
            assert!(!root.join("bad.jpg").exists());
            fs::write(root.join("good.jpg.exif"), "[AE]\nVALUE: 7 |\n")?;
            Ok(())
        },
    )
    .unwrap();
    assert_eq!((result.processed, result.failed), (1, 1));
    assert_eq!(
        progress,
        vec![
            ("PREPARE", 0, 0),
            ("PREPARE", 0, 2),
            ("PREPARE", 1, 2),
            ("PREPARE", 2, 2),
            ("DP", 0, 0),
            ("TOML", 1, 2),
            ("TOML", 2, 2),
        ]
    );
    assert!(dir.0.join("bad.toml").is_dir());
}

#[test]
fn explicit_dp_reports_bad_outputs_per_image_without_discarding_successful_images() {
    let dir = TempDir::new();
    let parser = dir.parser();
    for name in ["good", "bad"] {
        fs::write(dir.0.join(format!("{name}.jpg")), b"image").unwrap();
        fs::write(dir.0.join(format!("{name}.toml")), "KEEP=1\n").unwrap();
    }
    let result = parse_debug_parser_directory_with(
        Some(&parser),
        &dir.0,
        |_| {},
        |_, root| {
            fs::write(root.join("good.jpg.exif"), "[AE]\nVALUE: 7 |\n")?;
            fs::create_dir(root.join("bad.jpg.exif"))?;
            Ok(())
        },
    )
    .unwrap();
    assert_eq!((result.processed, result.failed), (1, 1));
    assert_eq!(
        fs::read_to_string(dir.0.join("bad.toml")).unwrap(),
        "KEEP=1\n"
    );
    assert!(fs::read_to_string(dir.0.join("good.toml"))
        .unwrap()
        .contains("VALUE = 7"));
}
