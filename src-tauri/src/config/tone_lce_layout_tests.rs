use super::StateRoot;

#[test]
fn older_toml_uses_equal_tone_lce_charts() {
    let state: StateRoot = toml::from_str("[isp6s_ae_visual]\n").unwrap();
    assert_eq!(state.isp6s_ae_visual.tone_lce_curve_ratio, 50.0);
}

#[test]
fn tone_lce_split_round_trips_independently_of_workspace_columns() {
    let mut state = StateRoot::default();
    state.isp6s_ae_visual.tone_lce_curve_ratio = 63.5;
    let restored: StateRoot = toml::from_str(&toml::to_string(&state).unwrap()).unwrap();
    assert_eq!(restored.isp6s_ae_visual.tone_lce_curve_ratio, 63.5);
    assert_eq!(
        restored.isp6s_ae_visual.workspace_column_ratios,
        vec![67.0, 33.0]
    );
    assert_eq!(restored.isp6s_ae_visual.tone_chart_map_tab, "LTM");
}
