use luxe_tauri_lib::cpp_parser::{parser, path_query};

#[test]
fn multiple_declarations_and_designated_values_have_distinct_paths_and_columns() {
    let source = "const int LCE_BASE[1] = {\n  { .rLce = { 10, 20 }, 30 }\n};\n\
const int LTM_BASE[1] = {\n  { .rLtm = { 40, 50 } }\n};\n";
    let parsed = parser::parse_source("Tone.cpp", source).expect("parse Tone.cpp");

    assert_eq!(parsed.tree.children.len(), 2);
    assert_eq!(parsed.tree.children[0].section_comment, "LCE_BASE");
    assert_eq!(parsed.tree.children[1].section_comment, "LTM_BASE");
    for (value, expected_path) in [
        ("10", "[0][0][0].0"),
        ("20", "[0][0][0].1"),
        ("30", "[0][0].0"),
        ("40", "[1][0][0].0"),
        ("50", "[1][0][0].1"),
    ] {
        let field = parsed.fields.iter().find(|field| field.value == value).expect("field");
        assert_eq!(field.path, expected_path);
        let line = source.lines().nth(field.line as usize - 1).unwrap();
        assert_eq!(&line[field.column_start as usize..field.column_end as usize], value);
        assert_eq!(path_query::get_fields_at_path(&parsed, expected_path).len(), 1);
    }
}

#[test]
fn scalar_path_does_not_match_larger_index() {
    let source = "const int TONE_BASE[1] = { { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 } };";
    let parsed = parser::parse_source("Tone.cpp", source).expect("parse Tone.cpp");
    let fields = path_query::get_fields_at_path(&parsed, "[0].1");
    assert_eq!(fields.len(), 1);
    assert_eq!(fields[0].value, "1");
}

#[test]
fn supplied_tone_lce_tables_have_expected_dimensions() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../TONE.cpp");
    let parsed = parser::parse_file(&path).expect("parse TONE.cpp");

    for index in 0..3 {
        assert_eq!(path_query::get_fields_at_path(&parsed, &format!("[0][0][0][0][{index}]")).len(), 4);
    }
    for index in 3..6 {
        assert_eq!(path_query::get_fields_at_path(&parsed, &format!("[0][0][0][0][{index}]")).len(), 19);
    }
    for strength in 0..2 {
        for dr in 0..11 {
            assert_eq!(path_query::get_fields_at_path(&parsed, &format!("[0][0][0][2][{strength}][{dr}]")).len(), 19);
        }
    }
    for index in 0..4 {
        assert_eq!(path_query::get_fields_at_path(&parsed, &format!("[0][0][0][3][{index}]")).len(), 19);
    }
    for index in 1..=15 {
        assert_eq!(path_query::get_fields_at_path(&parsed, &format!("[0][0][0][4][{index}]")).len(), 19);
    }
}
