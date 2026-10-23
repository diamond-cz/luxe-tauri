use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use luxe_tauri_lib::config::Isp6sSchema;
use luxe_tauri_lib::image_scan::load_image_toml_fields_batch;

fn image_schema() -> Isp6sSchema {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/Isp6s.toml");
    Isp6sSchema::load(&path).expect("load bundled image column mappings")
}

struct SidecarDir(PathBuf);

impl SidecarDir {
    fn new() -> Self {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("luxe-image-mapping-{}-{nonce}", std::process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn write(&self, name: &str, text: &str) -> String {
        let path = self.0.join(name);
        fs::write(&path, text).unwrap();
        path.to_string_lossy().into_owned()
    }
}

impl Drop for SidecarDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn b2d_b2m_columns_are_exposed_in_the_frontend_schema() {
    let schema = image_schema();
    let json = serde_json::to_value(&schema).unwrap();
    assert_eq!(json["Image"]["B2D"], "AE_TAG_DRV6_B2D");
    assert_eq!(json["Image"]["B2M"], "AE_TAG_DRV6_B2M");
    assert_eq!(json["image_table"]["scene"]["B2D"], "AE_TAG_DRV6_B2D");
    assert_eq!(json["image_table"]["scene"]["B2M"], "AE_TAG_DRV6_B2M");
    assert!(json["image_table"]["portrait"].get("B2D").is_none());
    assert!(json["image_table"]["portrait"].get("B2M").is_none());
    let scene = schema.image_table.scene.as_ref().unwrap();
    let columns: Vec<_> = scene.keys().map(String::as_str).collect();
    assert!(columns.windows(2).any(|pair| pair == ["B2D", "B2M"]));
}

#[test]
fn image_column_mappings_read_b2d_b2m_from_sidecars() {
    let schema = image_schema();
    // Request the same complete field set used by the configurable image columns.
    let keys = schema.image.values().cloned().collect();
    let dir = SidecarDir::new();
    let flat = dir.write("flat.toml", "AE_TAG_DRV6_B2D = 2048\nAE_TAG_DRV6_B2M = 1024\n");
    let nested = dir.write("nested.toml", "[AE.Debug]\nae_tag_drv6_b2d = 0\nae_tag_drv6_b2m = 512\n");
    let partial = dir.write("partial.toml", "AE_TAG_DRV6_B2D = 64\n");
    let missing = dir.0.join("missing.toml").to_string_lossy().into_owned();
    let rows = load_image_toml_fields_batch(
        vec![flat.clone(), nested.clone(), partial.clone(), missing.clone()], keys,
    ).unwrap();
    let b2d = &schema.image["B2D"];
    let b2m = &schema.image["B2M"];
    assert_eq!(rows[&flat][b2d], "2048");
    assert_eq!(rows[&flat][b2m], "1024");
    assert_eq!(rows[&nested][b2d], "0");
    assert_eq!(rows[&nested][b2m], "512");
    assert_eq!(rows[&partial][b2d], "64");
    assert!(!rows[&partial].contains_key(b2m));
    assert!(rows[&missing].is_empty());
}
