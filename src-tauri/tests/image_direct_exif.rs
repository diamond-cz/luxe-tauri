use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use luxe_tauri_lib::image_scan::{
    load_image_exif, load_image_toml, load_image_toml_fields_batch, load_image_toml_sections,
    parse_exif_directory,
};

const APP6_MAGIC: [u8; 4] = [0x06, 0xf2, 0xf1, 0xf0];
const AE_SIGNATURE: u32 = 0xe28f_a520;

fn synthetic_ae_jpeg(value: u32) -> Vec<u8> {
    let directory_len = 4 + 32;
    let mut payload = Vec::new();
    payload.extend_from_slice(&APP6_MAGIC);
    payload.extend_from_slice(&0u16.to_le_bytes());
    payload.extend_from_slice(&1u16.to_le_bytes());
    payload.extend_from_slice(&(directory_len as u32).to_le_bytes());
    payload.extend_from_slice(&(directory_len as u32).to_le_bytes());
    payload.extend_from_slice(&AE_SIGNATURE.to_le_bytes());
    payload.extend_from_slice(&11u32.to_le_bytes());
    payload.extend_from_slice(&[0u8; 24]);
    payload.extend_from_slice(&0x0100_0000u32.to_le_bytes());
    payload.extend_from_slice(&11u32.to_le_bytes());
    payload.extend_from_slice(&0x0100_0001u32.to_le_bytes());
    payload.extend_from_slice(&value.to_le_bytes());

    let mut jpeg = vec![0xff, 0xd8, 0xff, 0xe6];
    jpeg.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
    jpeg.extend_from_slice(&payload);
    jpeg.extend_from_slice(&[0xff, 0xd9]);
    jpeg
}

fn words_bytes(words: &[u32]) -> Vec<u8> {
    words.iter().flat_map(|word| word.to_le_bytes()).collect()
}

fn append_modules(
    mut jpeg: Vec<u8>,
    magic: [u8; 4],
    declarations: &[(u32, u32)],
    blocks: &[Vec<u8>],
) -> Vec<u8> {
    let count = blocks.len() + 1;
    let directory_len = 4 + declarations.len() * 32;
    let mut payload = magic.to_vec();
    payload.extend_from_slice(&(declarations.len() as u16).to_le_bytes());
    payload.extend_from_slice(&(count as u16).to_le_bytes());
    let mut offset = 8 + count * 4 + directory_len;
    payload.extend_from_slice(&(offset as u32).to_le_bytes());
    for block in blocks {
        offset += block.len();
        payload.extend_from_slice(&(offset as u32).to_le_bytes());
    }
    payload.extend_from_slice(&(directory_len as u32).to_le_bytes());
    for (signature, version) in declarations {
        payload.extend_from_slice(&signature.to_le_bytes());
        payload.extend_from_slice(&version.to_le_bytes());
        payload.extend_from_slice(&[0; 24]);
    }
    for block in blocks {
        payload.extend_from_slice(block);
    }
    assert!(payload.len() + 2 <= u16::MAX as usize);
    let marker = match magic {
        [0xfb, 0xfa, 0xf9, 0xf8] => 0xe5,
        [0xf7, 0xf6, 0xf5, 0xf4] => 0xe7,
        _ => 0xe6,
    };
    jpeg.truncate(jpeg.len() - 2);
    jpeg.extend_from_slice(&[0xff, marker]);
    jpeg.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
    jpeg.extend_from_slice(&payload);
    jpeg.extend_from_slice(&[0xff, 0xd9]);
    jpeg
}

#[test]
fn valid_ae_with_unknown_or_truncated_statistics_does_not_export_a_partial_override() {
    let dir = TempDir::new("incomplete-statistics");
    for (name, block) in [
        ("short", words_bytes(&[0x0001_000a, 8])),
        ("unknown-revision", words_bytes(&[0x0002_000a, 8])),
        (
            "unknown-shape",
            words_bytes(&[0x0001_000a, 16, 64 | (48 << 16), 16 | (6 << 16)]),
        ),
    ] {
        let jpeg = append_modules(synthetic_ae_jpeg(123), APP6_MAGIC, &[], &[block]);
        fs::write(dir.0.join(format!("{name}.jpg")), jpeg).unwrap();
        let logical = dir.0.join(format!("{name}.toml"));
        let document = load_image_exif(&logical).unwrap();
        assert!(document.needs_fallback);
        assert!(document.ae_tables.is_empty());
        assert_eq!(load_image_toml(&logical).unwrap()["AE_TAG_ALGO_VER"], "123");
    }
    let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!((result.direct, result.partial, result.failed), (3, 3, 0));
    assert!(!dir.0.join("short.toml").exists());
    assert!(!dir.0.join("unknown-revision.toml").exists());
    assert!(!dir.0.join("unknown-shape.toml").exists());
}

#[test]
fn direct_decoder_generates_toml_without_debug_parser() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("luxe-direct-exif-{}-{nonce}", std::process::id()));
    fs::create_dir(&dir).unwrap();
    fs::write(dir.join("direct.jpg"), synthetic_ae_jpeg(123)).unwrap();
    fs::write(
        dir.join("direct.jpg.exif"),
        "[AE]\nAE_TAG_ALGO_VER: 999 |\n",
    )
    .unwrap();

    let mut progress = Vec::new();
    let result = parse_exif_directory(None, &dir, |event| {
        progress.push((event.stage, event.completed, event.total));
    })
    .unwrap();

    assert_eq!((result.processed, result.skipped, result.failed), (1, 0, 0));
    assert_eq!((result.direct, result.fallback, result.partial), (1, 0, 0));
    let exported: toml::Value =
        toml::from_str(&fs::read_to_string(dir.join("direct.toml")).unwrap()).unwrap();
    assert_eq!(exported["AE"]["AE_TAG_ALGO_VER"].as_integer(), Some(123));
    assert_eq!(exported["AE"]["AE_TAG_DEBUG_VER"].as_integer(), Some(11));
    assert_eq!(exported["__luxe_exif"]["parser"].as_str(), Some("native"));
    assert_eq!(
        progress,
        vec![
            ("EXIF", 0, 1),
            ("EXIF", 1, 1),
            ("TOML", 0, 1),
            ("TOML", 1, 1),
        ]
    );

    fs::remove_dir_all(dir).unwrap();
}

struct TempDir(std::path::PathBuf);
impl TempDir {
    fn new(name: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("luxe-direct-{name}-{}-{nonce}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn missing_sidecar_reads_jpeg_lazily_and_keeps_all_existing_data_contracts() {
    let dir = TempDir::new("lazy");
    let image = dir.0.join("capture.jpg");
    let logical = dir.0.join("capture.toml");
    fs::write(&image, synthetic_ae_jpeg(u32::MAX)).unwrap();

    let data = load_image_toml(&logical).unwrap();
    assert_eq!(data["AE_TAG_ALGO_VER"], "-1");
    assert_eq!(data["ae.ae_tag_algo_ver"], "-1");
    let keys = vec![
        "ae_tag_algo_ver".into(),
        "AE.AE_TAG_DEBUG_VER".into(),
        "missing".into(),
    ];
    let path = logical.to_string_lossy().into_owned();
    let fields = load_image_toml_fields_batch(vec![path.clone()], keys.clone()).unwrap();
    assert_eq!(fields[&path]["ae_tag_algo_ver"], "-1");
    assert_eq!(fields[&path]["AE.AE_TAG_DEBUG_VER"], "11");
    assert!(!fields[&path].contains_key("missing"));
    let sections = load_image_toml_sections(&logical).unwrap();
    assert!(sections.iter().any(|section| section.name == "AE"
        && section
            .fields
            .iter()
            .any(|field| field.key == "AE_TAG_ALGO_VER" && field.value == "-1")));
    assert!(
        !logical.exists(),
        "lazy parsing must never create a sidecar"
    );

    // A manual DP/legacy sidecar must replace the JPEG source in both caches.
    fs::write(&logical, "[AE]\nAE_TAG_ALGO_VER = 5\n").unwrap();
    assert_eq!(load_image_toml(&logical).unwrap()["AE_TAG_ALGO_VER"], "5");
    let fields = load_image_toml_fields_batch(vec![path.clone()], keys).unwrap();
    assert_eq!(fields[&path]["ae_tag_algo_ver"], "5");
}

#[test]
fn large_image_tail_is_not_part_of_the_metadata_read() {
    let dir = TempDir::new("sos");
    let image = dir.0.join("large.JPEG");
    let mut header = synthetic_ae_jpeg(42);
    *header.last_mut().unwrap() = 0xda; // Stop at SOS, before compressed pixels.
    fs::write(&image, header).unwrap();
    fs::OpenOptions::new()
        .write(true)
        .open(&image)
        .unwrap()
        .set_len(64 * 1024 * 1024)
        .unwrap();
    assert_eq!(
        load_image_toml(&dir.0.join("large.toml")).unwrap()["AE_TAG_ALGO_VER"],
        "42"
    );
    assert!(!dir.0.join("large.toml").exists());
}

#[test]
fn partial_native_data_does_not_mask_a_later_manual_fallback() {
    let dir = TempDir::new("partial");
    let mut jpeg = synthetic_ae_jpeg(7);
    jpeg.truncate(jpeg.len() - 2);
    let mut payload = vec![0xfb, 0xfa, 0xf9, 0xf8];
    payload.extend_from_slice(&0u16.to_le_bytes());
    payload.extend_from_slice(&1u16.to_le_bytes());
    payload.extend_from_slice(&36u32.to_le_bytes());
    payload.extend_from_slice(&36u32.to_le_bytes());
    payload.extend_from_slice(&0xbe62_9b07u32.to_le_bytes()); // Sensor: text fallback only.
    payload.extend_from_slice(&0u32.to_le_bytes());
    payload.extend_from_slice(&[0u8; 24]);
    jpeg.extend_from_slice(&[0xff, 0xe5]);
    jpeg.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
    jpeg.extend_from_slice(&payload);
    jpeg.extend_from_slice(&[0xff, 0xd9]);
    fs::write(dir.0.join("partial.jpg"), jpeg).unwrap();
    let logical = dir.0.join("partial.toml");

    let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            result.direct,
            result.fallback,
            result.partial,
            result.failed
        ),
        (1, 0, 1, 0)
    );
    assert!(
        !logical.exists(),
        "partial TOML would prevent a later fallback retry"
    );
    assert_eq!(load_image_toml(&logical).unwrap()["AE_TAG_ALGO_VER"], "7");

    fs::write(
        dir.0.join("partial.jpg.exif"),
        "[AE]\nAE_TAG_ALGO_VER: 999 |\n",
    )
    .unwrap();
    let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!(
        (
            result.direct,
            result.fallback,
            result.partial,
            result.failed
        ),
        (0, 1, 0, 0)
    );
    assert_eq!(load_image_toml(&logical).unwrap()["AE_TAG_ALGO_VER"], "999");
}

#[test]
fn truncated_isp_cannot_create_a_sidecar_or_block_a_later_fallback() {
    let dir = TempDir::new("short-isp");
    let mut jpeg = synthetic_ae_jpeg(7);
    jpeg.truncate(jpeg.len() - 2);
    let mut payload = vec![0xf7, 0xf6, 0xf5, 0xf4];
    payload.extend_from_slice(&1u16.to_le_bytes());
    payload.extend_from_slice(&3u16.to_le_bytes());
    // A 12-word ISP block is followed by enough unrelated padding to fill the
    // enum. The decoder must respect its own validated container boundary.
    for offset in [56u32, 104, 10_104] {
        payload.extend_from_slice(&offset.to_le_bytes());
    }
    payload.extend_from_slice(&36u32.to_le_bytes());
    payload.extend_from_slice(&0xdf19_2ca9u32.to_le_bytes());
    payload.extend_from_slice(&0x0002_000au32.to_le_bytes());
    payload.extend_from_slice(&[0; 24]);
    payload.extend_from_slice(&0x0002_000au32.to_le_bytes());
    payload.extend_from_slice(&[0; 44]);
    payload.extend_from_slice(&vec![0; 10_000]);
    jpeg.extend_from_slice(&[0xff, 0xe7]);
    jpeg.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
    jpeg.extend_from_slice(&payload);
    jpeg.extend_from_slice(&[0xff, 0xd9]);
    fs::write(dir.0.join("short.jpg"), jpeg).unwrap();
    let logical = dir.0.join("short.toml");
    let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!((result.processed, result.partial, result.failed), (1, 1, 0));
    assert!(!logical.exists());
    let fields = load_image_toml(&logical).unwrap();
    assert_eq!(fields["AE_TAG_ALGO_VER"], "7");
    assert!(!fields.contains_key("SW_LCE_LV"));

    fs::write(
        dir.0.join("short.jpg.exif"),
        "[AE]\nAE_TAG_ALGO_VER: 999 |\n[ISP]\nSW_LCE_LV: 123 |\n",
    )
    .unwrap();
    let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!((result.fallback, result.partial, result.failed), (1, 0, 0));
    let fields = load_image_toml(&logical).unwrap();
    assert_eq!(fields["AE_TAG_ALGO_VER"], "999");
    assert_eq!(fields["SW_LCE_LV"], "123");
}

#[test]
fn a_truncated_isp_cannot_export_values_borrowed_from_a_supported_awb_payload() {
    let dir = TempDir::new("isp-in-awb");
    let mut isp = vec![0; 12];
    isp[0] = 0x0002_000a;
    // Exact AWB_6_10_64.h fixture: the complete 1981-word array is legitimate
    // AWB data, including an ISP-looking version in AWB_TAG_INFO_0/1.
    let mut awb = vec![0; 1981];
    awb[0] = 0x0040_000a;
    awb[8..11].fill(1024);
    awb[24] = isp[0];
    let jpeg = append_modules(
        synthetic_ae_jpeg(7),
        [0xf7, 0xf6, 0xf5, 0xf4],
        &[(0xdf19_2ca9, isp[0]), (0xaad7_f62b, awb[0])],
        &[words_bytes(&isp), words_bytes(&awb)],
    );
    fs::write(dir.0.join("capture.jpg"), jpeg).unwrap();
    let logical = dir.0.join("capture.toml");

    let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!((result.processed, result.partial, result.failed), (1, 1, 0));
    assert!(
        !logical.exists(),
        "a truncated ISP must not become a complete sidecar"
    );
    let fields = load_image_toml(&logical).unwrap();
    assert_eq!(fields["AE_TAG_ALGO_VER"], "7");
    assert_eq!(fields["AWB_TAG_INFO_0"], "131082");
    assert!(!fields.contains_key("SW_LCE_LV"));

    fs::write(
        dir.0.join("capture.jpg.exif"),
        "[AE]\nAE_TAG_ALGO_VER: 999 |\n[ISP]\nSW_LCE_LV: 123 |\n",
    )
    .unwrap();
    let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!((result.fallback, result.partial, result.failed), (1, 0, 0));
    let fields = load_image_toml(&logical).unwrap();
    assert_eq!(fields["AE_TAG_ALGO_VER"], "999");
    assert_eq!(fields["SW_LCE_LV"], "123");
}

#[test]
fn empty_declared_modules_do_not_create_a_sidecar_or_block_later_fallbacks() {
    for (name, magic, signature, version, legacy, block, section, recovered_key) in [
        (
            "empty-af",
            APP6_MAGIC,
            0x3d1a_96da,
            8,
            false,
            Vec::new(),
            "AF",
            "VER_CORE",
        ),
        (
            "short-af",
            APP6_MAGIC,
            0x3d1a_96da,
            8,
            false,
            words_bytes(&[0x0200_0000, 8, 0x0280_0001]),
            "AF",
            "VER_CORE",
        ),
        (
            "empty-common",
            [0xfb, 0xfa, 0xf9, 0xf8],
            0x8283_6b27,
            0x0004_0001,
            false,
            Vec::new(),
            "Common",
            "CMN_TAG_SHOT_MODE",
        ),
        (
            "empty-legacy-common",
            [0xfb, 0xfa, 0xf9, 0xf8],
            0x8283_6b27,
            0x0004_0001,
            true,
            Vec::new(),
            "Common",
            "CMN_TAG_SHOT_MODE",
        ),
        (
            "empty-mfnr",
            [0xfb, 0xfa, 0xf9, 0xf8],
            0x7255_88a0,
            12,
            true,
            Vec::new(),
            "MFNR",
            "MF_TAG_MFB_MODE",
        ),
    ] {
        let dir = TempDir::new(name);
        let ae = if legacy {
            append_modules(
                vec![0xff, 0xd8, 0xff, 0xd9],
                [0x05, 0xf2, 0xf1, 0xf0],
                &[(0x3d52_e55b, 0x000e_0007)],
                &[words_bytes(&[0x0100_0000, 0x000e_0007, 0x0100_0001, 7])],
            )
        } else {
            synthetic_ae_jpeg(7)
        };
        let jpeg = append_modules(ae, magic, &[(signature, version)], &[block]);
        fs::write(dir.0.join("capture.jpg"), jpeg).unwrap();
        let logical = dir.0.join("capture.toml");
        let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
        assert_eq!(
            (result.processed, result.partial, result.failed),
            (1, 1, 0),
            "{name}"
        );
        assert!(!logical.exists(), "{name} must remain retryable");
        let fields = load_image_toml(&logical).unwrap();
        assert!(!fields.contains_key(recovered_key), "{name}");
        assert!(load_image_toml_sections(&logical)
            .unwrap()
            .iter()
            .any(|group| group.name == "AE"));

        fs::write(
            dir.0.join("capture.jpg.exif"),
            format!("[AE]\nAE_TAG_ALGO_VER: 999 |\n[{section}]\n{recovered_key}: 88 |\n"),
        )
        .unwrap();
        let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
        assert_eq!(
            (result.fallback, result.partial, result.failed),
            (1, 0, 0),
            "{name}"
        );
        let fields = load_image_toml(&logical).unwrap();
        assert_eq!(fields["AE_TAG_ALGO_VER"], "999", "{name}");
        assert_eq!(fields[recovered_key], "88", "{name}");
    }
}

#[test]
fn ambiguous_and_corrupt_jpegs_do_not_return_guessed_values() {
    let dir = TempDir::new("invalid");
    fs::write(dir.0.join("same.jpg"), synthetic_ae_jpeg(1)).unwrap();
    fs::write(dir.0.join("same.jpeg"), synthetic_ae_jpeg(2)).unwrap();
    assert!(load_image_toml(&dir.0.join("same.toml")).is_err());
    fs::write(dir.0.join("shared.jpg"), synthetic_ae_jpeg(3)).unwrap();
    fs::write(dir.0.join("shared.png"), []).unwrap();
    assert!(load_image_toml(&dir.0.join("shared.toml")).is_err());
    fs::write(dir.0.join("broken.jpg"), [0xff, 0xd8, 0xff, 0xe6, 0, 1]).unwrap();
    assert!(load_image_toml(&dir.0.join("broken.toml")).is_err());
    let result = parse_exif_directory(None, &dir.0, |_| {}).unwrap();
    assert_eq!((result.processed, result.failed), (0, 5));
    assert!(!dir.0.join("same.toml").exists());
    assert!(!dir.0.join("shared.toml").exists());
}
