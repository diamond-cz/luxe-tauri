use luxe_tauri_lib::config::state_schema::Isp6sAeVisual;

#[test]
fn tone_tab_defaults_and_survives_state_round_trip() {
    let old_state: Isp6sAeVisual = toml::from_str("").expect("old state");
    assert_eq!(old_state.tone_chart_map_tab, "LTM");

    let mut state = old_state;
    state.tone_chart_map_tab = "LCE".into();
    let restored: Isp6sAeVisual = toml::from_str(&toml::to_string(&state).unwrap()).unwrap();
    assert_eq!(restored.tone_chart_map_tab, "LCE");
}
