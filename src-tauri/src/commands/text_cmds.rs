use crate::error::AppResult;
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    path::Path,
};

#[tauri::command]
pub fn read_text_file(path: String) -> AppResult<String> {
    Ok(std::fs::read_to_string(&path)?)
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> AppResult<()> {
    std::fs::write(&path, contents)?;
    Ok(())
}

#[tauri::command]
pub fn write_temp_text_file(name_hint: String, contents: String) -> AppResult<String> {
    let mut hasher = DefaultHasher::new();
    name_hint.hash(&mut hasher);
    let hash = hasher.finish();

    let hint = Path::new(&name_hint);
    let stem = hint
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("source")
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect::<String>();
    let stem = if stem.is_empty() { "source".into() } else { stem };
    let ext = hint.extension().and_then(|value| value.to_str()).unwrap_or("cpp");
    let dir = std::env::temp_dir().join("luxe-tauri-drafts");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{stem}-{hash:016x}.{ext}"));
    std::fs::write(&path, contents)?;
    Ok(path.to_string_lossy().into_owned())
}
