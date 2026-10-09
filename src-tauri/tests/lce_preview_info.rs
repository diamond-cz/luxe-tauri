use std::path::Path;

use luxe_tauri_lib::config::Isp6sSchema;

#[test]
fn lce_preview_info_loads_paired_and_meter_values() {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/Isp6s.toml");
    let schema = Isp6sSchema::load(&path).expect("load Isp6s.toml");
    let items = schema.preview_info.items;

    let keys = |label: &str| {
        items.iter().find(|item| item.label == label)
            .map(|item| (item.toml_key.as_str(), item.toml_keys.as_slice()))
            .expect("preview info row")
    };

    assert_eq!(keys("Final_D,B_Strenth").1,
        ["SW_LCE_FinalDStrength", "SW_LCE_FinalBStrength"]);
    assert_eq!(keys("Level_D,B_Strenth").1,
        ["SW_LCE_DStrengthLevel", "SW_LCE_BStrengthLevel"]);
    assert_eq!(keys("Face_L,H_Bound").1,
        ["SW_LCE_FaceLoBound", "SW_LCE_FaceHiBound"]);
    assert_eq!(keys("MeterFDTarget").0, "SW_LCE_MeterFDTarget");
    assert_eq!(keys("MeterFDLinkTarget").0, "SW_LCE_MeterFDLinkTarget");
    assert_eq!(keys("AEGain").0, "SW_LCE_AEGain");
}
