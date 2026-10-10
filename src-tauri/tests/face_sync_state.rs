use luxe_tauri_lib::config::state_schema::Isp6sAeVisual;

#[test]
fn face_sync_modes_default_and_round_trip() {
    let existing: Isp6sAeVisual = toml::from_str("").unwrap();
    assert!(existing.chart_face_sync_modes.is_empty());

    let state: Isp6sAeVisual = toml::from_str(
        "[chart_face_sync_modes]\nFace_fd = true\nFace_nsFd = false\nFace_FLT_fd = false\nFace_FLT_nsFd = true\n",
    ).unwrap();
    let restored: Isp6sAeVisual = toml::from_str(&toml::to_string(&state).unwrap()).unwrap();
    assert_eq!(restored.chart_face_sync_modes, state.chart_face_sync_modes);
    assert!(restored.chart_face_sync_modes["Face_fd"]);
    assert!(!restored.chart_face_sync_modes["Face_nsFd"]);
    assert!(!restored.chart_face_sync_modes["Face_FLT_fd"]);
    assert!(restored.chart_face_sync_modes["Face_FLT_nsFd"]);
}
