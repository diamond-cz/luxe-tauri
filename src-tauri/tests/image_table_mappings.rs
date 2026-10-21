use std::path::Path;
use luxe_tauri_lib::config::Isp6sSchema;

#[test]
fn separate_image_mappings_preserve_keys_and_legacy_chart_view() {
    let schema = Isp6sSchema::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/Isp6s.toml")).unwrap();
    let scene = schema.image_table.scene.as_ref().unwrap();
    let portrait = schema.image_table.portrait.as_ref().unwrap();
    assert!(!scene.contains_key("FaceSt"));
    assert_eq!(portrait["FDY"], "AE_TAG_FLT_FDY");
    for columns in [scene, portrait] {
        assert_eq!(columns["B2D"], "AE_TAG_DRV6_B2D");
        assert_eq!(columns["B2M"], "AE_TAG_DRV6_B2M");
    }
    assert_eq!(schema.image["BV"], portrait["BV"]);
    assert_eq!(schema.image["FDY"], portrait["FDY"]);
    let json = serde_json::to_value(&schema).unwrap();
    assert_eq!(json["image_table"]["scene"]["B2D"], "AE_TAG_DRV6_B2D");
    assert_eq!(json["image_table"]["portrait"]["B2M"], "AE_TAG_DRV6_B2M");
}
