use std::{fs, path::PathBuf, process::Command, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};

use luxe_tauri_lib::{commands::text_cmds::write_temp_text_file, config::StateStore, image_scan};

#[test]
fn concurrent_processes_save_complete_state_and_keep_separate_temporary_assets() {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("luxe-multi-{}-{nonce}", std::process::id()));
    fs::create_dir_all(dir.join("other-images")).unwrap();
    image::RgbImage::new(8, 8).save(dir.join("image.png")).unwrap();
    let state = dir.join("state.toml");
    StateStore::load_paths(state.clone(), dir.join("fallback.toml")).unwrap();

    let children: Vec<_> = ["first", "second"].into_iter().map(|name| {
        Command::new(std::env::current_exe().unwrap())
            .args(["--ignored", "--exact", "instance_worker", "--nocapture"])
            .env("LUXE_MULTI_TEST_DIR", &dir)
            .env("LUXE_MULTI_TEST_NAME", name)
            .spawn().unwrap()
    }).collect();
    for mut child in children {
        assert!(child.wait().unwrap().success());
    }

    let restored: luxe_tauri_lib::config::StateRoot = toml::from_str(&fs::read_to_string(&state).unwrap()).unwrap();
    assert!(["/first", "/second"].contains(&restored.last_route.as_str()));
    assert!(fs::read_dir(&dir).unwrap().all(|entry| !entry.unwrap().file_name().to_string_lossy().ends_with(".tmp")));

    let assets: Vec<Vec<String>> = ["first", "second"].into_iter().map(|name| {
        serde_json::from_str(&fs::read_to_string(dir.join(format!("{name}.json"))).unwrap()).unwrap()
    }).collect();
    assert_ne!(assets[0][0], assets[1][0], "drafts for the same source must be independent");
    assert_ne!(assets[0][1], assets[1][1], "preview cache paths must be independent");
    image_scan::scan_directory(&dir.join("other-images")).unwrap();
    for (paths, name) in assets.iter().zip(["first", "second"]) {
        assert_eq!(fs::read_to_string(&paths[0]).unwrap(), name);
        assert!(PathBuf::from(&paths[1]).is_file(), "another instance's directory change must preserve this preview");
        fs::remove_file(&paths[0]).unwrap();
        fs::remove_file(&paths[1]).unwrap();
    }
    fs::remove_dir_all(&dir).unwrap();
}

// Invoked by the test above in independent processes, without a Tauri window.
#[test]
#[ignore = "child process helper for the multi-instance regression test"]
fn instance_worker() {
    let dir = PathBuf::from(std::env::var_os("LUXE_MULTI_TEST_DIR").unwrap());
    let name = std::env::var("LUXE_MULTI_TEST_NAME").unwrap();
    let store = StateStore::load_paths(dir.join("state.toml"), dir.join("fallback.toml")).unwrap();
    store.root.write().last_route = format!("/{name}");
    fs::write(dir.join(format!("{name}.ready")), "ready").unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !dir.join("first.ready").exists() || !dir.join("second.ready").exists() {
        assert!(Instant::now() < deadline, "other instance did not become ready");
        std::thread::sleep(Duration::from_millis(10));
    }
    for _ in 0..40 {
        store.write_now().unwrap();
    }
    assert_eq!(store.snapshot().last_route, format!("/{name}"));
    let draft = write_temp_text_file("same-AE.cpp".into(), name.clone()).unwrap();
    let preview = image_scan::load_image_preview(&dir.join("image.png")).unwrap();
    fs::write(dir.join(format!("{name}.json")), serde_json::to_vec(&[draft, preview]).unwrap()).unwrap();
}
