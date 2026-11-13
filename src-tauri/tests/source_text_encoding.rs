//! Self-contained fixtures; Windows CI exercises the production CP936 implementation.
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use luxe_tauri_lib::commands::text_cmds::{read_text_file, write_temp_text_file, write_text_file};
use luxe_tauri_lib::cpp_parser::card_source::{resolve, CardSourceSpec};
use luxe_tauri_lib::cpp_parser::parser;

static NEXT: AtomicU64 = AtomicU64::new(0);

struct Fixture(PathBuf);

impl Fixture {
    fn new(bytes: &[u8]) -> Self {
        let name = format!(
            "luxe-encoding-{}-{}-{}.cpp",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        );
        let path = std::env::temp_dir().join(name);
        std::fs::write(&path, bytes).unwrap();
        Self(path)
    }

    fn name(&self) -> String {
        self.0.to_string_lossy().into_owned()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

const SOURCE: &str = "const int AE_BASE[2] = { /* 中文 */ 90, 9000 };\r\n";

#[test]
fn unicode_sources_preserve_encoding_bom_and_line_endings_on_save() {
    let mut fixtures = vec![SOURCE.as_bytes().to_vec()];
    let mut bom = vec![0xef, 0xbb, 0xbf];
    bom.extend_from_slice(SOURCE.as_bytes());
    fixtures.push(bom);
    for little in [true, false] {
        let mut bytes = if little {
            vec![0xff, 0xfe]
        } else {
            vec![0xfe, 0xff]
        };
        for unit in SOURCE.encode_utf16() {
            bytes.extend_from_slice(&if little {
                unit.to_le_bytes()
            } else {
                unit.to_be_bytes()
            });
        }
        fixtures.push(bytes);
    }
    for bytes in fixtures {
        let fixture = Fixture::new(&bytes);
        let text = read_text_file(fixture.name()).unwrap();
        assert_eq!(text, SOURCE);
        write_text_file(fixture.name(), text).unwrap();
        assert_eq!(std::fs::read(&fixture.0).unwrap(), bytes);
        let parsed = parser::parse_file(&fixture.0).unwrap();
        assert_eq!(parsed.fields.len(), 2);
        for field in &parsed.fields {
            let line = SOURCE.lines().nth(field.line as usize - 1).unwrap();
            assert_eq!(
                &line[field.column_start as usize..field.column_end as usize],
                field.value
            );
        }
    }
}

#[cfg(windows)]
fn gbk_source() -> Vec<u8> {
    let mut bytes = b"const int AE_BASE[2] = { /* ".to_vec();
    bytes.extend_from_slice(&[0xd6, 0xd0, 0xce, 0xc4]); // 中文 in CP936
    bytes.extend_from_slice(b" */ 90, 9000 };\r\n");
    bytes
}

#[cfg(windows)]
#[test]
fn gbk_display_parser_keyword_lookup_and_utf8_draft_share_text_coordinates() {
    let fixture = Fixture::new(&gbk_source());
    let text = read_text_file(fixture.name()).unwrap();
    assert_eq!(text, SOURCE);
    let parsed = parser::parse_file(&fixture.0).unwrap();
    assert_eq!(parsed.fields.len(), 2);
    for field in &parsed.fields {
        let line = text.lines().nth(field.line as usize - 1).unwrap();
        assert_eq!(
            &line[field.column_start as usize..field.column_end as usize],
            field.value
        );
    }
    let hit = resolve(
        &fixture.0,
        &parsed,
        &CardSourceSpec {
            keywords: vec!["中文".into()],
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(hit.jump_line, 1);
    assert_eq!(hit.ranges, vec![[1, 1]]);

    let draft = Fixture(PathBuf::from(
        write_temp_text_file(fixture.name(), text.clone()).unwrap(),
    ));
    assert_eq!(std::fs::read(&draft.0).unwrap(), text.as_bytes());
    let draft_parsed = parser::parse_file(&draft.0).unwrap();
    for (original, draft) in parsed.fields.iter().zip(&draft_parsed.fields) {
        assert_eq!(original.path, draft.path);
        assert_eq!(original.column_start, draft.column_start);
        assert_eq!(original.column_end, draft.column_end);
    }
}

#[cfg(windows)]
#[test]
fn gbk_save_preserves_bytes_and_applies_edits_without_changing_comments() {
    let original = gbk_source();
    let fixture = Fixture::new(&original);
    write_text_file(fixture.name(), read_text_file(fixture.name()).unwrap()).unwrap();
    assert_eq!(std::fs::read(&fixture.0).unwrap(), original);
    write_text_file(fixture.name(), SOURCE.replace("90,", "95,")).unwrap();
    assert_eq!(
        read_text_file(fixture.name()).unwrap(),
        SOURCE.replace("90,", "95,")
    );
    assert!(std::fs::read(&fixture.0)
        .unwrap()
        .windows(4)
        .any(|w| w == [0xd6, 0xd0, 0xce, 0xc4]));
}

#[cfg(windows)]
#[test]
fn unrepresentable_gbk_edit_is_rejected_before_truncating_original() {
    let bytes = gbk_source();
    let fixture = Fixture::new(&bytes);
    assert!(write_text_file(fixture.name(), format!("{SOURCE}// 😀\r\n")).is_err());
    assert_eq!(std::fs::read(&fixture.0).unwrap(), bytes);
}

#[test]
fn invalid_encoding_is_not_replaced_and_cannot_be_overwritten_by_save() {
    for bytes in [
        &[0x81][..],
        &[0xff, 0xfe, 0x41][..],
        &[0xef, 0xbb, 0xbf, 0xff][..],
        b"a\0b",
    ] {
        let fixture = Fixture::new(bytes);
        assert!(read_text_file(fixture.name()).is_err());
        assert!(write_text_file(fixture.name(), SOURCE.into()).is_err());
        assert_eq!(std::fs::read(&fixture.0).unwrap(), bytes);
    }
}

#[test]
fn new_save_as_file_uses_utf8() {
    let fixture = Fixture::new(b"");
    std::fs::remove_file(&fixture.0).unwrap();
    write_text_file(fixture.name(), SOURCE.into()).unwrap();
    assert_eq!(std::fs::read(&fixture.0).unwrap(), SOURCE.as_bytes());
}
