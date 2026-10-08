use luxe_tauri_lib::config::state_schema::Isp6sAeVisual;

#[test]
fn details_ratio_defaults_for_existing_state_and_round_trips() {
    let existing: Isp6sAeVisual = toml::from_str("").unwrap();
    assert_eq!(existing.workspace_details_ratio, 42.0);
    assert!(!existing.table_collapsed);

    let restored: Isp6sAeVisual = toml::from_str("workspace_details_ratio = 36.5\ntable_collapsed = true").unwrap();
    let saved = toml::to_string(&restored).unwrap();
    let reloaded: Isp6sAeVisual = toml::from_str(&saved).unwrap();
    assert_eq!(reloaded.workspace_details_ratio, 36.5);
    assert!(reloaded.table_collapsed);
}
