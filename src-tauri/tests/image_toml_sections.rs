use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use luxe_tauri_lib::image_scan::load_image_toml_sections;

#[test]
fn sections_keep_their_own_keys_and_values() {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let path = std::env::temp_dir().join(format!("luxe-toml-sections-{}-{nonce}.toml", std::process::id()));
    fs::write(&path, "root = 1\nempty = []\n[AE]\nAE_TAG_A = 2\nlist = [3, 4]\n[AE.Face]\nprob = 0.8\n[[AWB]]\ngain = 5\n[[AWB]]\ngain = 6\n[EMPTY]\n").unwrap();

    let sections = load_image_toml_sections(&path).unwrap();
    fs::remove_file(&path).unwrap();

    assert_eq!(sections.iter().map(|section| section.name.as_str()).collect::<Vec<_>>(),
        ["根级", "AE", "AE.Face", "AWB[1]", "AWB[2]", "EMPTY"]);
    assert_eq!(sections[0].fields.iter().find(|field| field.key == "root").unwrap().value, "1");
    assert_eq!(sections[0].fields.iter().find(|field| field.key == "empty").unwrap().value, "");
    assert_eq!(sections[1].fields.iter().find(|field| field.key == "list").unwrap().value, "3, 4");
    assert_eq!(sections[2].fields[0].value, "0.8");
    assert_eq!(sections[3].fields[0].value, "5");
    assert_eq!(sections[4].fields[0].value, "6");
    assert!(sections[5].fields.is_empty());
}
