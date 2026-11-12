use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use luxe_tauri_lib::image_scan::{clear_image_sidecars, list_image_sidecars};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);
const IMAGE_BYTES: &[u8] = b"unchanged-image-bytes\0\xff";

struct TempDir(PathBuf);
impl TempDir {
    fn new() -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "luxe-sidecar-cleanup-{}-{nonce}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }

    fn write(&self, name: &str, contents: &[u8]) -> PathBuf {
        let path = self.0.join(name);
        fs::write(&path, contents).unwrap();
        path
    }

    fn image(&self, name: &str) -> PathBuf {
        self.write(name, IMAGE_BYTES)
    }

    fn text(&self, name: &str) -> String {
        absolute(&self.0.join(name))
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn absolute(path: &Path) -> String {
    path.to_str().unwrap().to_string()
}

fn selected(path: &Path) -> Vec<String> {
    vec![absolute(path)]
}

fn names(paths: &[String]) -> Vec<String> {
    let mut names: Vec<_> = paths
        .iter()
        .map(|text| {
            Path::new(text)
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .to_string()
        })
        .collect();
    names.sort();
    names
}

fn assert_image_intact(path: &Path) {
    assert_eq!(fs::read(path).unwrap(), IMAGE_BYTES);
}

#[test]
fn preview_is_read_only_and_cleanup_is_limited_to_the_confirmed_sidecars() {
    let dir = TempDir::new();
    let image = dir.image("capture.jpg");
    for name in [
        "capture.toml",
        "capture.exif",
        "capture.jpg.exif",
        "capture.jpg.toml",
        "unselected.toml",
        "unselected.exif",
        "state.toml",
    ] {
        dir.write(name, name.as_bytes());
    }
    let preview = list_image_sidecars(&dir.0, selected(&image)).unwrap();
    assert_eq!(
        names(&preview),
        vec!["capture.exif", "capture.jpg.exif", "capture.toml"]
    );
    assert!(preview.iter().all(|path| Path::new(path).is_absolute()));
    for path in &preview {
        assert_eq!(
            fs::read(path).unwrap(),
            Path::new(path)
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .as_bytes()
        );
    }
    assert_image_intact(&image);
    let confirmed: Vec<_> = preview
        .iter()
        .filter(|path| {
            Path::new(path)
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("toml"))
        })
        .cloned()
        .collect();
    let summary = clear_image_sidecars(&dir.0, selected(&image), confirmed.clone()).unwrap();
    assert_eq!(summary.deleted, confirmed);
    assert!(summary.failed.is_empty());
    for name in [
        "capture.exif",
        "capture.jpg.exif",
        "capture.jpg.toml",
        "unselected.toml",
        "unselected.exif",
        "state.toml",
    ] {
        assert!(dir.0.join(name).is_file(), "{name} must not be deleted");
    }
    assert_image_intact(&image);
}

#[test]
fn sidecars_created_after_preview_are_not_part_of_the_confirmed_allowlist() {
    let dir = TempDir::new();
    let image = dir.image("scene.png");
    dir.write("scene.toml", b"old");
    let preview = list_image_sidecars(&dir.0, selected(&image)).unwrap();
    dir.write("scene.exif", b"new");
    dir.write("scene.png.exif", b"new full name");
    let summary = clear_image_sidecars(&dir.0, selected(&image), preview).unwrap();
    assert_eq!(names(&summary.deleted), vec!["scene.toml"]);
    assert!(summary.failed.is_empty());
    assert!(dir.0.join("scene.exif").is_file());
    assert!(dir.0.join("scene.png.exif").is_file());
    let no_confirmation = clear_image_sidecars(&dir.0, selected(&image), Vec::new()).unwrap();
    assert!(no_confirmation.deleted.is_empty() && no_confirmation.failed.is_empty());
    assert_image_intact(&image);
}

#[test]
fn duplicates_and_disappeared_confirmations_are_idempotent() {
    let dir = TempDir::new();
    let image = dir.image("repeat.jpeg");
    dir.write("repeat.toml", b"metadata");
    dir.write("repeat.exif", b"metadata");
    let preview = list_image_sidecars(&dir.0, vec![absolute(&image), absolute(&image)]).unwrap();
    assert_eq!(preview.len(), 2);
    fs::remove_file(dir.0.join("repeat.exif")).unwrap();
    let summary = clear_image_sidecars(
        &dir.0,
        selected(&image),
        vec![preview[0].clone(), preview[1].clone(), preview[1].clone()],
    )
    .unwrap();
    assert_eq!(names(&summary.deleted), vec!["repeat.toml"]);
    assert!(summary.failed.is_empty());
    let repeated = clear_image_sidecars(&dir.0, selected(&image), preview).unwrap();
    assert!(repeated.deleted.is_empty() && repeated.failed.is_empty());
    assert!(list_image_sidecars(&dir.0, selected(&image))
        .unwrap()
        .is_empty());
    assert_image_intact(&image);
}

#[test]
fn actual_directory_spelling_is_preserved_under_case_insensitive_matching() {
    let dir = TempDir::new();
    let image = dir.image("MiXeD.JpEg");
    for name in ["mixed.ToMl", "MIXED.EXIF", "mixed.JPEG.ExIf"] {
        dir.write(name, b"metadata");
    }
    let request = vec![dir.text("MIXED.JPEG")];
    let preview = list_image_sidecars(&dir.0, request.clone()).unwrap();
    assert_eq!(
        names(&preview),
        vec!["MIXED.EXIF", "mixed.JPEG.ExIf", "mixed.ToMl"]
    );
    let confirmed = vec![
        dir.text("MIXED.TOML"),
        dir.text("mixed.exif"),
        dir.text("MiXeD.JpEg.ExIf"),
    ];
    let summary = clear_image_sidecars(&dir.0, request, confirmed).unwrap();
    assert_eq!(names(&summary.deleted), names(&preview));
    assert!(summary.failed.is_empty());
    assert_image_intact(&image);
}

#[test]
fn same_stem_images_are_ambiguous_even_if_only_one_was_selected() {
    let dir = TempDir::new();
    let jpg = dir.image("shared.jpg");
    let png = dir.image("SHARED.PNG");
    dir.write("shared.toml", b"shared metadata");
    assert!(list_image_sidecars(&dir.0, selected(&jpg)).is_err());
    assert!(clear_image_sidecars(&dir.0, selected(&jpg), vec![dir.text("shared.toml")]).is_err());
    assert!(clear_image_sidecars(
        &dir.0,
        vec![absolute(&jpg), absolute(&png)],
        vec![dir.text("shared.toml")]
    )
    .is_err());
    assert!(dir.0.join("shared.toml").is_file());
    assert_image_intact(&jpg);
    assert_image_intact(&png);
}

#[test]
fn dotted_image_names_cannot_share_an_exif_sidecar_with_an_unselected_image() {
    let dir = TempDir::new();
    let image = dir.image("scene.jpg");
    let dotted = dir.image("scene.jpg.png");
    dir.write("scene.jpg.exif", b"ambiguous metadata");
    assert!(list_image_sidecars(&dir.0, selected(&image)).is_err());
    assert!(
        clear_image_sidecars(&dir.0, selected(&image), vec![dir.text("scene.jpg.exif")]).is_err()
    );
    assert!(dir.0.join("scene.jpg.exif").is_file());
    assert_image_intact(&image);
    assert_image_intact(&dotted);
}

#[test]
fn preview_rejects_nonimages_outside_paths_directories_and_relative_inputs() {
    let dir = TempDir::new();
    let other = TempDir::new();
    let image = dir.image("safe.jpg");
    let outside = other.image("outside.jpg");
    dir.write("safe.toml", b"metadata");
    let text = dir.write("text.txt", b"not an image");
    let gif = dir.write("animation.gif", b"not supported");
    fs::create_dir(dir.0.join("directory.png")).unwrap();
    for invalid in [
        absolute(&outside),
        absolute(&text),
        absolute(&gif),
        dir.text("directory.png"),
        "safe.jpg".to_string(),
        dir.text("absent.jpg"),
        absolute(&dir.0.join("..").join("escaped.jpg")),
    ] {
        assert!(
            list_image_sidecars(&dir.0, vec![absolute(&image), invalid.clone()]).is_err(),
            "{invalid}"
        );
        assert!(clear_image_sidecars(
            &dir.0,
            vec![absolute(&image), invalid],
            vec![dir.text("safe.toml")]
        )
        .is_err());
        assert!(dir.0.join("safe.toml").is_file());
    }
    assert!(list_image_sidecars(Path::new("."), selected(&image)).is_err());
    assert_image_intact(&image);
    assert_image_intact(&outside);
}

#[test]
fn forged_confirmations_are_rejected_as_a_whole_before_any_file_is_removed() {
    let dir = TempDir::new();
    let other = TempDir::new();
    let image = dir.image("safe.jpg");
    let unselected = dir.image("unselected.png");
    dir.write("safe.toml", b"keep on invalid input");
    dir.write("unselected.toml", b"do not touch");
    dir.write("state.toml", b"user state");
    dir.write("arbitrary.txt", b"user data");
    other.write("safe.toml", b"outside metadata");
    let preview = list_image_sidecars(&dir.0, selected(&image)).unwrap();
    for forged in [
        absolute(&image),
        dir.text("unselected.toml"),
        dir.text("state.toml"),
        dir.text("arbitrary.txt"),
        other.text("safe.toml"),
        "safe.toml".into(),
        absolute(&dir.0.join("..").join("safe.toml")),
        dir.text("safe.toml:stream"),
    ] {
        let mut confirmed = preview.clone();
        confirmed.push(forged.clone());
        assert!(
            clear_image_sidecars(&dir.0, selected(&image), confirmed).is_err(),
            "{forged}"
        );
        assert!(dir.0.join("safe.toml").is_file());
        assert!(dir.0.join("unselected.toml").is_file());
        assert!(dir.0.join("state.toml").is_file());
        assert!(other.0.join("safe.toml").is_file());
    }
    // Changing the image list in phase two cannot retain permission to a
    // previously previewed image's metadata.
    assert!(clear_image_sidecars(&dir.0, selected(&unselected), preview).is_err());
    assert!(dir.0.join("safe.toml").is_file());
    assert_image_intact(&image);
    assert_image_intact(&unselected);
}

#[test]
fn state_toml_is_never_a_deletable_sidecar_even_for_an_image_named_state() {
    let dir = TempDir::new();
    let image = dir.image("state.jpg");
    dir.write("state.toml", b"settings, not image metadata");
    dir.write("state.exif", b"image metadata");
    let preview = list_image_sidecars(&dir.0, selected(&image)).unwrap();
    assert_eq!(names(&preview), vec!["state.exif"]);
    assert!(clear_image_sidecars(&dir.0, selected(&image), vec![dir.text("state.toml")]).is_err());
    assert!(dir.0.join("state.exif").is_file());
    clear_image_sidecars(&dir.0, selected(&image), preview).unwrap();
    assert!(dir.0.join("state.toml").is_file());
    assert_image_intact(&image);
}

#[test]
fn confirmed_targets_that_become_directories_are_failed_without_recursive_deletion() {
    let dir = TempDir::new();
    let image = dir.image("changed.jpg");
    dir.write("changed.toml", b"previewed metadata");
    dir.write("changed.exif", b"safe metadata");
    let preview = list_image_sidecars(&dir.0, selected(&image)).unwrap();
    fs::remove_file(dir.0.join("changed.toml")).unwrap();
    fs::create_dir(dir.0.join("changed.toml")).unwrap();
    fs::write(dir.0.join("changed.toml/keep.txt"), b"must stay").unwrap();
    let summary = clear_image_sidecars(&dir.0, selected(&image), preview).unwrap();
    assert_eq!(names(&summary.failed), vec!["changed.toml"]);
    assert_eq!(names(&summary.deleted), vec!["changed.exif"]);
    assert!(dir.0.join("changed.toml/keep.txt").is_file());
    assert!(list_image_sidecars(&dir.0, selected(&image)).is_err());
    assert_image_intact(&image);
}

#[test]
fn read_only_sidecars_are_reported_failed_without_overriding_permissions() {
    let dir = TempDir::new();
    let image = dir.image("locked.jpg");
    let sidecar = dir.write("locked.toml", b"protected metadata");
    let preview = list_image_sidecars(&dir.0, selected(&image)).unwrap();
    let original = fs::metadata(&sidecar).unwrap().permissions();
    let mut read_only = original.clone();
    read_only.set_readonly(true);
    fs::set_permissions(&sidecar, read_only).unwrap();
    let outcome = clear_image_sidecars(&dir.0, selected(&image), preview);
    // Restore the fixture before assertions so failures do not leave an
    // undeletable test directory on Windows.
    fs::set_permissions(&sidecar, original).unwrap();
    let summary = outcome.unwrap();
    assert!(summary.deleted.is_empty());
    assert_eq!(names(&summary.failed), vec!["locked.toml"]);
    assert_eq!(fs::read(&sidecar).unwrap(), b"protected metadata");
    assert_image_intact(&image);
}

#[test]
fn sidecar_cleanup_selection_and_confirmation_budgets_precede_mutation() {
    let dir = TempDir::new();
    let image = dir.image("bounded.jpg");
    dir.write("bounded.toml", b"must remain");
    assert!(list_image_sidecars(&dir.0, vec![absolute(&image); 4097]).is_err());
    assert!(clear_image_sidecars(
        &dir.0,
        vec![absolute(&image); 4097],
        vec![dir.text("bounded.toml")]
    )
    .is_err());
    assert!(
        clear_image_sidecars(&dir.0, selected(&image), vec![dir.text("bounded.toml"); 4]).is_err()
    );
    assert!(dir.0.join("bounded.toml").is_file());
    assert!(list_image_sidecars(&dir.0, Vec::new()).unwrap().is_empty());
    let empty = clear_image_sidecars(&dir.0, Vec::new(), Vec::new()).unwrap();
    assert!(empty.deleted.is_empty() && empty.failed.is_empty());
    assert_image_intact(&image);
}

fn symlink_file(target: &Path, link: &Path) -> bool {
    #[cfg(unix)]
    let result = std::os::unix::fs::symlink(target, link);
    #[cfg(windows)]
    let result = std::os::windows::fs::symlink_file(target, link);
    #[cfg(not(any(unix, windows)))]
    return false;
    #[cfg(any(unix, windows))]
    match result {
        Ok(()) => true,
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::Unsupported
            ) =>
        {
            eprintln!("symlink fixture unavailable on this runner: {error}");
            false
        }
        Err(error) => panic!("create isolated symlink fixture: {error}"),
    }
}

#[test]
fn symlink_images_and_substituted_sidecars_are_never_followed_or_removed() {
    let dir = TempDir::new();
    let outside = TempDir::new();
    let image = dir.image("safe.jpg");
    let target = outside.write("target.toml", b"outside data must survive");
    if !symlink_file(&target, &dir.0.join("linked.jpg")) {
        return;
    }
    dir.write("linked.toml", b"not owned by a regular image");
    assert!(list_image_sidecars(&dir.0, vec![dir.text("linked.jpg")]).is_err());
    assert!(clear_image_sidecars(
        &dir.0,
        vec![dir.text("linked.jpg")],
        vec![dir.text("linked.toml")]
    )
    .is_err());
    dir.write("safe.toml", b"previewed ordinary sidecar");
    let preview = list_image_sidecars(&dir.0, selected(&image)).unwrap();
    fs::remove_file(dir.0.join("safe.toml")).unwrap();
    assert!(symlink_file(&target, &dir.0.join("safe.toml")));
    let summary = clear_image_sidecars(&dir.0, selected(&image), preview).unwrap();
    assert!(summary.deleted.is_empty());
    assert_eq!(names(&summary.failed), vec!["safe.toml"]);
    assert!(fs::symlink_metadata(dir.0.join("safe.toml"))
        .unwrap()
        .file_type()
        .is_symlink());
    assert!(list_image_sidecars(&dir.0, selected(&image)).is_err());
    assert_eq!(fs::read(&target).unwrap(), b"outside data must survive");
    assert!(dir.0.join("linked.toml").is_file());
    assert_image_intact(&image);
}

#[test]
fn symlink_directory_scopes_are_rejected_before_preview_or_deletion() {
    let root = TempDir::new();
    let actual = root.0.join("actual");
    fs::create_dir(&actual).unwrap();
    let image = actual.join("scope.jpg");
    fs::write(&image, IMAGE_BYTES).unwrap();
    fs::write(actual.join("scope.toml"), b"must survive").unwrap();
    let alias = root.0.join("alias");
    #[cfg(unix)]
    let result = std::os::unix::fs::symlink(&actual, &alias);
    #[cfg(windows)]
    let result = std::os::windows::fs::symlink_dir(&actual, &alias);
    #[cfg(not(any(unix, windows)))]
    return;
    #[cfg(any(unix, windows))]
    if let Err(error) = result {
        if matches!(
            error.kind(),
            std::io::ErrorKind::PermissionDenied | std::io::ErrorKind::Unsupported
        ) {
            eprintln!("directory symlink fixture unavailable on this runner: {error}");
            return;
        }
        panic!("create isolated directory symlink fixture: {error}");
    }
    assert!(list_image_sidecars(&alias, vec![absolute(&alias.join("scope.jpg"))]).is_err());
    assert!(clear_image_sidecars(
        &alias,
        vec![absolute(&alias.join("scope.jpg"))],
        vec![absolute(&alias.join("scope.toml"))]
    )
    .is_err());
    assert!(list_image_sidecars(&actual, vec![absolute(&alias.join("scope.jpg"))]).is_err());
    assert!(actual.join("scope.toml").is_file());
    assert_image_intact(&image);
    // Remove just the link explicitly; fixture Drop may otherwise traverse the
    // link differently across platforms.
    #[cfg(unix)]
    fs::remove_file(&alias).unwrap();
    #[cfg(windows)]
    fs::remove_dir(&alias).unwrap();
}

#[cfg(not(windows))]
#[test]
fn case_colliding_sidecar_filenames_are_ambiguous_not_two_deletion_targets() {
    let dir = TempDir::new();
    let image = dir.image("case.jpg");
    dir.write("case.toml", b"first");
    dir.write("CASE.TOML", b"second");
    // Some non-Windows volumes are still case-insensitive.
    if fs::read_dir(&dir.0).unwrap().count() != 3 {
        return;
    }
    assert!(list_image_sidecars(&dir.0, selected(&image)).is_err());
    assert!(clear_image_sidecars(&dir.0, selected(&image), vec![dir.text("case.toml")]).is_err());
    assert_eq!(fs::read(dir.0.join("case.toml")).unwrap(), b"first");
    assert_eq!(fs::read(dir.0.join("CASE.TOML")).unwrap(), b"second");
    assert_image_intact(&image);
}

#[cfg(windows)]
#[test]
fn a_locked_windows_sidecar_is_reported_failed_and_not_force_unlocked() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = TempDir::new();
    let image = dir.image("locked_handle.jpg");
    let sidecar = dir.write("locked_handle.toml", b"open by another consumer");
    let preview = list_image_sidecars(&dir.0, selected(&image)).unwrap();
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(1)
        .open(&sidecar)
        .unwrap();
    let summary = clear_image_sidecars(&dir.0, selected(&image), preview).unwrap();
    assert!(summary.deleted.is_empty());
    assert_eq!(names(&summary.failed), vec!["locked_handle.toml"]);
    assert!(sidecar.is_file());
    drop(locked);
    assert_image_intact(&image);
}
