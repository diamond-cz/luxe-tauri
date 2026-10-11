use luxe_tauri_lib::config::state_schema::Isp6sAeVisual;

#[test]
fn hs_area_layout_defaults_to_auto_for_existing_state() {
    let existing: Isp6sAeVisual = toml::from_str("").unwrap();
    assert_eq!(existing.chart_hs_area_layout, "auto");
    assert_eq!(Isp6sAeVisual::default().chart_hs_area_layout, "auto");
}

#[test]
fn hs_area_layout_round_trip_preserves_selected_mode() {
    for mode in ["auto", "horizontal", "vertical"] {
        let state: Isp6sAeVisual =
            toml::from_str(&format!("chart_hs_area_layout = \"{mode}\"\n")).unwrap();
        let restored: Isp6sAeVisual =
            toml::from_str(&toml::to_string(&state).unwrap()).unwrap();
        assert_eq!(restored.chart_hs_area_layout, mode);
    }
}
