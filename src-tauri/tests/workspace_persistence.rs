use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use luxe_tauri_lib::config::{StateRoot, StateStore};
use luxe_tauri_lib::config::state_schema::ImageWorkspace;

struct TestDir(PathBuf);
impl TestDir {
    fn new() -> Self {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("luxe-workspace-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for TestDir {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

#[test]
fn portable_state_migrates_and_restores_tools_files_and_selected_image() {
    let dir = TestDir::new();
    let legacy = dir.0.join("legacy/state.toml");
    let portable = dir.0.join("resources/state.toml");
    fs::create_dir_all(legacy.parent().unwrap()).unwrap();
    let mut saved: StateRoot = toml::from_str("").unwrap();
    saved.last_route = "/mtk".into();
    saved.mtk.debug_parser_path = Some(r"D:\tools\DebugParser.exe".into());
    saved.mtk.cpp_paths.insert("ISP6S|0".into(), r"D:\params\AE.cpp".into());
    saved.mtk.cpp_paths.insert("ISP6S|1".into(), r"D:\params\Tone.cpp".into());
    saved.mtk.cpp_paths.insert("ISP6S|CA-LTM".into(), r"D:\params\CA-LTM.cpp".into());
    saved.mtk.image_workspaces.insert("ISP6S|0".into(), ImageWorkspace {
        dir: r"D:\images".into(), selected_image: Some(r"D:\images\2.jpg".into()),
    });
    fs::write(&legacy, toml::to_string_pretty(&saved).unwrap()).unwrap();
    let store = StateStore::load_paths(portable.clone(), legacy.clone()).unwrap();
    assert_eq!(store.path, portable);
    assert!(legacy.is_file());
    assert_eq!(store.snapshot().last_route, "/mtk");
    store.root.write().mtk.image_workspaces.get_mut("ISP6S|0").unwrap().selected_image = Some(r"D:\images\10.jpg".into());
    store.write_now().unwrap();
    let restored = StateStore::load_paths(portable, legacy).unwrap().snapshot();
    assert_eq!(restored.mtk.debug_parser_path, saved.mtk.debug_parser_path);
    assert_eq!(restored.mtk.cpp_paths, saved.mtk.cpp_paths);
    assert_eq!(restored.mtk.image_workspaces["ISP6S|0"].selected_image.as_deref(), Some(r"D:\images\10.jpg"));
    assert!(!dir.0.join("resources/state.toml.tmp").exists());
}

#[test]
fn unavailable_portable_directory_uses_user_config() {
    let dir = TestDir::new();
    let blocked = dir.0.join("blocked");
    fs::write(&blocked, "file instead of directory").unwrap();
    let fallback = dir.0.join("user/state.toml");
    let store = StateStore::load_paths(blocked.join("state.toml"), fallback.clone()).unwrap();
    assert_eq!(store.path, fallback);
    assert!(fallback.is_file());
}

#[test]
fn old_state_defaults_new_workspace_fields() {
    let restored: StateRoot = toml::from_str("[mtk]\ncurrent_isp = 1\n").unwrap();
    assert_eq!(restored.last_route, "/home");
    assert!(restored.mtk.image_workspaces.is_empty());
    assert!(restored.mtk.cpp_paths.get("ISP6S|CA-LTM").is_none());
}

fn write_route(path: &std::path::Path, route: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut state: StateRoot = toml::from_str("").unwrap();
    state.last_route = route.into();
    fs::write(path, toml::to_string_pretty(&state).unwrap()).unwrap();
}

#[test]
fn development_migrates_project_state_before_user_state_and_keeps_original() {
    let dir = TestDir::new();
    let manifest = dir.0.join("src-tauri");
    let legacy = dir.0.join("resources/state.toml");
    let fallback = dir.0.join("user/state.toml");
    write_route(&legacy, "/mtk");
    write_route(&fallback, "/settings");
    let original = fs::read(&legacy).unwrap();
    let store = StateStore::load_development(&manifest, fallback).unwrap();
    assert_eq!(store.path, manifest.join("resources/state.toml"));
    assert_eq!(store.snapshot().last_route, "/mtk");
    assert_eq!(fs::read(legacy).unwrap(), original);
}

#[test]
fn development_prefers_existing_new_state_over_all_migration_sources() {
    let dir = TestDir::new();
    let manifest = dir.0.join("src-tauri");
    let preferred = manifest.join("resources/state.toml");
    let fallback = dir.0.join("user/state.toml");
    write_route(&dir.0.join("resources/state.toml"), "/mtk");
    write_route(&fallback, "/settings");
    write_route(&preferred, "/qualcomm");
    let store = StateStore::load_development(&manifest, fallback).unwrap();
    assert_eq!(store.path, preferred);
    assert_eq!(store.snapshot().last_route, "/qualcomm");
}

#[test]
fn development_imports_user_state_when_project_legacy_is_missing() {
    let dir = TestDir::new();
    let manifest = dir.0.join("src-tauri");
    let fallback = dir.0.join("user/state.toml");
    write_route(&fallback, "/settings");
    let store = StateStore::load_development(&manifest, fallback.clone()).unwrap();
    assert_eq!(store.path, manifest.join("resources/state.toml"));
    assert_eq!(store.snapshot().last_route, "/settings");
    assert!(fallback.is_file());
}

#[test]
fn unavailable_development_directory_uses_user_config_without_writing_legacy() {
    let dir = TestDir::new();
    let manifest = dir.0.join("src-tauri");
    fs::create_dir(&manifest).unwrap();
    fs::write(manifest.join("resources"), "blocked").unwrap();
    let legacy = dir.0.join("resources/state.toml");
    let fallback = dir.0.join("user/state.toml");
    write_route(&legacy, "/mtk");
    let original = fs::read(&legacy).unwrap();
    let store = StateStore::load_development(&manifest, fallback.clone()).unwrap();
    assert_eq!(store.path, fallback);
    assert_eq!(store.snapshot().last_route, "/mtk");
    assert_eq!(fs::read(legacy).unwrap(), original);
}

#[test]
fn malformed_preferred_state_is_preserved_when_falling_back() {
    let dir = TestDir::new();
    let preferred = dir.0.join("resources/state.toml");
    fs::create_dir_all(preferred.parent().unwrap()).unwrap();
    fs::write(&preferred, "[invalid").unwrap();
    let fallback = dir.0.join("user/state.toml");
    write_route(&fallback, "/settings");
    let store = StateStore::load_paths(preferred.clone(), fallback.clone()).unwrap();
    assert_eq!(store.path, fallback);
    assert_eq!(store.snapshot().last_route, "/settings");
    assert_eq!(fs::read_to_string(preferred).unwrap(), "[invalid");
}

#[tokio::test]
async fn concurrent_sections_and_repeated_flush_survive_development_reload() {
    let dir = TestDir::new();
    let manifest = dir.0.join("src-tauri");
    let fallback = dir.0.join("user/state.toml");
    let store = std::sync::Arc::new(StateStore::load_development(&manifest, fallback.clone()).unwrap());
    let mut mtk = store.snapshot().mtk;
    mtk.debug_parser_path = Some(r"D:\tools\DebugParser.exe".into());
    mtk.cpp_paths.insert("ISP6S|0".into(), r"D:\params\AE.cpp".into());
    mtk.cpp_paths.insert("ISP6S|1".into(), r"D:\params\Tone.cpp".into());
    mtk.image_workspaces.insert("ISP6S|0".into(), ImageWorkspace {
        dir: r"D:\images".into(), selected_image: Some(r"D:\images\2.jpg".into()),
    });
    let (route, paths) = tokio::join!(
        store.patch_section("last_route", serde_json::json!("/mtk")),
        store.patch_section("mtk", serde_json::to_value(&mtk).unwrap()),
    );
    route.unwrap();
    paths.unwrap();
    store.flush_now().await.unwrap();
    store.patch_section("last_route", serde_json::json!("/settings")).await.unwrap();
    store.flush_now().await.unwrap();
    let restored = StateStore::load_development(&manifest, fallback).unwrap().snapshot();
    assert_eq!(restored.last_route, "/settings");
    assert_eq!(serde_json::to_value(restored.mtk).unwrap(), serde_json::to_value(mtk).unwrap());
    assert!(!manifest.join("resources/state.toml.tmp").exists());
}

/// Explicit local check: migrate existing development state without changing its values.
#[test]
#[ignore = "opt-in: migrates the current checkout's local state"]
fn migrate_current_development_state() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let preferred = manifest.join("resources/state.toml");
    let legacy = manifest.parent().unwrap().join("resources/state.toml");
    let source = if preferred.is_file() { &preferred } else { &legacy };
    let original = fs::read(source).expect("existing local state required");
    let expected: StateRoot = toml::from_str(std::str::from_utf8(&original).unwrap()).unwrap();
    let fallback = TestDir::new();
    let store = StateStore::load_development(manifest, fallback.0.join("state.toml")).unwrap();
    assert!(store.path == preferred, "development state must use src-tauri/resources");
    assert!(serde_json::to_value(store.snapshot()).unwrap() == serde_json::to_value(&expected).unwrap(), "migration must preserve all known state fields");
    store.write_now().unwrap();
    let restored: StateRoot = toml::from_str(&fs::read_to_string(&preferred).unwrap()).unwrap();
    assert!(serde_json::to_value(restored).unwrap() == serde_json::to_value(expected).unwrap(), "repeated save must preserve state");
    if source == &legacy { assert!(fs::read(&legacy).unwrap() == original, "legacy backup must remain unchanged"); }
}
