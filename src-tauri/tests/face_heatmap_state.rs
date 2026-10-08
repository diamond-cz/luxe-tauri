use luxe_tauri_lib::config::state_schema::Isp6sAeVisual;

#[test]
fn face_heatmap_modes_default_and_round_trip() {
    let existing: Isp6sAeVisual = toml::from_str("").unwrap();
    assert!(existing.chart_face_heatmap_modes.is_empty());

    let state: Isp6sAeVisual = toml::from_str(
        "[chart_face_heatmap_modes.Face_fdTh]\nenabled = true\nshow_hit_counts = false\n\
         [chart_face_heatmap_modes.Face_FLT_nsOeth]\nenabled = true\n",
    ).unwrap();
    assert!(!state.chart_face_heatmap_modes["Face_fdTh"].show_hit_counts);
    assert!(state.chart_face_heatmap_modes["Face_FLT_nsOeth"].show_hit_counts);

    let restored: Isp6sAeVisual = toml::from_str(&toml::to_string(&state).unwrap()).unwrap();
    assert!(restored.chart_face_heatmap_modes["Face_fdTh"].enabled);
    assert!(!restored.chart_face_heatmap_modes["Face_fdTh"].show_hit_counts);
    assert!(restored.chart_face_heatmap_modes["Face_FLT_nsOeth"].enabled);
}
