//! Integration test: parse the real `AE.cpp` from the hiz repository and
//! assert that every contract value used in `test_ae_cpp.py` matches what the
//! Python parser produced. Ground-truth values were captured from a fresh
//! Python run before this test was committed (see M3 plan §verification).

use std::path::Path;

use luxe_tauri_lib::cpp_parser::path_query::{self, ValuesAtPath};
use luxe_tauri_lib::cpp_parser::{parser as cpp_parser, search};

const AE_CPP: &str = r"D:\Image_process\hiz\src\adapters\mtk\isp6s\AE.cpp";

fn parsed() -> luxe_tauri_lib::cpp_parser::types::ParseResult {
    let p = Path::new(AE_CPP);
    assert!(p.exists(), "AE.cpp fixture missing — expected at {AE_CPP}");
    cpp_parser::parse_file(p).expect("parse_file")
}

#[test]
fn header_metadata_matches_python() {
    let r = parsed();
    assert_eq!(r.var_name, "AE_BASE");
    assert_eq!(r.var_type, "AE_NVRAM_T");
    assert_eq!(r.fields.len(), 6163, "total flat fields");
}

#[test]
fn search_by_comment_focuses_length() {
    let r = parsed();
    let hits = search::search_by_comment(&r, "FocusLength", false);
    assert_eq!(hits.len(), 1);
    let h = hits[0];
    assert_eq!(h.path,    "[0][0][1].4");
    assert_eq!(h.value,   "350");
    assert_eq!(h.comment, "u4FocusLength_100x");
    assert_eq!(h.line,    86);
}

#[test]
fn hw_block_field_count() {
    let r = parsed();
    let fields = path_query::get_fields_at_path(&r, "[0][0][1]");
    assert_eq!(fields.len(), 40);
}

#[test]
fn values_at_path_one_dim() {
    // [0][4][1][0] is a single-line array — Python returns flat list of 4.
    let r = parsed();
    let v = path_query::get_values_at_path(&r, "[0][4][1][0]", 0);
    match v {
        ValuesAtPath::Flat(list) =>
            assert_eq!(list, vec!["-2000", "0", "3000", "5500"]),
        other => panic!("expected Flat, got {other:?}"),
    }
}

#[test]
fn values_at_path_two_dim() {
    // MT_WT_table_2st: 15x15 weight table — Python returns nested list-of-lists.
    let r = parsed();
    let v = path_query::get_values_at_path(&r, "[0][3][1][20]", 0);
    match v {
        ValuesAtPath::Grouped(rows) => {
            assert_eq!(rows.len(), 15, "MT_WT_table_2st row count");
            for row in &rows {
                assert_eq!(row.len(), 15, "MT_WT_table_2st col count");
            }
            // Sanity check first row from Python ground truth.
            assert_eq!(rows[0].iter().all(|v| v == "0"), true,
                       "first row is all zeros");
            // Row 1 starts with "0", "43", ...
            assert_eq!(rows[1][0], "0");
            assert_eq!(rows[1][1], "43");
        }
        other => panic!("expected Grouped, got {other:?}"),
    }
}

#[test]
fn ae_tag_versions() {
    let r = parsed();
    let v = |path: &str| {
        path_query::get_fields_at_path(&r, path)
            .first()
            .map(|f| f.value.clone())
            .unwrap_or_default()
    };
    // Spot-check three: HW / FACE / HDR. Values are AE_TAG_* identifiers
    // and stay constant across the BASE table, so an empty string would mean
    // path mismatch.
    assert!(!v("[0][0][0].0").is_empty(), "HW version path");
    assert!(!v("[0][4][0].0").is_empty(), "FACE version path");
    assert!(!v("[0][7][0].0").is_empty(), "HDR version path");
}

#[test]
fn cache_hit_on_second_parse() {
    use luxe_tauri_lib::cpp_parser::CppParserCache;
    let cache = CppParserCache::new();
    let p = Path::new(AE_CPP);
    let _ = cache.get(p).expect("first parse");
    let len_after_first = cache.len();
    let _ = cache.get(p).expect("second parse");
    let len_after_second = cache.len();
    assert_eq!(len_after_first, 1);
    assert_eq!(len_after_second, 1, "second call should hit cache, no extra entry");
}
